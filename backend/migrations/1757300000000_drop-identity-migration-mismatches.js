'use strict';

// Cleanup pass (post-mortem on the Identity & Organization Model
// migration plan): ARCNAVE has never been deployed to production —
// no live colleges, no real users, only local dev/seed data — so the
// shadow-mode comparison pipeline built in
// 1757200000000_identity-migration-mismatches.js was premature
// migration-rollout tooling for a system that was never live in the
// first place. identityService.js and its resolvers
// (services/identity/*.js) stay — they are permanent architecture,
// unrelated to this table. Only the shadow-comparison mismatch log
// goes.
//
// Reversible, same discipline every migration in this codebase
// follows (CLAUDE.md rule 6): `down` recreates the table exactly as
// 1757200000000 defined it, in case this cleanup ever needs to be
// rolled back.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS identity_migration_mismatches');
};

exports.down = (pgm) => {
  pgm.sql(`
    CREATE TABLE identity_migration_mismatches (
        id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id                TEXT NOT NULL REFERENCES colleges(college_id),
        user_id                   UUID NOT NULL REFERENCES users(id),
        request_id                TEXT,
        route                     TEXT NOT NULL,
        permission_key            TEXT NOT NULL,
        mismatch_type             TEXT NOT NULL,
        legacy_role               TEXT,
        identity_effective_role   TEXT,
        legacy_scope_level        TEXT,
        identity_scope_level      TEXT,
        legacy_department_ids     UUID[],
        identity_department_ids   UUID[],
        detail                    TEXT,
        created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE INDEX identity_migration_mismatches_college_created_idx
        ON identity_migration_mismatches (college_id, created_at DESC)
  `);

  pgm.sql('ALTER TABLE identity_migration_mismatches ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE identity_migration_mismatches FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON identity_migration_mismatches
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT ON identity_migration_mismatches TO ${APP_ROLE}`);
};
