'use strict';

// Query mechanics for Module 10's first Analytics slice — no business
// logic (rate math/rounding is AnalyticsService's job, not this
// file's — see .ai/TASK.md).
//
// attendanceRateByClass JOINs attendance_sessions to classes, a
// different domain's table (Attendance owns attendance_sessions,
// Academic owns classes) — CLAUDE.md rule 4 ("repositories never call
// other repositories") governs function-to-function calls, not SQL
// table access, and staffRepository.js's findByCollegeDepartmentAndRole
// already JOINs `users` (Auth/Platform's table) directly for the
// identical reason: the query genuinely needs both tables' columns
// (class_name here, same as staff needing users.role there), and there
// is no repository-owned function this could call instead without an
// N+1 loop per class. Same precedent, not reinvented.
//
// No explicit college_id filter beyond RLS: both attendance_sessions
// and classes carry their own tenant_isolation policy (Module 4 /
// Module 3 migrations), so a JOIN between them can never cross a
// tenant boundary — same reasoning classRepository.js's
// findByTutorUserId gives for relying on RLS alone rather than
// duplicating a filter RLS already guarantees.
//
// deleted_at IS NULL filters soft-deleted attendance_sessions rows
// (same convention attendanceRepository.js's own reads use); classes
// has no soft-delete column yet (flagged, not decided, in
// classRepository.js's own header comment) so there's nothing to
// filter there.
//
// jsonb_array_length(absent_student_ids) turns the JSONB array
// attendanceService.markAttendance writes back into a present-count
// in SQL, rather than pulling every row's raw absent_student_ids back
// to Node and counting there — this query only ever needs the count,
// never the actual student ids, so aggregating in Postgres avoids
// shipping rows this slice has no other use for.
//
// Returns raw sums (total_marked, total_present, sessions_count) per
// class, not a computed rate: division-by-zero (a class with zero
// total_students recorded) and rounding are business-logic judgment
// calls that belong in AnalyticsService, not baked into the query.
async function attendanceRateByClass(client, {
  classId, classIds, startDate, endDate,
} = {}) {
  const conditions = ['a.deleted_at IS NULL'];
  const values = [];
  if (classId !== undefined) {
    values.push(classId);
    conditions.push(`a.class_id = $${values.length}`);
  }
  // classIds (plural) is the scoped-actor filter — a tutor's own
  // assigned classes, or every class in a HOD's own department —
  // same "array of ids, ANY()" shape assessmentMarkRepository.findByFilters
  // already established for its own classIds param. Mutually exclusive
  // with the single classId filter above in practice (callers pass one
  // or the other), never combined.
  if (classIds !== undefined) {
    values.push(classIds);
    conditions.push(`a.class_id = ANY($${values.length})`);
  }
  if (startDate !== undefined) {
    values.push(startDate);
    conditions.push(`a.session_date >= $${values.length}`);
  }
  if (endDate !== undefined) {
    values.push(endDate);
    conditions.push(`a.session_date <= $${values.length}`);
  }

  const result = await client.query(
    `SELECT
       a.class_id,
       c.class_name,
       COUNT(*) AS sessions_count,
       SUM(a.total_students) AS total_marked,
       SUM(a.total_students - jsonb_array_length(a.absent_student_ids)) AS total_present
     FROM attendance_sessions a
     JOIN classes c ON c.id = a.class_id
     WHERE ${conditions.join(' AND ')}
     GROUP BY a.class_id, c.class_name
     ORDER BY c.class_name`,
    values,
  );
  return result.rows;
}

module.exports = {
  attendanceRateByClass,
};
