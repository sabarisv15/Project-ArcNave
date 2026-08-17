'use strict';

// Query mechanics for `student_admission_draft_documents` only — no
// business logic. One row per uploaded card slot (draft_id, doc_type);
// "Replace File" is the service layer's call on whether that means
// updateFile on the existing row or a fresh create — this file just
// exposes both primitives, same "mechanics here, decisions in the
// service" split every other repository in this codebase draws.

async function create(client, {
  collegeId, draftId, docType, storagePath, fileName, mimeType,
}) {
  const result = await client.query(
    `INSERT INTO student_admission_draft_documents
       (college_id, draft_id, doc_type, storage_path, file_name, mime_type, uploaded_at, extraction_status)
     VALUES ($1, $2, $3, $4, $5, $6, now(), 'uploaded')
     RETURNING *`,
    [collegeId, draftId, docType, storagePath, fileName, mimeType],
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM student_admission_draft_documents WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findByDraftId(client, draftId) {
  const result = await client.query(
    'SELECT * FROM student_admission_draft_documents WHERE draft_id = $1 ORDER BY created_at',
    [draftId],
  );
  return result.rows;
}

async function findByDraftIdAndDocType(client, draftId, docType) {
  const result = await client.query(
    'SELECT * FROM student_admission_draft_documents WHERE draft_id = $1 AND doc_type = $2',
    [draftId, docType],
  );
  return result.rows[0] || null;
}

// Move-to-X / Replace File: a new file replaces the old one in place —
// same row, fresh storage_path/file_name/mime_type, extraction_status
// reset to 'uploaded' (any prior extraction result is now stale).
// Discarding the OLD file's bytes (documentService.discardDraftAdmission
// Document) is the caller's job, done before this — this function only
// ever describes what the row should say now, never touches storage.
async function updateFile(client, id, { storagePath, fileName, mimeType }) {
  const result = await client.query(
    `UPDATE student_admission_draft_documents
     SET storage_path = $2, file_name = $3, mime_type = $4, uploaded_at = now(),
         extraction_status = 'uploaded', detected_doc_type = NULL, detection_confidence = NULL,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, storagePath, fileName, mimeType],
  );
  return result.rows[0] || null;
}

// classifyDocument's own result (documentExtractionService) — separate
// from updateExtractionResult below since classification runs
// synchronously right after upload, before any extraction job exists.
// Destructures `confidence` (not `detectionConfidence`) to match
// classifyDocument's actual return shape exactly — the two field names
// used to disagree here, so detection_confidence was silently written
// as NULL on every classification regardless of what the AI returned.
async function updateClassification(client, id, { detectedDocType, confidence }) {
  const result = await client.query(
    `UPDATE student_admission_draft_documents
     SET detected_doc_type = $2, detection_confidence = $3, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, detectedDocType, confidence],
  );
  return result.rows[0] || null;
}

// The background extraction job's own per-document write-back —
// extraction_status plus full engine/model/prompt traceability in one
// statement, since they're always set together (one extraction run).
async function updateExtractionResult(client, id, {
  extractionStatus, extractionJobId, ocrEngine, ocrEngineVersion, aiModel, aiModelVersion, promptVersion,
}) {
  const result = await client.query(
    `UPDATE student_admission_draft_documents
     SET extraction_status = $2, extraction_job_id = $3, ocr_engine = $4, ocr_engine_version = $5,
         ai_model = $6, ai_model_version = $7, prompt_version = $8, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, extractionStatus, extractionJobId, ocrEngine, ocrEngineVersion, aiModel, aiModelVersion, promptVersion],
  );
  return result.rows[0] || null;
}

async function deleteById(client, id) {
  const result = await client.query(
    'DELETE FROM student_admission_draft_documents WHERE id = $1 RETURNING *',
    [id],
  );
  return result.rows[0] || null;
}

module.exports = {
  create,
  findById,
  findByDraftId,
  findByDraftIdAndDocType,
  updateFile,
  updateClassification,
  updateExtractionResult,
  deleteById,
};
