'use strict';

// Query mechanics for `attachment_intelligence` only — no business logic
// (that lives in fileIntelligenceRouter.js / the services that call it,
// same "repository is pure SQL, service owns the rules" split
// documentRepository.js already establishes). Tenant scoping for
// id-keyed lookups relies on the table's RLS policy
// (current_setting('app.current_tenant', true) — see the migration),
// same as documentRepository.findById.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['documentId', 'document_id'],
  ['parentAttachmentId', 'parent_attachment_id'],
  ['category', 'category'],
  ['processingMode', 'processing_mode'],
  ['processingStatus', 'processing_status'],
  ['detectedMimeType', 'detected_mime_type'],
  ['declaredMimeType', 'declared_mime_type'],
  ['sha256', 'sha256'],
  ['provider', 'provider'],
  ['providerFileReference', 'provider_file_reference'],
  ['conversionArtifacts', 'conversion_artifacts'],
  ['extractedTextReference', 'extracted_text_reference'],
  ['extractionMetadata', 'extraction_metadata'],
  ['errorCode', 'error_code'],
  ['errorMessageSafe', 'error_message_safe'],
];

// JSONB columns need an explicit ::jsonb cast when the value is supplied
// as a JS object/array — pg's default serialization otherwise sends a
// plain string Postgres cannot implicitly coerce for these columns.
const JSONB_COLUMNS = new Set(['conversion_artifacts', 'extraction_metadata']);

function toParamExpr(column, index) {
  return JSONB_COLUMNS.has(column) ? `$${index}::jsonb` : `$${index}`;
}

function toParamValue(column, value) {
  if (JSONB_COLUMNS.has(column) && value !== null && value !== undefined && typeof value !== 'string') {
    return JSON.stringify(value);
  }
  return value;
}

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key, column]) => toParamValue(column, fields[key]));
  const placeholders = entries.map(([, column], i) => toParamExpr(column, i + 1));

  const result = await client.query(
    `INSERT INTO attachment_intelligence (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query(
    'SELECT * FROM attachment_intelligence WHERE id = $1',
    [id],
  );
  return result.rows[0] || null;
}

async function findByDocumentId(client, documentId) {
  const result = await client.query(
    'SELECT * FROM attachment_intelligence WHERE document_id = $1 ORDER BY created_at ASC',
    [documentId],
  );
  return result.rows;
}

// The recursive-unpack audit trail — every child a given archive
// attachment produced, in the order they were extracted.
async function findByParentAttachmentId(client, parentAttachmentId) {
  const result = await client.query(
    'SELECT * FROM attachment_intelligence WHERE parent_attachment_id = $1 ORDER BY created_at ASC',
    [parentAttachmentId],
  );
  return result.rows;
}

async function update(client, id, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return findById(client, id);
  }

  const setClauses = entries.map(([, column], i) => `${column} = ${toParamExpr(column, i + 2)}`);
  const values = entries.map(([key, column]) => toParamValue(column, fields[key]));

  const result = await client.query(
    `UPDATE attachment_intelligence SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

module.exports = {
  create,
  findById,
  findByDocumentId,
  findByParentAttachmentId,
  update,
};
