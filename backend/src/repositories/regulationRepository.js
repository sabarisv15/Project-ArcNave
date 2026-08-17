'use strict';

// Query mechanics for `regulations` only — no business logic (that's
// CurriculumService's job). Tenant scoping for id-keyed lookups relies
// on the table's own RLS policy, same as every other repository in
// this codebase.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['name', 'name'],
  ['description', 'description'],
  ['createdByUserId', 'created_by_user_id'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO regulations (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM regulations WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    'SELECT * FROM regulations ORDER BY created_at LIMIT $1 OFFSET $2',
    [limit, offset],
  );
  return result.rows;
}

module.exports = { create, findById, list };
