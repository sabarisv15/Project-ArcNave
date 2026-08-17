'use strict';

// Query mechanics for `archived_records` only — no business logic
// (that's ArchivalService's job). No delete — an archival/restoration
// action is a permanent fact (see the migration's file-level comment);
// markRestored() sets restored_at, it never removes the row.

async function create(client, {
  collegeId, entityType, entityId, reason, archivedByUserId, workflowRequestId,
}) {
  const result = await client.query(
    `INSERT INTO archived_records
       (college_id, entity_type, entity_id, reason, archived_by_user_id, workflow_request_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [collegeId, entityType, entityId, reason || null, archivedByUserId, workflowRequestId || null],
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM archived_records WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// The one lookup every other service's "is this record archived"
// guard needs — at most one active (restored_at IS NULL) row can ever
// match, per the migration's own unique index.
async function findActiveForEntity(client, { entityType, entityId }) {
  const result = await client.query(
    'SELECT * FROM archived_records WHERE entity_type = $1 AND entity_id = $2 AND restored_at IS NULL',
    [entityType, entityId],
  );
  return result.rows[0] || null;
}

async function listForCollege(client, collegeId, { entityType } = {}) {
  const conditions = ['college_id = $1'];
  const values = [collegeId];
  if (entityType !== undefined) {
    values.push(entityType);
    conditions.push(`entity_type = $${values.length}`);
  }
  const result = await client.query(
    `SELECT * FROM archived_records WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
    values,
  );
  return result.rows;
}

// Set once requestRestoration submits the real WorkflowService request
// this row's own restoration is now pending on — archiving itself
// needs no approval (BusinessRules.md only names restoration), so this
// column starts NULL at create() and is attached here, not there.
async function attachWorkflowRequest(client, id, workflowRequestId) {
  const result = await client.query(
    'UPDATE archived_records SET workflow_request_id = $2 WHERE id = $1 RETURNING *',
    [id, workflowRequestId],
  );
  return result.rows[0] || null;
}

async function markRestored(client, id, { restoredByUserId, restoreReason }) {
  const result = await client.query(
    `UPDATE archived_records SET restored_at = now(), restored_by_user_id = $2, restore_reason = $3
     WHERE id = $1 AND restored_at IS NULL
     RETURNING *`,
    [id, restoredByUserId, restoreReason || null],
  );
  return result.rows[0] || null;
}

module.exports = {
  create, findById, findActiveForEntity, listForCollege, attachWorkflowRequest, markRestored,
};
