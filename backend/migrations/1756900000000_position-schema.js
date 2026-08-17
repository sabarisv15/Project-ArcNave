'use strict';

// Identity-Migration-Plan.md Phase 1 / ADR-021 (Institutional Position
// Account Model): `Position -> Institutional Position Account ->
// Current Occupant`, three distinct things, never `Position -> User`.
// Purely additive for this pass — nothing in the app reads these
// tables yet (no identityService, no resolver, no route wired to
// them; that's Phase 3+, explicitly out of scope here). Every table
// below denormalizes its own `college_id`, same convention
// hod_in_charge_appointments/workflow_delegations already use even
// though a join could derive it — keeps RLS's tenant_isolation policy
// a single-column check on every one of these tables, no exception.
//
// positions: the organizational seat itself (Level, title, college).
// Level 1/3 are platform-defined structural positions, Level 2 is
// created/configured by Level 1, Level 4 is person-centric (not part
// of this account model at all, per ADR-021) — this migration doesn't
// enforce which levels get a position_accounts row; that's a Phase 3+
// business decision, not a schema constraint.
//
// position_accounts: the permanent, position-centric identity —
// official institutional email/mailbox, password_hash, MFA
// secret/enrollment state, recovery methods, token_version (ADR-024's
// revocation mechanism, scoped to this account, not to `users`). One
// row per position, created once, never deleted (Phase 7's
// reassignment lifecycle resets its credentials/MFA/token_version in
// place — it never inserts a second row for the same position or
// deletes this one). UNIQUE (position_id) is the DB backstop for that:
// a second INSERT for the same position fails loudly, same
// fail-loudly-not-guess reasoning users_one_active_principal_per_college
// already established for a different invariant.
//
// position_occupants: append-only, links a position_account to
// whichever user currently holds it — modeled directly on
// hod_in_charge_appointments (revoked_at nullable, never deleted, a
// partial UNIQUE index enforces "at most one ACTIVE occupant per
// account" without forbidding the account's full occupant history
// from accumulating multiple past rows). Carries no credentials/MFA/
// session state of its own, per ADR-021 — all of that lives on
// position_accounts.
//
// position_module_assignments / position_department_assignments:
// exclusive-lock join tables, same "mirror the active state, protect
// the mirror with a partial unique index" shape
// users_one_active_hod_per_department already set precedent for, just
// expressible directly here (no cross-table join needed, unlike that
// migration's own reason for going through a trigger-maintained mirror
// column instead). Also append-only (revoked_at, never deleted) so a
// module/department's assignment HISTORY survives past reassignments,
// matching every other lifecycle-ledger table in this schema.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE positions (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id   TEXT NOT NULL REFERENCES colleges(college_id),
        level        INT NOT NULL CHECK (level BETWEEN 1 AND 4),
        title        TEXT NOT NULL,
        created_by   UUID NOT NULL REFERENCES users(id),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE TABLE position_accounts (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id       TEXT NOT NULL REFERENCES colleges(college_id),
        position_id      UUID NOT NULL UNIQUE REFERENCES positions(id),
        official_email   TEXT NOT NULL,
        password_hash    TEXT NOT NULL,
        mfa_enabled      BOOLEAN NOT NULL DEFAULT false,
        mfa_secret       TEXT,
        recovery_email   TEXT,
        recovery_phone   TEXT,
        token_version    INTEGER NOT NULL DEFAULT 0,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE TABLE position_occupants (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id           TEXT NOT NULL REFERENCES colleges(college_id),
        position_account_id  UUID NOT NULL REFERENCES position_accounts(id),
        user_id              UUID NOT NULL REFERENCES users(id),
        assigned_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        assigned_by          UUID NOT NULL REFERENCES users(id),
        revoked_at           TIMESTAMPTZ,
        revoked_by           UUID REFERENCES users(id),
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX position_occupants_one_active_per_account
        ON position_occupants (position_account_id)
        WHERE revoked_at IS NULL
  `);

  pgm.sql(`
    CREATE TABLE position_module_assignments (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id   TEXT NOT NULL REFERENCES colleges(college_id),
        position_id  UUID NOT NULL REFERENCES positions(id),
        module_key   TEXT NOT NULL,
        assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        assigned_by  UUID NOT NULL REFERENCES users(id),
        revoked_at   TIMESTAMPTZ,
        revoked_by   UUID REFERENCES users(id),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX position_module_assignments_one_active_per_college_module
        ON position_module_assignments (college_id, module_key)
        WHERE revoked_at IS NULL
  `);

  pgm.sql(`
    CREATE TABLE position_department_assignments (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id     TEXT NOT NULL REFERENCES colleges(college_id),
        position_id    UUID NOT NULL REFERENCES positions(id),
        department_id  UUID NOT NULL REFERENCES departments(id),
        assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        assigned_by    UUID NOT NULL REFERENCES users(id),
        revoked_at     TIMESTAMPTZ,
        revoked_by     UUID REFERENCES users(id),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX position_department_assignments_one_active_per_department
        ON position_department_assignments (department_id)
        WHERE revoked_at IS NULL
  `);

  const TABLES = [
    'positions',
    'position_accounts',
    'position_occupants',
    'position_module_assignments',
    'position_department_assignments',
  ];

  for (const table of TABLES) {
    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    pgm.sql(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    pgm.sql(`
      CREATE POLICY tenant_isolation ON ${table}
          USING (college_id = current_setting('app.current_tenant', true))
    `);
    // No DELETE: every one of these tables is either "created once,
    // never deleted" (positions/position_accounts) or an append-only
    // ledger (occupants/module/department assignments) — same
    // SELECT/INSERT/UPDATE-only grant hod_in_charge_appointments and
    // workflow_delegations already establish for the identical reason.
    pgm.sql(`GRANT SELECT, INSERT, UPDATE ON ${table} TO ${APP_ROLE}`);
  }
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS position_department_assignments');
  pgm.sql('DROP TABLE IF EXISTS position_module_assignments');
  pgm.sql('DROP TABLE IF EXISTS position_occupants');
  pgm.sql('DROP TABLE IF EXISTS position_accounts');
  pgm.sql('DROP TABLE IF EXISTS positions');
};
