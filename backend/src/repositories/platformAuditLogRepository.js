'use strict';

// Query mechanics for `platform_audit_log` only — no business logic
// (see services/platformAuditService.js for the single write entry
// point every platform mutation goes through). Platform Admin module
// build, Phase A schema / Phase C read path
// (plans/tingly-marinating-whistle.md).
//
// Mirrors auditLogRepository.js's shape for the tenant-side audit_log
// table: one createEntry function, append-only, plus the list/filter
// read path the Audit Logs screen needs.

async function createEntry(pool, { actorAdminId, action, entity, entityId, ipAddress, metadata }) {
  await pool.query(
    `INSERT INTO platform_audit_log (actor_admin_id, action, entity, entity_id, ip_address, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorAdminId, action, entity, entityId, ipAddress, metadata ? JSON.stringify(metadata) : null],
  );
}

async function listEntries(pool, { limit = 20, offset = 0, action, actorAdminId, fromDate, toDate, search } = {}) {
  const conditions = [];
  const params = [limit, offset];

  if (action) {
    params.push(action);
    conditions.push(`l.action = $${params.length}`);
  }
  if (actorAdminId) {
    params.push(actorAdminId);
    conditions.push(`l.actor_admin_id = $${params.length}`);
  }
  if (fromDate) {
    params.push(fromDate);
    conditions.push(`l.created_at >= $${params.length}`);
  }
  if (toDate) {
    params.push(toDate);
    conditions.push(`l.created_at <= $${params.length}`);
  }
  // Free-text filter (Audit Logs screen's single search box) — matches
  // on action OR the actor's username, substring not exact, distinct
  // from the `action` param above (an exact filter some other caller
  // may still want). "system"-actioned rows (actor_admin_id null, no
  // platform_admins row to join) are matched via the literal fallback
  // string the UI already displays for a null username.
  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(l.action ILIKE $${params.length} OR a.username ILIKE $${params.length} OR (a.username IS NULL AND 'system' ILIKE $${params.length}))`,
    );
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT l.id, l.actor_admin_id, a.username AS actor_username, l.action, l.entity, l.entity_id,
            l.ip_address, l.metadata, l.created_at
     FROM platform_audit_log l
     LEFT JOIN platform_admins a ON a.id = l.actor_admin_id
     ${where}
     ORDER BY l.created_at DESC
     LIMIT $1 OFFSET $2`,
    params,
  );
  return result.rows;
}

module.exports = { createEntry, listEntries };
