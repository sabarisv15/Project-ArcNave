'use strict';

// Query mechanics for `attendance_corrections` only — no business
// logic (that's AttendanceService's job). No softDelete/hardDelete —
// a correction request is a permanent fact once created (see the
// migration's file-level comment); update() here exists only to set
// applied_at, never to edit the proposal itself.

async function create(client, {
  collegeId, attendanceSessionId, requestedByUserId, proposedAbsentStudentIds, proposedTotalStudents, reason, workflowRequestId,
}) {
  const result = await client.query(
    `INSERT INTO attendance_corrections
       (college_id, attendance_session_id, requested_by_user_id, proposed_absent_student_ids, proposed_total_students, reason, workflow_request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [collegeId, attendanceSessionId, requestedByUserId, proposedAbsentStudentIds, proposedTotalStudents, reason || null, workflowRequestId || null],
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM attendance_corrections WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function listForSession(client, attendanceSessionId) {
  const result = await client.query(
    'SELECT * FROM attendance_corrections WHERE attendance_session_id = $1 ORDER BY created_at',
    [attendanceSessionId],
  );
  return result.rows;
}

// The effective correction for a session: the most recently applied
// one, or null if none has ever been approved (in which case the
// session's own original values are still effective).
async function findLatestApplied(client, attendanceSessionId) {
  const result = await client.query(
    `SELECT * FROM attendance_corrections
     WHERE attendance_session_id = $1 AND applied_at IS NOT NULL
     ORDER BY applied_at DESC LIMIT 1`,
    [attendanceSessionId],
  );
  return result.rows[0] || null;
}

async function markApplied(client, id) {
  const result = await client.query(
    'UPDATE attendance_corrections SET applied_at = now() WHERE id = $1 RETURNING *',
    [id],
  );
  return result.rows[0] || null;
}

module.exports = {
  create, findById, listForSession, findLatestApplied, markApplied,
};
