'use strict';

// Query mechanics for `conversations` only — no business logic (that's
// conversationService.js's job, and it never calls messageRepository
// or projectRepository directly — CLAUDE.md rule 4). Tenant scoping
// relies on RLS; per-user ownership is a service-layer check.
//
// message_count/last_message_preview/updated_at are trigger-
// maintained (see the ai-conversations-and-projects migration's
// messages_touch_conversation trigger) — update() below never writes
// them; only title/project_id/pinned/archived are ever app-written.
//
// Pagination is limit/offset, matching every other list function in
// this codebase (staffRepository.list, studentRepository.list) —
// consistency over novelty. If conversation volumes ever justify it,
// the natural upgrade is keyset/cursor pagination keyed on
// (updated_at, id) — both already exist and are already the sort key,
// no schema change needed to adopt it later.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['userId', 'user_id'],
  ['projectId', 'project_id'],
  ['title', 'title'],
  ['pinned', 'pinned'],
  ['archived', 'archived'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO conversations (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM conversations WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function listByUser(client, userId, { projectId, search, archived = false, limit = 50, offset = 0 } = {}) {
  const conditions = ['user_id = $1', 'archived = $2'];
  const values = [userId, archived];

  if (projectId !== undefined) {
    values.push(projectId);
    conditions.push(`project_id = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`title ILIKE $${values.length}`);
  }

  values.push(limit, offset);
  const limitPlaceholder = `$${values.length - 1}`;
  const offsetPlaceholder = `$${values.length}`;

  const result = await client.query(
    `SELECT * FROM conversations
     WHERE ${conditions.join(' AND ')}
     ORDER BY updated_at DESC
     LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    values,
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
    `UPDATE conversations SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

async function remove(client, id) {
  await client.query('DELETE FROM conversations WHERE id = $1', [id]);
}

module.exports = {
  create,
  findById,
  listByUser,
  update,
  remove,
};
