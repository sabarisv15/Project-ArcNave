'use strict';

// Query mechanics for `messages`. Was fully immutable/append-only until
// the message-edit-and-rewind migration (real "edit and regenerate"
// rewind, a deliberate product decision): `update` writes ONLY the
// `content` column, matching that migration's own column-level GRANT
// (every other column — role/tool_used/tool_params/presentation/
// raw_data/attachments/parent_message_id — stays unchangeable, enforced
// at the database level, not just by this file only ever passing
// `content`). `deleteAfter` is conversationService.editMessage's own
// truncate-forward step, always scoped to one conversation_id and a
// `created_at` cutoff, never an unscoped delete. A conversation delete
// still removes its messages via the FK's own ON DELETE CASCADE action,
// not through either of these.

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
  ['attachments', 'attachments'],
  ['inputTokens', 'input_tokens'],
  ['outputTokens', 'output_tokens'],
];

// tool_params/presentation/raw_data/attachments are JSONB — pg does
// not serialize a plain JS object/array into valid JSON on its own, so
// these need an explicit JSON.stringify before binding, same convention
// auditLogRepository.js's own `metadata` column already establishes.
const JSONB_FIELDS = new Set(['toolParams', 'presentation', 'rawData', 'attachments']);

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

// limit/offset are opt-in, unlike conversationRepository.listByUser's
// own limit=50 default — a conversation's own transcript is loaded in
// full by every existing caller (no "load more" UI on top of it yet),
// so an omitted limit here still returns everything, same as before
// this parameter existed. A future paginated caller can now ask for a
// page without any further repository change.
async function listByConversation(client, conversationId, { limit, offset } = {}) {
  const values = [conversationId];
  let query = 'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC';
  if (limit !== undefined) {
    values.push(limit);
    query += ` LIMIT $${values.length}`;
  }
  if (offset !== undefined) {
    values.push(offset);
    query += ` OFFSET $${values.length}`;
  }
  const result = await client.query(query, values);
  return result.rows;
}

async function update(client, id, { content }) {
  const result = await client.query('UPDATE messages SET content = $2 WHERE id = $1 RETURNING *', [id, content]);
  return result.rows[0] || null;
}

// Strictly-greater-than: the edited message itself (at `createdAt`)
// is never touched by this, only what came after it — matches
// listByConversation's own `ORDER BY created_at ASC` as the single
// source of truth for "what came after" a given message.
async function deleteAfter(client, conversationId, createdAt) {
  await client.query('DELETE FROM messages WHERE conversation_id = $1 AND created_at > $2', [
    conversationId,
    createdAt,
  ]);
}

module.exports = {
  create,
  findById,
  listByConversation,
  update,
  deleteAfter,
};
