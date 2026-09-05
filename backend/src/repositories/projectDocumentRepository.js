'use strict';

// Query mechanics for `project_documents` only — a reference-only link
// table (see the project-instructions-and-documents migration's own
// comment), never a copy of document content. No update function: a
// link either exists or doesn't, same shape as
// personalDocumentFolderRepository's own owner-scoped rows.

async function create(client, { collegeId, projectId, documentId, addedByUserId }) {
  const result = await client.query(
    `INSERT INTO project_documents (college_id, project_id, document_id, added_by_user_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [collegeId, projectId, documentId, addedByUserId],
  );
  return result.rows[0];
}

// Joined with `documents` so a caller gets enough to render a list
// (title/file_name) without a second round-trip per row.
async function listByProject(client, projectId) {
  const result = await client.query(
    `SELECT pd.*, d.title, d.file_name, d.mime_type
       FROM project_documents pd
       JOIN documents d ON d.id = pd.document_id
      WHERE pd.project_id = $1
      ORDER BY pd.created_at DESC`,
    [projectId],
  );
  return result.rows;
}

async function findByProjectAndDocument(client, projectId, documentId) {
  const result = await client.query('SELECT * FROM project_documents WHERE project_id = $1 AND document_id = $2', [
    projectId,
    documentId,
  ]);
  return result.rows[0] || null;
}

async function remove(client, projectId, documentId) {
  await client.query('DELETE FROM project_documents WHERE project_id = $1 AND document_id = $2', [
    projectId,
    documentId,
  ]);
}

module.exports = {
  create,
  listByProject,
  findByProjectAndDocument,
  remove,
};
