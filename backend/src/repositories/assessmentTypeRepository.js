'use strict';

// Query mechanics for `assessment_types` only — no business logic
// (that's AssessmentService's job).

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['name', 'name'],
  ['maxMarks', 'max_marks'],
  ['createdByUserId', 'created_by_user_id'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO assessment_types (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM assessment_types WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// findByName filters on college_id explicitly in addition to RLS,
// same reasoning studentRepository.findByRollNo/staffRepository.
// findByStaffCode/classRepository.findByCollegeAndClassName already
// give: (college_id, name) is the real natural key
// (assessment_types_college_name_key), not globally unique.
async function findByName(client, collegeId, name) {
  const result = await client.query(
    'SELECT * FROM assessment_types WHERE college_id = $1 AND name = $2',
    [collegeId, name],
  );
  return result.rows[0] || null;
}

async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    'SELECT * FROM assessment_types ORDER BY created_at LIMIT $1 OFFSET $2',
    [limit, offset],
  );
  return result.rows;
}

async function update(client, id, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return findById(client, id);
  }

  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => fields[key]);

  const result = await client.query(
    `UPDATE assessment_types SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

module.exports = {
  create, findById, findByName, list, update,
};
