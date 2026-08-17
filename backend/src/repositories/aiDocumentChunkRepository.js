'use strict';

// Query mechanics for `ai_document_chunks` only — no business logic
// (chunking, embedding, doc_type -> classification mapping, and the
// Aadhaar ingestion block all live in documentSearchService.js, not
// here, same repository/service split every other pair in this
// codebase already keeps).
//
// embedding is always passed/read as a plain JS array of numbers;
// toVectorLiteral below is the ONE place that knows pgvector's own
// text literal format ('[0.1,0.2,...]'), cast with an explicit
// ::vector in the SQL text itself — node-pg has no built-in pgvector
// type, so the cast must live in the query string, not a bound
// parameter.

function toVectorLiteral(embedding) {
  return `[${embedding.join(',')}]`;
}

async function create(client, {
  collegeId, documentId, chunkIndex, chunkText, classification, embedding,
}) {
  const result = await client.query(
    `INSERT INTO ai_document_chunks (college_id, document_id, chunk_index, chunk_text, classification, embedding)
     VALUES ($1, $2, $3, $4, $5, $6::vector)
     RETURNING *`,
    [collegeId, documentId, chunkIndex, chunkText, classification, toVectorLiteral(embedding)],
  );
  return result.rows[0];
}

async function findByDocumentId(client, documentId) {
  const result = await client.query(
    'SELECT * FROM ai_document_chunks WHERE document_id = $1 ORDER BY chunk_index',
    [documentId],
  );
  return result.rows;
}

// The one real read searchDocuments needs: nearest chunks by cosine
// distance (`<=>`, pgvector's cosine-distance operator — smaller is
// more similar), scoped to the actor's own tenant and to whichever
// classifications they're permitted to see. Joined to documents so a
// soft-deleted source document's chunks never surface (deleted_at IS
// NULL there, not duplicated as a second deleted_at on this table —
// see the migration's own comment). An empty classifications array
// (an actor with no permitted classification at all) short-circuits
// before the query — `= ANY('{}')` would just match nothing anyway,
// but this avoids sending a query for a result the caller already
// knows will be empty.
// classIds mirrors visibilityService.getVisibleClassIds's own contract:
// null means unrestricted (principal/system caller), an array restricts
// to chunks whose source document is either not student-scoped
// (document.student_id IS NULL — templates, college-wide docs) or
// belongs to a student in one of those classes. An empty array (a hod
// with no verified department) correctly excludes every student-scoped
// document while still allowing unscoped ones.
async function search(client, {
  collegeId, classifications, embedding, limit, classIds,
}) {
  if (!classifications || classifications.length === 0) {
    return [];
  }
  const result = await client.query(
    `SELECT c.id, c.document_id, c.chunk_index, c.chunk_text, c.classification,
            d.doc_type, d.file_name,
            c.embedding <=> $3::vector AS distance
     FROM ai_document_chunks c
     JOIN documents d ON d.id = c.document_id AND d.deleted_at IS NULL
     LEFT JOIN students s ON s.id = d.student_id
     WHERE c.college_id = $1
       AND c.classification = ANY($2)
       AND ($5::uuid[] IS NULL OR d.student_id IS NULL OR s.class_id = ANY($5))
     ORDER BY c.embedding <=> $3::vector
     LIMIT $4`,
    [collegeId, classifications, toVectorLiteral(embedding), limit, classIds === null || classIds === undefined ? null : classIds],
  );
  return result.rows;
}

module.exports = { create, findByDocumentId, search };
