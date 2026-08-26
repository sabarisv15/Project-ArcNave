'use strict';

// Query mechanics for `artifacts` only — no business logic (that's
// artifactService.js's job; never calls documentRepository or any
// other repository — CLAUDE.md rule 4). Tenant scoping relies on RLS;
// per-user ownership is a service-layer check.
//
// Soft delete: there is no remove() here on purpose — deleteArtifact
// in artifactService.js goes through update() with deletedAt set,
// same as documentRepository.js handles archived_at/superseded_at
// through its own update, not a separate remove function. listByUser
// and findById both leave deleted_at filtering to the caller
// (artifactService.js) so a service-level "gone means gone" check can
// throw a friendly ArtifactNotFoundError instead of this file
// silently hiding rows.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['userId', 'user_id'],
  ['conversationId', 'conversation_id'],
  ['sourceMessageId', 'source_message_id'],
  ['title', 'title'],
  ['artifactType', 'artifact_type'],
  ['content', 'content'],
  ['status', 'status'],
  ['versionNumber', 'version_number'],
  ['publishedDocumentId', 'published_document_id'],
  ['publishedAt', 'published_at'],
  ['generatedDocumentId', 'generated_document_id'],
  ['generationVerified', 'generation_verified'],
  ['deletedAt', 'deleted_at'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO artifacts (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM artifacts WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// Every column except `content` — the library list view (ArtifactCard/
// ArtifactLibrary.jsx, via fetchArtifactsReal) renders title/type/
// updated-at/conversation only, never the artifact body, so there is
// no reason to pull every artifact's full TEXT content (markdown,
// potentially large) back for a listing. findById below still selects
// `*`: opening one specific artifact genuinely needs its content.
const LIST_COLUMNS = [
  'id', 'college_id', 'user_id', 'conversation_id', 'source_message_id', 'title', 'artifact_type',
  'status', 'version_number', 'published_document_id', 'published_at', 'deleted_at',
  'created_at', 'updated_at',
].join(', ');

// limit/offset are opt-in, unlike conversationRepository.listByUser's
// own limit=50 default — a user's own artifact library is loaded in
// full by every existing caller (no "load more" UI on top of it yet),
// so an omitted limit here still returns everything, same as before
// this parameter existed. A future paginated caller can now ask for a
// page without any further repository change.
async function listByUser(client, userId, { limit, offset } = {}) {
  const values = [userId];
  let query = `SELECT ${LIST_COLUMNS} FROM artifacts WHERE user_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC`;
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

async function update(client, id, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return findById(client, id);
  }
  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => fields[key]);

  const result = await client.query(
    `UPDATE artifacts SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

module.exports = {
  create,
  findById,
  listByUser,
  update,
};
