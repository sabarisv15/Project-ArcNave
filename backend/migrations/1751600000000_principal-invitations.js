'use strict';

// Faithful port of the deleted Python/Alembic migration
// backend/alembic/versions/0002_principal_invitations.py
// (recoverable via git history) — same table, same directional
// grants, not redesigned. See ADR-016.
//
// principal_invitations gets NO RLS, deliberately, for the same
// structural reason colleges has none: the whole point of this table
// is to be looked up by an opaque bearer token *before* any tenant
// context can possibly be known — the person accepting an invitation
// hasn't been resolved to a tenant by anything yet (no subdomain, no
// JWT, no account). An RLS policy keyed on
// current_setting('app.current_tenant') would fail closed to zero
// rows on every single lookup, since app.current_tenant is never set
// at that point in the request — that would break the feature
// outright, not secure it. college_id here is a plain foreign key,
// read directly by application code, same treatment as
// colleges.id/colleges.college_id already get.
//
// Grants are directional on purpose, mirroring the one-way flow of
// the feature itself:
//   - arcnave_platform (SELECT, INSERT, UPDATE): creates invitations.
//     UPDATE included for a future revoke/resend flow, not built yet.
//   - arcnave_app (SELECT, UPDATE only, NO INSERT): the tenant side
//     only ever *consumes* an invitation — looks one up by
//     token_hash, then marks it accepted. It never creates one; that
//     stays exclusively the platform's job. Withholding INSERT isn't
//     just an application-layer convention — even a bug in tenant-
//     side code could not forge a new invitation row, regardless of
//     what any route handler does.

const APP_ROLE = 'arcnave_app';
const PLATFORM_ROLE = 'arcnave_platform';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE principal_invitations (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id      TEXT NOT NULL REFERENCES colleges(college_id),
        email           TEXT NOT NULL,
        token_hash      TEXT NOT NULL,
        created_by      UUID REFERENCES platform_admins(id),
        expires_at      TIMESTAMPTZ NOT NULL,
        accepted_at     TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // No ENABLE/FORCE ROW LEVEL SECURITY, no tenant_isolation policy —
  // see this file's header comment for why that's deliberate here,
  // unlike every other table with a college_id column.

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON principal_invitations TO ${PLATFORM_ROLE}`);
  pgm.sql(`GRANT SELECT, UPDATE ON principal_invitations TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS principal_invitations');
};
