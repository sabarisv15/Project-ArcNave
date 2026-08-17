'use strict';

// Query mechanics for `assessment_marks` only — no business logic
// (that's AssessmentService's job). Soft-delete only, same reasoning
// as attendanceRepository.js/financeRepository.js (no hard-delete
// function exposed at all).

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['academicYear', 'academic_year'],
  ['classId', 'class_id'],
  ['subject', 'subject'],
  ['assessmentTypeId', 'assessment_type_id'],
  ['studentId', 'student_id'],
  ['marksObtained', 'marks_obtained'],
  ['enteredByUserId', 'entered_by_user_id'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO assessment_marks (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query(
    'SELECT * FROM assessment_marks WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  return result.rows[0] || null;
}

// The exact-slot lookup recordMark's own find-then-create/update flow
// needs — mirrors attendanceRepository.findByClassSessionAndHour's
// "was this already marked" precedent.
async function findOne(client, {
  studentId, assessmentTypeId, classId, subject,
}) {
  const result = await client.query(
    `SELECT * FROM assessment_marks
     WHERE student_id = $1 AND assessment_type_id = $2 AND class_id = $3 AND subject = $4
       AND deleted_at IS NULL`,
    [studentId, assessmentTypeId, classId, subject],
  );
  return result.rows[0] || null;
}

async function update(client, id, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return findById(client, id);
  }

  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => fields[key]);

  const result = await client.query(
    `UPDATE assessment_marks SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

// BusinessRules.md Assessment marks: "mark entry uses filters such as
// Academic Year, Department, Class, Subject, and Assessment." Department
// isn't a column here (a class belongs to a department, not a mark
// directly) — AssessmentService resolves a department filter into a
// list of classIds first (via classRepository.findByDepartmentId) and
// passes that through as classIds, not a separate departmentId
// parameter this repository would need its own join for.
async function findByFilters(client, {
  academicYear, classId, classIds, subject, assessmentTypeId,
} = {}) {
  const conditions = ['deleted_at IS NULL'];
  const values = [];

  if (academicYear !== undefined) {
    values.push(academicYear);
    conditions.push(`academic_year = $${values.length}`);
  }
  if (classId !== undefined) {
    values.push(classId);
    conditions.push(`class_id = $${values.length}`);
  }
  if (classIds !== undefined) {
    values.push(classIds);
    conditions.push(`class_id = ANY($${values.length})`);
  }
  if (subject !== undefined) {
    values.push(subject);
    conditions.push(`subject = $${values.length}`);
  }
  if (assessmentTypeId !== undefined) {
    values.push(assessmentTypeId);
    conditions.push(`assessment_type_id = $${values.length}`);
  }

  const result = await client.query(
    `SELECT * FROM assessment_marks WHERE ${conditions.join(' AND ')} ORDER BY created_at`,
    values,
  );
  return result.rows;
}

async function softDelete(client, id) {
  const result = await client.query(
    `UPDATE assessment_marks SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

module.exports = {
  create, findById, findOne, update, findByFilters, softDelete,
};
