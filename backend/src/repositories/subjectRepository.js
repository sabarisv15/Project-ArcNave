'use strict';

// Query mechanics for `subjects` only — no business logic (that's
// CurriculumService's job). Soft-delete only, same reasoning as
// financeRepository.js (no hard-delete function exposed at all).

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['regulationId', 'regulation_id'],
  ['subjectCode', 'subject_code'],
  ['subjectName', 'subject_name'],
  ['semester', 'semester'],
  ['credits', 'credits'],
  ['lectureHours', 'lecture_hours'],
  ['tutorialHours', 'tutorial_hours'],
  ['practicalHours', 'practical_hours'],
  ['subjectType', 'subject_type'],
  ['prerequisites', 'prerequisites'],
  ['sourceDocumentId', 'source_document_id'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO subjects (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query(
    'SELECT * FROM subjects WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  return result.rows[0] || null;
}

async function findByRegulation(client, regulationId) {
  const result = await client.query(
    `SELECT * FROM subjects WHERE regulation_id = $1 AND deleted_at IS NULL
     ORDER BY semester, subject_code`,
    [regulationId],
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
    `UPDATE subjects SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

async function softDelete(client, id) {
  const result = await client.query(
    `UPDATE subjects SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

module.exports = {
  create, findById, findByRegulation, update, softDelete,
};
