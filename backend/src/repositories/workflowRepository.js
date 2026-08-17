'use strict';

// Query mechanics for `workflow_requests` only — no business logic
// (that's WorkflowService's job, not built in this slice — see
// .ai/TASK.md). Tenant scoping for id-keyed lookups relies on the
// table's RLS policy (current_setting('app.current_tenant', true) —
// see the Module 8 migration), same as classRepository.js's findById
// and fee_structures/financeRepository.js's own precedent.
//
// approver_chain is stored as JSONB — always stringified going in,
// same treatment generatedReportRepository.js already gives its own
// `parameters` JSONB column, and read back already-parsed by `pg`.
//
// findPendingForApprover is the natural read this table's whole shape
// exists for: "what does this user need to act on next" is
// current_step's approver_chain entry, extracted via a JSONB path
// expression (0-indexed array, hence current_step - 1) rather than a
// second denormalized column — the array is already the source of
// truth for who approves at which step.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['entityType', 'entity_type'],
  ['entityId', 'entity_id'],
  ['requestedByUserId', 'requested_by_user_id'],
  ['origin', 'origin'],
  ['approverChain', 'approver_chain'],
  ['currentStep', 'current_step'],
  ['status', 'status'],
  ['actionManifest', 'action_manifest'],
];

// Both JSONB columns need stringifying going in (node-pg serializes a
// raw JS array/object as its own driver-specific format, not JSON, for
// a jsonb parameter — see attendanceRepository.js's own comment on the
// identical fix for absent_student_ids) — read back already-parsed by
// pg either way.
function toRow(fields) {
  const row = { ...fields };
  if (fields.approverChain !== undefined) row.approverChain = JSON.stringify(fields.approverChain);
  if (fields.actionManifest !== undefined) row.actionManifest = fields.actionManifest === null ? null : JSON.stringify(fields.actionManifest);
  return row;
}

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => toRow(fields)[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO workflow_requests (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query(
    'SELECT * FROM workflow_requests WHERE id = $1',
    [id],
  );
  return result.rows[0] || null;
}

async function findByEntity(client, entityType, entityId) {
  const result = await client.query(
    `SELECT * FROM workflow_requests
     WHERE entity_type = $1 AND entity_id = $2
     ORDER BY created_at DESC`,
    [entityType, entityId],
  );
  return result.rows;
}

async function findPendingForApprover(client, userId) {
  const result = await client.query(
    `SELECT * FROM workflow_requests
     WHERE status = 'Pending'
       AND approver_chain -> (current_step - 1) ->> 'user_id' = $1
     ORDER BY created_at`,
    [userId],
  );
  return result.rows;
}

async function update(client, id, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return findById(client, id);
  }

  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => toRow(fields)[key]);

  const result = await client.query(
    `UPDATE workflow_requests SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    `SELECT * FROM workflow_requests
     ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows;
}

module.exports = {
  create,
  findById,
  findByEntity,
  findPendingForApprover,
  update,
  list,
};
