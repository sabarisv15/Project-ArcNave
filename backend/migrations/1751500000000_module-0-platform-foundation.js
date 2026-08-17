'use strict';

// Faithful port of the deleted Python/Alembic migration
// backend/alembic/versions/0001_module_0_platform_foundation.py
// (recoverable via `git show <pre-ADR-016 commit>:backend/alembic/versions/0001_module_0_platform_foundation.py`)
// — same tables, same RLS, same grants, not redesigned. See ADR-016
// for why the language changed and why the schema didn't.
//
// platform_admins and colleges carry no RLS (Super Admin / Platform
// API only, never in the tenant-scoped request path — ADR-010).
// users, refresh_tokens, audit_log, and configurations are tenant
// tables: each gets ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL
// SECURITY, and a tenant_isolation policy filtering on
// current_setting('app.current_tenant', true), per ADR-002.
//
// FORCE ROW LEVEL SECURITY matters here specifically because these
// tables are owned by the migration role (arcnave_admin): PostgreSQL
// RLS is bypassed for a table's owner by default, policy or no
// policy. Without FORCE, this whole migration would enforce nothing
// for any connection using the owning role. Superusers bypass RLS
// unconditionally regardless of FORCE — that bypass cannot be closed
// by any policy setting — which is why the app must run as
// arcnave_app (created in docker/postgres/init/01-app-role.sh, never
// granted superuser), not as the migration role. See ADR-015 for the
// full reasoning on the role split.
//
// Raw SQL (pgm.sql) is used throughout rather than node-pg-migrate's
// schema-builder helpers, for the same reason the Python version used
// op.execute() rather than op.create_table(): neither migration tool
// has a first-class construct for RLS policies or FORCE ROW LEVEL
// SECURITY, and keeping the whole migration in one dialect keeps it a
// literal, auditable match against ERD.md rather than a partial
// builder-API translation of it.

const APP_ROLE = 'arcnave_app';
const PLATFORM_ROLE = 'arcnave_platform';
const TENANT_TABLES = ['users', 'refresh_tokens', 'audit_log', 'configurations'];

exports.shorthands = undefined;

exports.up = (pgm) => {
  // --- Platform schema (no RLS — Super Admin / Platform API only) ---

  pgm.sql(`
    CREATE TABLE platform_admins (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username        TEXT UNIQUE NOT NULL,
        email           TEXT UNIQUE NOT NULL,
        password_hash   TEXT NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login_at   TIMESTAMPTZ
    )
  `);

  pgm.sql(`
    CREATE TABLE colleges (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id          TEXT UNIQUE NOT NULL,
        name                TEXT NOT NULL,
        subdomain           TEXT UNIQUE NOT NULL,
        subscription_status TEXT NOT NULL DEFAULT 'trial',
        created_by          UUID REFERENCES platform_admins(id),
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // --- Tenant schema (RLS on every table) ---

  pgm.sql(`
    CREATE TABLE users (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id      TEXT NOT NULL REFERENCES colleges(college_id),
        username        TEXT NOT NULL,
        email           TEXT NOT NULL,
        password_hash   TEXT NOT NULL,
        role            TEXT NOT NULL,
        is_active       BOOLEAN NOT NULL DEFAULT false,
        activated_by    UUID REFERENCES users(id),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (college_id, username)
    )
  `);

  pgm.sql(`
    CREATE TABLE refresh_tokens (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id      TEXT NOT NULL REFERENCES colleges(college_id),
        user_id         UUID NOT NULL REFERENCES users(id),
        token_hash      TEXT NOT NULL,
        issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at      TIMESTAMPTZ NOT NULL,
        revoked_at      TIMESTAMPTZ
    )
  `);

  pgm.sql(`
    CREATE TABLE audit_log (
        id              BIGSERIAL PRIMARY KEY,
        college_id      TEXT NOT NULL REFERENCES colleges(college_id),
        user_id         UUID REFERENCES users(id),
        action          TEXT NOT NULL,
        entity          TEXT NOT NULL,
        entity_id       TEXT,
        metadata        JSONB,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE TABLE configurations (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id      TEXT NOT NULL REFERENCES colleges(college_id),
        category        TEXT NOT NULL,
        configuration   JSONB NOT NULL,
        version         INT NOT NULL DEFAULT 1,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (college_id, category)
    )
  `);

  // --- RLS: ENABLE + FORCE + policy on every tenant table ---

  for (const table of TENANT_TABLES) {
    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    pgm.sql(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    pgm.sql(`
      CREATE POLICY tenant_isolation ON ${table}
          USING (college_id = current_setting('app.current_tenant', true))
    `);
  }

  // --- Least-privilege grants for the runtime role ---
  // arcnave_app is created by docker/postgres/init/01-app-role.sh,
  // which must run before this migration. It is not the table owner,
  // so RLS applies to it in full.

  pgm.sql(`GRANT SELECT ON colleges TO ${APP_ROLE}`);

  // users: is_active is already a soft-delete flag; DELETE here is a
  // placeholder grant for now, not a settled decision — revisit once
  // a real service defines what "delete a user" should mean.
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON users TO ${APP_ROLE}`);

  // refresh_tokens: revoked_at is already a soft-delete field; DELETE
  // here is a placeholder grant for now, not a settled decision.
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON refresh_tokens TO ${APP_ROLE}`);

  // configurations: no soft-delete field defined yet; DELETE here is
  // a placeholder grant for now, not a settled decision.
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON configurations TO ${APP_ROLE}`);

  // audit_log: append-only by design, no UPDATE/DELETE grant. An
  // audit trail the app role can rewrite or erase isn't an audit
  // trail — this is intentionally narrower than the other three
  // tenant tables, not an oversight.
  pgm.sql(`GRANT SELECT, INSERT ON audit_log TO ${APP_ROLE}`);
  pgm.sql(`GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO ${APP_ROLE}`);

  // platform_admins deliberately gets no grant here: the tenant app
  // role has no business reading admin credentials. The Super Admin
  // Portal connects through its own role, arcnave_platform, below —
  // see ADR-010.

  // --- Least-privilege grants for the platform role ---
  // arcnave_platform is created by
  // docker/postgres/init/02-platform-role.sh, same ordering
  // guarantee as arcnave_app above. SELECT/INSERT/UPDATE only, on
  // platform_admins and colleges only — no DELETE (no deletion flow
  // exists yet for either), and explicitly nothing on
  // users/refresh_tokens/audit_log/configurations. That last part
  // isn't just an application-layer convention: this role has no
  // GRANT on any tenant table, so even a bug in platform-side code
  // could not read or write tenant data, regardless of RLS (RLS
  // doesn't even enter into it — GRANT is checked first).
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON platform_admins TO ${PLATFORM_ROLE}`);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON colleges TO ${PLATFORM_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS configurations');
  pgm.sql('DROP TABLE IF EXISTS audit_log');
  pgm.sql('DROP TABLE IF EXISTS refresh_tokens');
  pgm.sql('DROP TABLE IF EXISTS users');
  pgm.sql('DROP TABLE IF EXISTS colleges');
  pgm.sql('DROP TABLE IF EXISTS platform_admins');
};
