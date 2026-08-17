'use strict';

// Query mechanics for `personal_document_folders` only — no business
// logic (personalDocumentFolderService's job). RLS handles tenant
// scoping; the (owner_user_id, name) unique constraint is what the
// service's create() relies on to reject a duplicate name (Postgres
// error code 23505), same pattern documentCategoryRepository's own
// create() already establishes for its own name uniqueness.

async function create(client, { collegeId, ownerUserId, name }) {
  const result = await client.query(
    `INSERT INTO personal_document_folders (college_id, owner_user_id, name)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [collegeId, ownerUserId, name],
  );
  return result.rows[0];
}

async function listByOwner(client, ownerUserId) {
  const result = await client.query(
    'SELECT * FROM personal_document_folders WHERE owner_user_id = $1 ORDER BY name',
    [ownerUserId],
  );
  return result.rows;
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM personal_document_folders WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function remove(client, id) {
  const result = await client.query('DELETE FROM personal_document_folders WHERE id = $1 RETURNING id', [id]);
  return result.rows.length > 0;
}

module.exports = {
  create, listByOwner, findById, remove,
};
