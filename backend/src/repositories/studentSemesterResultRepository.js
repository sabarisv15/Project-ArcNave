'use strict';

// Query mechanics for `student_semester_results` only — no business
// logic (that's studentService.js's job, CLAUDE.md rule 1). Never
// calls another repository (rule 4).
//
// upsert is the one write path: a later entry for the same (student,
// academic_year, semester, subject) is an edit to the SAME fact (see
// this table's own migration comment), so ON CONFLICT overwrites
// result_status/document_id/recorded_by_user_id and bumps updated_at,
// rather than a separate create/update pair racing each other.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['studentId', 'student_id'],
  ['academicYear', 'academic_year'],
  ['semester', 'semester'],
  ['subject', 'subject'],
  ['resultStatus', 'result_status'],
  ['documentId', 'document_id'],
  ['recordedByUserId', 'recorded_by_user_id'],
];

async function upsert(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO student_semester_results (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     ON CONFLICT (student_id, academic_year, semester, subject)
     DO UPDATE SET
       result_status = EXCLUDED.result_status,
       document_id = EXCLUDED.document_id,
       recorded_by_user_id = EXCLUDED.recorded_by_user_id,
       updated_at = now()
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findByStudentId(client, studentId) {
  const result = await client.query(
    'SELECT * FROM student_semester_results WHERE student_id = $1 ORDER BY academic_year, semester, subject',
    [studentId],
  );
  return result.rows;
}

// Bulk read for the Students List "Backlog" column/filter — one query
// for every row on the page, same shape attendanceService.
// computeAttendancePercentageForStudents/financeService.
// computeFeeStatusForStudents already use rather than N+1 per-student
// calls.
async function findByStudentIds(client, studentIds) {
  if (studentIds.length === 0) {
    return [];
  }
  const result = await client.query('SELECT * FROM student_semester_results WHERE student_id = ANY($1::uuid[])', [
    studentIds,
  ]);
  return result.rows;
}

module.exports = {
  upsert,
  findByStudentId,
  findByStudentIds,
};
