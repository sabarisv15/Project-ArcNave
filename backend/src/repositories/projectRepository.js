'use strict';

// Query mechanics for `projects` only — no business logic (that's
// projectService.js's job). Tenant scoping for id-keyed lookups
// relies on the table's RLS policy (current_setting('app.current_tenant',
// true) — see the ai-conversations-and-projects migration), same as
// personalNoteRepository.js. Per-user ownership is a service-layer
// check, not RLS.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['userId', 'user_id'],
  ['name', 'name'],
  ['instructions', 'instructions'],
  ['pinned', 'pinned'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO projects (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM projects WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function listByUser(client, userId) {
  const result = await client.query('SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
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
    `UPDATE projects SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

async function remove(client, id) {
  await client.query('DELETE FROM projects WHERE id = $1', [id]);
}

module.exports = {
  create,
  findById,
  listByUser,
  update,
  remove,
};
