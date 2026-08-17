'use strict';

// Query mechanics for `substitute_assignment_requests` only — no
// business logic (that's AcademicService's job, same split
// substituteAssignmentRepository.js already follows). No update/
// softDelete/hardDelete function exists: an initiation request is a
// permanent fact, never edited (see the migration's own comment, and
// its GRANT, which omits UPDATE/DELETE).

async function create(client, {
  collegeId, classId, timetablePeriodId, assignmentDate, originalStaffUserId, substituteStaffUserId, reason, requestedByUserId,
}) {
  const result = await client.query(
    `INSERT INTO substitute_assignment_requests
       (college_id, class_id, timetable_period_id, assignment_date, original_staff_user_id, substitute_staff_user_id, reason, requested_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [collegeId, classId, timetablePeriodId, assignmentDate, originalStaffUserId || null, substituteStaffUserId, reason || null, requestedByUserId],
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query(
    'SELECT * FROM substitute_assignment_requests WHERE id = $1',
    [id],
  );
  return result.rows[0] || null;
}

module.exports = {
  create, findById,
};
