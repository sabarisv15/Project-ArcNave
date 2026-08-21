'use strict';

// Query mechanics for `personal_document_folders` only — no business
// logic (personalDocumentFolderService's job). RLS handles tenant
// scoping; the (owner_user_id, name) unique constraint is what the
// service's create() relies on to reject a duplicate name (Postgres
// error code 23505), same pattern documentCategoryRepository's own
// create() already establishes for its own name uniqueness.

async function create(client, {
  collegeId, ownerUserId, name, parentId,
}) {
  const result = await client.query(
    `INSERT INTO personal_document_folders (college_id, owner_user_id, name, parent_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [collegeId, ownerUserId, name, parentId ?? null],
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

// Rename and/or move (change parent_id) — the only two mutable fields.
// Same entries-filter shape documentRepository.update already uses:
// an omitted field is left untouched, not overwritten with NULL. name
// undefined + parentId undefined never happens in practice (the
// service always resolves at least one before calling this), but the
// filter makes that safe regardless.
async function update(client, id, { name, parentId }) {
  const setClauses = [];
  const values = [];
  if (name !== undefined) {
    values.push(name);
    setClauses.push(`name = $${values.length}`);
  }
  if (parentId !== undefined) {
    values.push(parentId);
    setClauses.push(`parent_id = $${values.length}`);
  }
  if (setClauses.length === 0) {
    return findById(client, id);
  }
  values.push(id);
  const result = await client.query(
    `UPDATE personal_document_folders SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return result.rows[0] || null;
}

async function remove(client, id) {
  const result = await client.query('DELETE FROM personal_document_folders WHERE id = $1 RETURNING id', [id]);
  return result.rows.length > 0;
}

module.exports = {
  create, listByOwner, findById, update, remove,
};
