'use strict';

// Query mechanics for `messages` only. Immutable, append-only — same
// shape as timetableRevisionRepository.js: "a revision is permanently
// retained and never changes once created." No update/remove function
// exists here on purpose, and the table's own GRANT (see the
// ai-conversations-and-projects migration) omits UPDATE/DELETE at the
// DB level too. A conversation delete still removes its messages via
// the FK's own ON DELETE CASCADE action, not through this file.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['conversationId', 'conversation_id'],
  ['parentMessageId', 'parent_message_id'],
  ['role', 'role'],
  ['content', 'content'],
  ['toolUsed', 'tool_used'],
  ['toolParams', 'tool_params'],
  ['presentation', 'presentation'],
  ['rawData', 'raw_data'],
];

// tool_params/presentation/raw_data are JSONB — pg does not serialize
// a plain JS object/array into valid JSON on its own, so these three
// need an explicit JSON.stringify before binding, same convention
// auditLogRepository.js's own `metadata` column already establishes.
const JSONB_FIELDS = new Set(['toolParams', 'presentation', 'rawData']);

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => (JSONB_FIELDS.has(key) ? JSON.stringify(fields[key]) : fields[key]));
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO messages (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM messages WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function listByConversation(client, conversationId) {
  const result = await client.query(
    'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
    [conversationId],
  );
  return result.rows;
}

module.exports = {
  create,
  findById,
  listByConversation,
};
