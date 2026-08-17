'use strict';

// Query mechanics for `notifications` + `notification_delivery` only —
// no business logic (that's notificationService.js's job, per
// CLAUDE.md rule 1/4). One file, not split like workflow_requests/
// approval_history: notification_delivery rows are always looked up
// by their owning notification_id, and there is no separate caller
// that needs delivery history without the notification it belongs to
// — unlike approval_history, which workflowRequests.js's route layer
// looks up independently of a specific in-memory workflow_requests
// row. Tenant scoping for id-keyed lookups relies on each table's own
// RLS policy (current_setting('app.current_tenant', true) — see the
// Module 8 notification-ledger migration), same as every other
// repository in this codebase.

const NOTIFICATION_COLUMNS = [
  ['collegeId', 'college_id'],
  ['channel', 'channel'],
  ['toAddress', 'to_address'],
  ['subject', 'subject'],
  ['body', 'body'],
  ['status', 'status'],
  ['origin', 'origin'],
  ['kind', 'kind'],
  ['draftedByUserId', 'drafted_by_user_id'],
  ['workflowRequestId', 'workflow_request_id'],
];

async function create(client, fields) {
  const entries = NOTIFICATION_COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO notifications (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query(
    'SELECT * FROM notifications WHERE id = $1',
    [id],
  );
  return result.rows[0] || null;
}

async function update(client, id, fields) {
  const entries = NOTIFICATION_COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return findById(client, id);
  }

  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => fields[key]);

  const result = await client.query(
    `UPDATE notifications SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

// The one write notification_delivery ever gets — one row per real
// send attempt, whatever status notificationService.sendEmail actually
// returned ('sent'/'stubbed'/'failed'), never mutated afterward.
async function recordDeliveryAttempt(client, { collegeId, notificationId, status, error }) {
  const result = await client.query(
    `INSERT INTO notification_delivery (college_id, notification_id, status, error)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [collegeId, notificationId, status, error || null],
  );
  return result.rows[0];
}

async function findDeliveryAttempts(client, notificationId) {
  const result = await client.query(
    `SELECT * FROM notification_delivery
     WHERE notification_id = $1
     ORDER BY attempted_at`,
    [notificationId],
  );
  return result.rows;
}

// The one query mechanic this ledger was missing: every other
// repository in this codebase has a plain list() (classRepository,
// attendanceRepository, ...); this one didn't yet because nothing
// called it — the ledger had a service layer but no human-facing route
// until now. Same shape as the others: RLS-scoped implicitly, no
// explicit college_id filter, newest first.
async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    'SELECT * FROM notifications ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [limit, offset],
  );
  return result.rows;
}

module.exports = {
  create,
  findById,
  update,
  recordDeliveryAttempt,
  findDeliveryAttempts,
  list,
};
