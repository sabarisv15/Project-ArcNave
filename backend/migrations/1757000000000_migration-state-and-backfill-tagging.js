'use strict';

// Identity-Migration-Plan.md Phase 2 / ADR-025 (Migration Rollback
// Policy): the "College Migration State" mechanism the plan describes
// as "one queryable fact per college" — `LEGACY -> BACKFILLED ->
// SHADOW -> WORKFLOW_V1 -> RBAC_V1 -> FULLY_MIGRATED` — plus the
// `migration_batch_id` tagging column ADR-025 requires on every table
// Phase 2's backfill writes to.
//
// migration_state lives directly on `colleges`, not a new table: it is
// genuinely one fact per college (never per-row, never historical —
// the plan is explicit this replaces "check three separate flags," not
// "track state transition history"), and colleges already has room for
// exactly this shape of column (subscription_status is the same kind
// of single-value-per-college status field on this same table). A
// CHECK constraint enforces the six-value enum server-side rather than
// trusting every caller to spell the value correctly, mirroring
// positions.level's own CHECK (BETWEEN 1 AND 4) precedent one
// migration back. Every college starts 'LEGACY' — the default applies
// both to existing rows (backfilled via the column default on ADD
// COLUMN) and every future INSERT.
//
// migration_batch_id is added to the three Phase 1 tables the backfill
// actually writes to — positions, position_accounts, position_occupants
// (never position_module_assignments/position_department_assignments;
// Phase 2's mapping rule per ADR-025 only creates positions/accounts/
// occupants, module and department assignment wiring is later-phase
// work). Nullable: only backfill-created rows carry a batch id; rows
// created through any other path (e.g. Phase 4's Create/Edit College
// UI, once built) leave this NULL, which is exactly what makes the
// unbackfill script's "delete only rows matching a given batch id"
// promise safe — a NULL row is never a backfill row and can never be
// matched by an unbackfill run's WHERE migration_batch_id = $1.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE colleges ADD COLUMN migration_state TEXT NOT NULL DEFAULT 'LEGACY'
      CHECK (migration_state IN ('LEGACY', 'BACKFILLED', 'SHADOW', 'WORKFLOW_V1', 'RBAC_V1', 'FULLY_MIGRATED'))
  `);

  // colleges is SELECT-only for arcnave_app today (see
  // 1753000000000_college-admin-profile-schema.js's own comment on why
  // an explicit column-level grant was needed there) — the backfill
  // itself always runs through MIGRATION_DATABASE_URL (arcnave_admin),
  // never arcnave_app, so no runtime grant is added here. Nothing in
  // the running app writes migration_state yet (Phase 3+ work).

  pgm.sql('ALTER TABLE positions ADD COLUMN migration_batch_id UUID');
  pgm.sql('ALTER TABLE position_accounts ADD COLUMN migration_batch_id UUID');
  pgm.sql('ALTER TABLE position_occupants ADD COLUMN migration_batch_id UUID');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE position_occupants DROP COLUMN IF EXISTS migration_batch_id');
  pgm.sql('ALTER TABLE position_accounts DROP COLUMN IF EXISTS migration_batch_id');
  pgm.sql('ALTER TABLE positions DROP COLUMN IF EXISTS migration_batch_id');
  pgm.sql('ALTER TABLE colleges DROP COLUMN IF EXISTS migration_state');
};
