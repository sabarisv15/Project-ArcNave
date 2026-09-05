'use strict';

// Query mechanics for `assessment_mark_corrections` only — no business
// logic (that's AssessmentService's job). No softDelete/hardDelete — a
// correction request is a permanent fact once created (see the
// migration's file-level comment); update() here exists only to set
// applied_at, never to edit the proposal itself. Mirrors
// feeCorrectionRepository.js/attendanceCorrectionRepository.js exactly
// — same table shape, same reasoning.

async function create(
  client,
  { collegeId, assessmentMarkId, requestedByUserId, proposedMarksObtained, reason, workflowRequestId },
) {
  const result = await client.query(
    `INSERT INTO assessment_mark_corrections
       (college_id, assessment_mark_id, requested_by_user_id, proposed_marks_obtained, reason, workflow_request_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [collegeId, assessmentMarkId, requestedByUserId, proposedMarksObtained, reason || null, workflowRequestId || null],
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM assessment_mark_corrections WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function listForMark(client, assessmentMarkId) {
  const result = await client.query(
    'SELECT * FROM assessment_mark_corrections WHERE assessment_mark_id = $1 ORDER BY created_at',
    [assessmentMarkId],
  );
  return result.rows;
}

// The effective correction for a mark: the most recently applied one,
// or null if none has ever been approved (in which case the mark's own
// original value is still effective).
async function findLatestApplied(client, assessmentMarkId) {
  const result = await client.query(
    `SELECT * FROM assessment_mark_corrections
     WHERE assessment_mark_id = $1 AND applied_at IS NOT NULL
     ORDER BY applied_at DESC LIMIT 1`,
    [assessmentMarkId],
  );
  return result.rows[0] || null;
}

async function markApplied(client, id) {
  const result = await client.query(
    'UPDATE assessment_mark_corrections SET applied_at = now() WHERE id = $1 RETURNING *',
    [id],
  );
  return result.rows[0] || null;
}

module.exports = {
  create,
  findById,
  listForMark,
  findLatestApplied,
  markApplied,
};
