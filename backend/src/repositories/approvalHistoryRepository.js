'use strict';

// Query mechanics for `approval_history` only — no business logic. A
// standalone ledger-style repository, not folded into
// workflowRepository.js, same split ADR-018 already establishes
// between auditLogRepository.js and whichever service first needed it
// — ADR-018 names ApprovalHistory by name as a table meant to follow
// this exact shape. arcnave_app has SELECT/INSERT only (no UPDATE/
// DELETE, by design — see the migration): an approval trail the app
// role can rewrite or erase isn't a trail, so recordAction is the only
// write this file offers.

async function recordAction(client, { collegeId, workflowRequestId, step, actorUserId, action, remarks }) {
  const result = await client.query(
    `INSERT INTO approval_history (college_id, workflow_request_id, step, actor_user_id, action, remarks)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [collegeId, workflowRequestId, step, actorUserId, action, remarks],
  );
  return result.rows[0];
}

async function findByRequest(client, workflowRequestId) {
  const result = await client.query(
    `SELECT * FROM approval_history
     WHERE workflow_request_id = $1
     ORDER BY step, created_at`,
    [workflowRequestId],
  );
  return result.rows;
}

module.exports = { recordAction, findByRequest };
