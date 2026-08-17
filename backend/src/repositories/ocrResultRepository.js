'use strict';

async function create(client, { collegeId, documentId, extractedText, status, createdByUserId }) {
  const result = await client.query(
    `INSERT INTO ocr_results (college_id, document_id, extracted_text, status, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [collegeId, documentId, extractedText, status, createdByUserId],
  );
  return result.rows[0];
}

async function findByDocumentId(client, documentId) {
  const result = await client.query(
    'SELECT * FROM ocr_results WHERE document_id = $1 ORDER BY created_at DESC',
    [documentId],
  );
  return result.rows;
}

module.exports = { create, findByDocumentId };
