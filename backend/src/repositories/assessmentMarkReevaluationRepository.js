'use strict';

// Query mechanics for `assessment_mark_reevaluations` only — no business
// logic (that's AssessmentService's job). Mirrors
// assessmentMarkCorrectionRepository.js exactly (same table shape, same
// "applied_at is the only column that ever changes after creation"
// reasoning); kept as a separate table/repository from corrections
// because the two apply at different submission states with different
// approvers (see the migration's own file-level comment).

async function create(client, {
  collegeId, assessmentMarkId, requestedByUserId, proposedMarksObtained, reason, workflowRequestId,
}) {
  const result = await client.query(
    `INSERT INTO assessment_mark_reevaluations
       (college_id, assessment_mark_id, requested_by_user_id, proposed_marks_obtained, reason, workflow_request_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [collegeId, assessmentMarkId, requestedByUserId, proposedMarksObtained, reason || null, workflowRequestId || null],
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM assessment_mark_reevaluations WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function listForMark(client, assessmentMarkId) {
  const result = await client.query(
    'SELECT * FROM assessment_mark_reevaluations WHERE assessment_mark_id = $1 ORDER BY created_at',
    [assessmentMarkId],
  );
  return result.rows;
}

async function findLatestApplied(client, assessmentMarkId) {
  const result = await client.query(
    `SELECT * FROM assessment_mark_reevaluations
     WHERE assessment_mark_id = $1 AND applied_at IS NOT NULL
     ORDER BY applied_at DESC LIMIT 1`,
    [assessmentMarkId],
  );
  return result.rows[0] || null;
}

async function markApplied(client, id) {
  const result = await client.query(
    'UPDATE assessment_mark_reevaluations SET applied_at = now() WHERE id = $1 RETURNING *',
    [id],
  );
  return result.rows[0] || null;
}

module.exports = {
  create, findById, listForMark, findLatestApplied, markApplied,
};
