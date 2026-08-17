'use strict';

// Query mechanics for `student_transfer_requests` only — no business
// logic (that's StudentService's job). No softDelete/hardDelete — a
// transfer request, once made, is a permanent fact (see the
// migration's file-level comment); update() here exists only to set
// applied_at, never to edit the request itself.

async function create(client, {
  collegeId, studentId, permanentStudentId, transferType, destinationClassId, destinationCollegeId, reason, requestedByUserId, workflowRequestId,
}) {
  const result = await client.query(
    `INSERT INTO student_transfer_requests
       (college_id, student_id, permanent_student_id, transfer_type, destination_class_id, destination_college_id, reason, requested_by_user_id, workflow_request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [collegeId, studentId, permanentStudentId, transferType, destinationClassId || null, destinationCollegeId || null, reason || null, requestedByUserId, workflowRequestId || null],
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM student_transfer_requests WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function listForStudent(client, studentId) {
  const result = await client.query(
    'SELECT * FROM student_transfer_requests WHERE student_id = $1 ORDER BY created_at DESC',
    [studentId],
  );
  return result.rows;
}

async function markApplied(client, id) {
  const result = await client.query(
    'UPDATE student_transfer_requests SET applied_at = now() WHERE id = $1 RETURNING *',
    [id],
  );
  return result.rows[0] || null;
}

module.exports = {
  create, findById, listForStudent, markApplied,
};
