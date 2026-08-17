'use strict';

// Phase 2 Position Account Auth, step 1 (Migration A + E — see
// docs/architecture/Phase2-Position-Account-Auth-Plan.md).
//
// A: position_type on positions — nullable, no CHECK enum (the value
// space is expected to grow: class_tutor now, placement_coordinator/
// nss_coordinator/library_incharge/exam_cell later — validated in
// application code, matching this codebase's preference for business
// rules living in services, not the DB, where the rule is expected to
// evolve). NULL means "plain position, no assignment" (Principal/
// Level2/HOD rows, unchanged).
//
// E: position_account_refresh_tokens — structurally identical to
// refresh_tokens, scoped to position_account_id instead of user_id.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE positions ADD COLUMN position_type TEXT`);

  pgm.sql(`
    CREATE TABLE position_account_refresh_tokens (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id           TEXT NOT NULL REFERENCES colleges(college_id),
        position_account_id  UUID NOT NULL REFERENCES position_accounts(id),
        token_hash           TEXT NOT NULL,
        issued_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at           TIMESTAMPTZ NOT NULL,
        revoked_at           TIMESTAMPTZ
    )
  `);

  pgm.sql(`ALTER TABLE position_account_refresh_tokens ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE position_account_refresh_tokens FORCE ROW LEVEL SECURITY`);
  pgm.sql(`
    CREATE POLICY tenant_isolation ON position_account_refresh_tokens
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON position_account_refresh_tokens TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS position_account_refresh_tokens');
  pgm.sql('ALTER TABLE positions DROP COLUMN IF EXISTS position_type');
};
