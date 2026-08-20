'use strict';

// Second optimization pass, finding #6 — evidence-based, not automatic:
//
// audit_log.findByEntity: WHERE entity = $1 AND entity_id = $2 ORDER BY
// created_at DESC (auditLogRepository.js) — real, used query (e.g. a
// Student Timeline). audit_log.findByUser: WHERE user_id = $1 ORDER BY
// created_at DESC LIMIT/OFFSET — real, used query (Activity Timeline).
// Both zero-indexed today; the table is append-only (arcnave_app has no
// UPDATE/DELETE grant on it) and only grows.
//
// platform_audit_log.listEntries always ORDER BY created_at DESC and
// optionally filters by that same column as a range — already
// paginated (LIMIT/OFFSET). Lower and slower-growing volume than
// tenant audit_log (platform-admin actions only, not every tenant's AI/
// write activity), so only the one index every query pattern actually
// shares is added here — not actor_admin_id, which has weaker evidence
// of real query volume at this table's scale.
//
// No index added for tool_name/request_id/workflow_id: none of these
// are queried as a direct WHERE-clause column anywhere in the
// codebase today (only ever inside the JSONB metadata payload).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id)');
  pgm.sql('CREATE INDEX audit_log_user_id_created_at_idx ON audit_log (user_id, created_at DESC)');
  pgm.sql('CREATE INDEX platform_audit_log_created_at_idx ON platform_audit_log (created_at DESC)');
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS audit_log_entity_idx');
  pgm.sql('DROP INDEX IF EXISTS audit_log_user_id_created_at_idx');
  pgm.sql('DROP INDEX IF EXISTS platform_audit_log_created_at_idx');
};
