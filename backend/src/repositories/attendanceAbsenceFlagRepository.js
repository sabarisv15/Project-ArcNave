'use strict';

// Query mechanics for `attendance_absence_flags` only — no business
// logic (that's AttendanceService's job). No softDelete — a raised
// flag is a permanent fact; closing it sets closed_at/closed_by_user_id/
// closure_remarks, never removes the row (ADL-011: "closure... logged").

async function create(client, {
  collegeId, studentId, classId, consecutiveAbsentDays,
}) {
  const result = await client.query(
    `INSERT INTO attendance_absence_flags
       (college_id, student_id, class_id, consecutive_absent_days)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [collegeId, studentId, classId, consecutiveAbsentDays],
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM attendance_absence_flags WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// The one guard raiseAbsenceFlag needs before inserting — mirrors the
// partial unique index (student_id WHERE closed_at IS NULL), checked
// in application code first so a normal re-trigger of an
// already-outstanding condition is a quiet no-op, not a 23505 the
// caller has to catch.
async function findOutstandingForStudent(client, studentId) {
  const result = await client.query(
    'SELECT * FROM attendance_absence_flags WHERE student_id = $1 AND closed_at IS NULL',
    [studentId],
  );
  return result.rows[0] || null;
}

// Batch form of findOutstandingForStudent — markAttendance's own
// per-mark check for every newly-absent student crossing the
// consecutive-absence threshold, resolved in one round-trip instead of
// one query per student. Same `= ANY($1)` pattern listOutstanding's own
// classIds filter already uses in this file.
async function findOutstandingForStudents(client, studentIds) {
  if (!Array.isArray(studentIds) || studentIds.length === 0) {
    return [];
  }
  const result = await client.query(
    'SELECT * FROM attendance_absence_flags WHERE student_id = ANY($1) AND closed_at IS NULL',
    [studentIds],
  );
  return result.rows;
}

// classIds undefined/null means unrestricted (principal) — same
// "no filter means no filter" convention assessmentMarkRepository.
// findByFilters/attendanceCorrectionRepository already use elsewhere in
// this codebase, not a separate "listAll" function.
async function listOutstanding(client, { classIds } = {}) {
  const conditions = ['closed_at IS NULL'];
  const values = [];
  if (classIds !== undefined && classIds !== null) {
    values.push(classIds);
    conditions.push(`class_id = ANY($${values.length})`);
  }
  const result = await client.query(
    `SELECT * FROM attendance_absence_flags WHERE ${conditions.join(' AND ')} ORDER BY raised_at`,
    values,
  );
  return result.rows;
}

async function close(client, id, { closedByUserId, remarks }) {
  const result = await client.query(
    `UPDATE attendance_absence_flags
     SET closed_at = now(), closed_by_user_id = $2, closure_remarks = $3
     WHERE id = $1 AND closed_at IS NULL
     RETURNING *`,
    [id, closedByUserId, remarks || null],
  );
  return result.rows[0] || null;
}

module.exports = {
  create, findById, findOutstandingForStudent, findOutstandingForStudents, listOutstanding, close,
};
