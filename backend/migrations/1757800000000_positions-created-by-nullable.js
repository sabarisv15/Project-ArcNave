'use strict';

// Phase 2 step 7: positions.created_by relaxed to nullable.
//
// Confirmed dead weight as a read dependency: nothing in the
// application ever SELECTs positions.created_by — it's write-only
// provenance, same category as position_occupants.assigned_by/
// revoked_by and every other *_by column in this schema. The real
// provenance record for who did what is audit_log (createAuditLogEntry),
// not this column.
//
// This phase's Level 1/2 Position Account invite flow (decision 3:
// Platform Admin -> Level 1/2) needs to create/find a `positions` row
// from a Platform Admin actor — who has no `users.id` at all
// (platform_admins is a structurally separate table, ADR-010). The
// existing NOT NULL REFERENCES users(id) has no way to express that
// origin. Rather than inventing a synthetic/system users row (a fake
// identity nothing else in this codebase does) or misattributing
// creation to some tenant user who didn't actually act, NULL now means
// "no tenant user attributable — provisioned by a Platform Admin,"
// with the real "who" recorded in audit_log instead (same
// platformAuditService.record call platformService.invitePrincipal
// already makes for its own platform-admin-initiated action).
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE positions ALTER COLUMN created_by DROP NOT NULL');
};

exports.down = (pgm) => {
  // Non-lossless if any row was inserted with created_by NULL in the
  // meantime — documented here rather than attempting a backfill (dev/
  // demo data only, per this phase's own scope).
  pgm.sql('ALTER TABLE positions ALTER COLUMN created_by SET NOT NULL');
};
