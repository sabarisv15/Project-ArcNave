'use strict';

// Query mechanics for `workflow_delegations` only — no business logic
// (that's WorkflowChainService's job). No delete — a delegation, once
// created, is a permanent fact; revoke() sets revoked_at, it never
// removes the row (see the migration's file-level comment).

async function create(client, {
  collegeId, role, departmentId, delegateUserId, startDate, endDate, reason, delegatedByUserId,
}) {
  const result = await client.query(
    `INSERT INTO workflow_delegations
       (college_id, role, department_id, delegate_user_id, start_date, end_date, reason, delegated_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [collegeId, role, departmentId || null, delegateUserId, startDate, endDate || null, reason || null, delegatedByUserId],
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM workflow_delegations WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// The one lookup WorkflowChainService's resolver needs: "is there an
// active delegation for this role (and, if scoped, this department)
// covering today's date." departmentId is nullable in the query itself
// (IS NOT DISTINCT FROM handles both a college-wide role with no
// department and a department-scoped role identically, without two
// separate query shapes).
async function findActive(client, {
  collegeId, role, departmentId, date,
}) {
  const result = await client.query(
    `SELECT * FROM workflow_delegations
     WHERE college_id = $1 AND role = $2 AND department_id IS NOT DISTINCT FROM $3
       AND revoked_at IS NULL
       AND start_date <= $4 AND (end_date IS NULL OR end_date >= $4)
     ORDER BY created_at DESC
     LIMIT 1`,
    [collegeId, role, departmentId || null, date],
  );
  return result.rows[0] || null;
}

async function revoke(client, id, { revokedByUserId }) {
  const result = await client.query(
    `UPDATE workflow_delegations SET revoked_at = now(), revoked_by_user_id = $2
     WHERE id = $1 AND revoked_at IS NULL
     RETURNING *`,
    [id, revokedByUserId],
  );
  return result.rows[0] || null;
}

async function listForCollege(client, collegeId) {
  const result = await client.query(
    'SELECT * FROM workflow_delegations WHERE college_id = $1 ORDER BY created_at DESC',
    [collegeId],
  );
  return result.rows;
}

module.exports = {
  create, findById, findActive, revoke, listForCollege,
};
