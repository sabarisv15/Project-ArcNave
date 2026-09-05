'use strict';

// Query mechanics for `substitute_assignments` only — no business
// logic (that's AcademicService's job). No update/softDelete/
// hardDelete function exists at all — an assignment is a permanent
// fact about what happened for that date, never edited (see the
// migration's file-level comment, and its GRANT, which omits
// UPDATE/DELETE at the DB permission level too).

async function create(
  client,
  {
    collegeId,
    classId,
    timetablePeriodId,
    assignmentDate,
    originalStaffUserId,
    substituteStaffUserId,
    assigningAuthorityUserId,
    reason,
  },
) {
  const result = await client.query(
    `INSERT INTO substitute_assignments
       (college_id, class_id, timetable_period_id, assignment_date, original_staff_user_id, substitute_staff_user_id, assigning_authority_user_id, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      collegeId,
      classId,
      timetablePeriodId,
      assignmentDate,
      originalStaffUserId || null,
      substituteStaffUserId,
      assigningAuthorityUserId,
      reason || null,
    ],
  );
  return result.rows[0];
}

// The one lookup attendanceService's own authorization check needs:
// "is there a substitute for this class, this exact period, on this
// exact date." classId is required, not just periodId: timetable_periods
// is the shared college-wide bell schedule, reused by many different
// classes for the same (day, hour) — see the migration's own comment.
async function findByClassPeriodAndDate(client, classId, timetablePeriodId, assignmentDate) {
  const result = await client.query(
    'SELECT * FROM substitute_assignments WHERE class_id = $1 AND timetable_period_id = $2 AND assignment_date = $3',
    [classId, timetablePeriodId, assignmentDate],
  );
  return result.rows[0] || null;
}

// The reverse lookup academicService.resolveCurrentSessionForStaff
// needs: "which class (if any) is THIS staff member substituting for,
// this exact period, this exact date" — the class isn't known yet at
// call time, unlike findByClassPeriodAndDate's own use (assertCanMark
// already has a specific class in hand). Ordered by created_at so a
// same-staff double-booking data-entry error (not blocked by the
// unique index, which is scoped per-class) resolves deterministically
// to the earliest assignment rather than an arbitrary one — a real,
// unresolved edge case, not silently hidden.
async function findByStaffPeriodAndDate(client, staffUserId, timetablePeriodId, assignmentDate) {
  const result = await client.query(
    `SELECT * FROM substitute_assignments
     WHERE substitute_staff_user_id = $1 AND timetable_period_id = $2 AND assignment_date = $3
     ORDER BY created_at LIMIT 1`,
    [staffUserId, timetablePeriodId, assignmentDate],
  );
  return result.rows[0] || null;
}

async function listForClass(client, classId) {
  const result = await client.query(
    'SELECT * FROM substitute_assignments WHERE class_id = $1 ORDER BY assignment_date DESC',
    [classId],
  );
  return result.rows;
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM substitute_assignments WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// "My Substitute Duties" (UAT Priority 1 #2): every assignment where
// this staff member IS the substitute, across every class — the
// cross-class query listForClass above can't express, since it's
// scoped to one class at a time. Left-joined against the
// acknowledgement table (not a separate lookup per row) so the
// caller gets acknowledged-or-not in one query.
async function findBySubstituteUserId(client, substituteStaffUserId) {
  const result = await client.query(
    `SELECT sa.*, ack.id AS acknowledgement_id, ack.created_at AS acknowledged_at
     FROM substitute_assignments sa
     LEFT JOIN substitute_assignment_acknowledgements ack
       ON ack.substitute_assignment_id = sa.id
     WHERE sa.substitute_staff_user_id = $1
     ORDER BY sa.assignment_date DESC`,
    [substituteStaffUserId],
  );
  return result.rows;
}

module.exports = {
  create,
  findByClassPeriodAndDate,
  findByStaffPeriodAndDate,
  listForClass,
  findById,
  findBySubstituteUserId,
};
