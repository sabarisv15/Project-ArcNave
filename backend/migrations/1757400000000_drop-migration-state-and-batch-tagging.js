'use strict';

// Cleanup pass (post-mortem on the Identity & Organization Model
// migration plan): ARCNAVE has never been deployed to production, so
// the `colleges.migration_state` gradual-rollout tracker and the
// `migration_batch_id` backfill-tagging columns added by
// 1757000000000_migration-state-and-backfill-tagging.js have no
// purpose — the backfill orchestration and shadow-mode comparison
// that read/wrote them were already removed in the two cleanup
// migrations before this one. Nothing in src/ references either
// column any more.
//
// Reversible, same discipline every migration in this codebase
// follows (CLAUDE.md rule 6): `down` recreates both exactly as
// 1757000000000 defined them, in case this cleanup ever needs to be
// rolled back.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE position_occupants DROP COLUMN IF EXISTS migration_batch_id');
  pgm.sql('ALTER TABLE position_accounts DROP COLUMN IF EXISTS migration_batch_id');
  pgm.sql('ALTER TABLE positions DROP COLUMN IF EXISTS migration_batch_id');
  pgm.sql('ALTER TABLE colleges DROP COLUMN IF EXISTS migration_state');
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE colleges ADD COLUMN migration_state TEXT NOT NULL DEFAULT 'LEGACY'
      CHECK (migration_state IN ('LEGACY', 'BACKFILLED', 'SHADOW', 'WORKFLOW_V1', 'RBAC_V1', 'FULLY_MIGRATED'))
  `);
  pgm.sql('ALTER TABLE positions ADD COLUMN migration_batch_id UUID');
  pgm.sql('ALTER TABLE position_accounts ADD COLUMN migration_batch_id UUID');
  pgm.sql('ALTER TABLE position_occupants ADD COLUMN migration_batch_id UUID');
};
