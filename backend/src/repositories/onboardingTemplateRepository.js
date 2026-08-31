'use strict';

// Query mechanics for `onboarding_document_templates` only — mirrors
// departmentRepository.js's shape exactly (same onboarding-catalog
// pattern, same tenant-scoped table).

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['name', 'name'],
  ['fileType', 'file_type'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO onboarding_document_templates (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findByCollege(client, collegeId) {
  const result = await client.query('SELECT * FROM onboarding_document_templates WHERE college_id = $1 ORDER BY name', [
    collegeId,
  ]);
  return result.rows;
}

module.exports = {
  create,
  findByCollege,
};
