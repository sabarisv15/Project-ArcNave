'use strict';

// Query mechanics for `student_lifecycle_events` only — no business
// logic (that's StudentService's job). No update/delete — a lifecycle
// event, once recorded, is a permanent fact (see the migration's
// file-level comment).

async function create(client, {
  collegeId, studentId, previousStatus, newStatus, effectiveDate, reason, updatedByUserId, workflowRequestId,
}) {
  const result = await client.query(
    `INSERT INTO student_lifecycle_events
       (college_id, student_id, previous_status, new_status, effective_date, reason, updated_by_user_id, workflow_request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [collegeId, studentId, previousStatus, newStatus, effectiveDate, reason, updatedByUserId, workflowRequestId || null],
  );
  return result.rows[0];
}

async function listForStudent(client, studentId) {
  const result = await client.query(
    'SELECT * FROM student_lifecycle_events WHERE student_id = $1 ORDER BY created_at DESC',
    [studentId],
  );
  return result.rows;
}

module.exports = { create, listForStudent };
