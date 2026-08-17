'use strict';

// Query mechanics for `assessment_submissions` only — no business logic
// (that's AssessmentService's job). One row per (academic_year, class_id,
// subject, assessment_type_id) batch; findOne is the lookup every
// lock/submit/direct-edit-gate check in the service goes through.

async function create(client, {
  collegeId, academicYear, classId, subject, assessmentTypeId, status,
}) {
  const result = await client.query(
    `INSERT INTO assessment_submissions
       (college_id, academic_year, class_id, subject, assessment_type_id, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [collegeId, academicYear, classId, subject, assessmentTypeId, status || 'draft'],
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM assessment_submissions WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findOne(client, {
  academicYear, classId, subject, assessmentTypeId,
}) {
  const result = await client.query(
    `SELECT * FROM assessment_submissions
     WHERE academic_year = $1 AND class_id = $2 AND subject = $3 AND assessment_type_id = $4`,
    [academicYear, classId, subject, assessmentTypeId],
  );
  return result.rows[0] || null;
}

async function update(client, id, fields) {
  const columns = {
    status: 'status',
    lockedAt: 'locked_at',
    lockedByUserId: 'locked_by_user_id',
    submittedAt: 'submitted_at',
    submittedByUserId: 'submitted_by_user_id',
  };
  const entries = Object.entries(columns).filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return findById(client, id);
  }
  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => fields[key]);

  const result = await client.query(
    `UPDATE assessment_submissions SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

module.exports = {
  create, findById, findOne, update,
};
