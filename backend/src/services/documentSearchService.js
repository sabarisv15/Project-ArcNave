'use strict';

// Module 9 (AI) — RAG slice's Business Service. The search_documents AI
// tool (aiToolRegistry.js) wraps ONLY this file (CLAUDE.md rule 1: a
// thin wrapper over exactly one Business Service, no business logic of
// its own in the tool entry). This file owns two real jobs:
//
//   1. ingestDocument — chunk + embed an already-uploaded document's
//      text content (OCR'd first for images/PDFs — see below).
//      Deliberately NOT auto-wired into documentService.uploadDocument:
//      making it automatic would mean every document upload attempts a
//      real OCR pass plus a real network call to whatever
//      LLM provider happens to be configured in a given environment,
//      including inside the committed test suite (documents.test.js/
//      reports.test.js upload real files against live Postgres) —
//      exactly the "real API calls shouldn't run in CI" boundary this
//      project already draws elsewhere (see .ai/RESULT.md's live NIM
//      verification entry). ingestDocument is called explicitly
//      instead — a caller-invoked action (a backfill script, or a
//      future dedicated endpoint), same "or a separate backfill job"
//      option this slice's own task named. It is never called with raw
//      file bytes directly; it always goes back through
//      documentService.downloadDocument to get them (CLAUDE.md rule 2:
//      DocumentService remains the sole owner of file storage — this
//      file never touches fileStorage or documentRepository itself).
//   2. searchDocuments — embeds a caller's query, then runs a cosine-
//      distance nearest-chunks lookup scoped to the actor's own tenant
//      AND to the classifications aiClassificationAccess.
//      permittedClassifications(actor.role) actually allows — a
//      second, row-level filter independent of the Policy Gate's own
//      single tool-level classification check (AI-Governance.md §4).
//
// Retrieved chunk_text is exactly as untrusted as any other tool
// output (CLAUDE.md rule 9) — this file does nothing to that text
// beyond storing/retrieving it verbatim. aiToolRegistry's
// search_documents handler hands searchDocuments's return value
// straight into the same Context Builder / Prompt Safety Layer
// boundary every other tool result goes through (aiService.js's own
// pipeline) — nothing here "cleans" hostile text before embedding it,
// on the theory that embedding+cosine search is a similarity
// computation, not instruction execution; the untrusted-data boundary
// still gets applied exactly once, at the one place rule 9 already
// requires it, never twice and never skipped.
//
// A real OCR pipeline now exists (ocr/tesseractOcr.js, Tesseract via
// tesseract.js) for raster images (png/jpeg/bmp/tiff) — ingestDocument
// runs OCR-extracted text through the exact same chunk/embed/classify
// path a text/* document already used, no separate treatment. PDF now
// goes through ocr/pdfRasterizer.js first (poppler-utils' pdftoppm,
// see backend/Dockerfile) — each page becomes a PNG, OCR'd individually
// via the same tesseractOcr.extractTextFromImage, then concatenated in
// page order before entering the exact same pipeline. The rasterized
// page images are pure in-memory Buffers by the time they reach this
// file — pdfRasterizer.js's own temp dir (pdftoppm has no streaming
// API, only a file-based CLI contract) is created and removed entirely
// inside that one call; nothing here, or there, ever writes a
// rasterized page to DocumentService's permanent storage (CLAUDE.md
// rule 2 — DocumentService remains the sole owner of persisted files).

const documentService = require('./documentService');
const aiClassificationAccess = require('./aiClassificationAccess');
const configurationService = require('./configurationService');
const tesseractOcr = require('../ocr/tesseractOcr');
const pdfRasterizer = require('../ocr/pdfRasterizer');
const auditLogRepository = require('../repositories/auditLogRepository');
const aiDocumentChunkRepository = require('../repositories/aiDocumentChunkRepository');
const visibilityService = require('./visibilityService');

// searchDocuments given a missing/non-string query.
class DocumentSearchValidationError extends Error {}

// ingestDocument given a documentId that doesn't resolve to a real,
// non-deleted document (documentService.downloadDocument returned null).
class DocumentSearchNotFoundError extends Error {}

// CLAUDE.md rule 8, applied to this table's entire purpose (semantic
// search): an Aadhaar-doc_type document is never chunked/embedded
// here, full stop — refused at ingestion so no Aadhaar-derived
// embedding ever exists in this table to begin with, not filtered out
// later at query time.
class DocumentSearchAadhaarBlockedError extends Error {}

// A document whose mime_type is neither text-decodable, a
// Tesseract-supported raster image, nor application/pdf is refused,
// not mis-chunked from raw binary bytes.
class DocumentSearchUnsupportedContentError extends Error {}

// tesseract.js recognizes these directly, no rasterization step
// needed. application/pdf is handled separately (see ingestDocument)
// via ocr/pdfRasterizer.js first.
const OCR_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/bmp', 'image/tiff']);
const PDF_MIME_TYPE = 'application/pdf';

// Mirrors doc_type's own "known values documented here, not enforced
// by the DB" convention (see the Module 6 documents migration) — this
// map is the one, single source of "how sensitive is this doc_type,"
// consulted only here, at ingestion time; nothing enforces it as a
// CHECK constraint, same restraint every other doc_type-adjacent rule
// in this schema already takes.
//
// Conservative defaults, not sourced from BusinessRules.md (which
// names no document-type-level classification) — same "flagged,
// revisit via ADR" posture ADR-020 already takes for
// ROLE_CLASSIFICATION_ACCESS. scholarship/income/community/bank
// documents carry financial or caste/income information
// (AI-Governance.md §4 already places "Fee details" at Restricted);
// transfer/birth/disability certs and a plain photo are Confidential
// (personal, not financial); a college template belongs to the
// college, not a student, so Internal.
const DOC_TYPE_CLASSIFICATION = {
  [documentService.TEMPLATE_DOC_TYPE]: 'Internal',
  // Institutional Documents Phase 1 default categories (see migration
  // 1756400000000) — institution-wide, not personal/financial, so
  // 'Internal' (visible to staff-role AI search too, not just hod/
  // principal) rather than the DEFAULT_CLASSIFICATION fallback below,
  // which would otherwise silently make e.g. a public circular
  // invisible to staff-role AI search. A principal-created custom
  // category not listed here still falls to DEFAULT_CLASSIFICATION
  // until this map is extended for it — flagged, not solved, same
  // "known values documented here, not enforced by the DB" restraint
  // this file's own header comment already takes.
  curriculum: 'Internal',
  circular: 'Internal',
  academic_calendar: 'Internal',
  examination: 'Internal',
  policies: 'Internal',
  forms: 'Internal',
  notices: 'Internal',
  scholarship_cert: 'Restricted',
  income_cert: 'Restricted',
  community_cert: 'Restricted',
  bank_passbook: 'Restricted',
  transfer_cert: 'Confidential',
  birth_cert: 'Confidential',
  disability_cert: 'Confidential',
  photo: 'Confidential',
};

// Any doc_type not named above gets this conservative default rather
// than the least-restrictive one — same reasoning
// aiClassificationAccess's own file comment gives for defaulting
// narrow, not broad.
const DEFAULT_CLASSIFICATION = 'Confidential';

function classifyDocType(docType) {
  if (docType === documentService.AADHAAR_DOC_TYPE) {
    throw new DocumentSearchAadhaarBlockedError(
      `doc_type ${JSON.stringify(docType)} is never ingested for AI search (CLAUDE.md rule 8)`,
    );
  }
  return DOC_TYPE_CLASSIFICATION[docType] || DEFAULT_CLASSIFICATION;
}

// A pure, fixed-size splitter — no sentence/paragraph awareness.
// Deliberately simple: nvidia/nv-embedqa-e5-v5's own max input is 512
// tokens (see llmProvider.js), and CHUNK_SIZE_CHARS is small enough to
// stay well under that for any real-world text without needing a
// token-counting dependency this slice doesn't otherwise need.
const CHUNK_SIZE_CHARS = 1000;

function chunkText(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const chunks = [];
  for (let i = 0; i < trimmed.length; i += CHUNK_SIZE_CHARS) {
    chunks.push(trimmed.slice(i, i + CHUNK_SIZE_CHARS));
  }
  return chunks;
}

// The only Business Service call this file makes to get file bytes —
// documentService.downloadDocument, never fileStorage/documentRepository
// directly (CLAUDE.md rule 2). Chunks are embedded and inserted one at
// a time (not batched into a single embed() call): deliberately simple
// over throughput for this first slice — a real backfill job batching
// many chunks per request is a follow-up, not built speculatively here.
async function ingestDocument(client, documentId, { actorUserId } = {}) {
  const result = await documentService.downloadDocument(client, documentId);
  if (result === null) {
    throw new DocumentSearchNotFoundError(`no document found with id ${JSON.stringify(documentId)}`);
  }
  const { document, buffer } = result;

  // Three ways in: a text/* document is decoded directly (unchanged
  // from before); an OCR-supported image runs through tesseractOcr
  // directly; a PDF is rasterized to one PNG per page first
  // (pdfRasterizer.rasterizePdfToImages), each page OCR'd individually
  // in page order, then joined with a blank line between pages. Either
  // way, `text` below is untrusted, human/image-derived content
  // (CLAUDE.md rule 9), fed into the exact same chunk/embed pipeline
  // with no special trust granted to OCR output over typed text, and
  // no shortcut around classifyDocType's own Aadhaar-block/
  // classification rules below — a PDF is classified exactly like any
  // other doc_type, never treated as a special case.
  let text;
  if (typeof document.mime_type === 'string' && document.mime_type.startsWith('text/')) {
    text = buffer.toString('utf8');
  } else if (typeof document.mime_type === 'string' && OCR_IMAGE_MIME_TYPES.has(document.mime_type)) {
    ({ text } = await tesseractOcr.extractTextFromImage(buffer));
  } else if (document.mime_type === PDF_MIME_TYPE) {
    const pageImages = await pdfRasterizer.rasterizePdfToImages(buffer);
    const pageTexts = [];
    for (const pageImage of pageImages) {
      // eslint-disable-next-line no-await-in-loop
      const { text: pageText } = await tesseractOcr.extractTextFromImage(pageImage);
      pageTexts.push(pageText);
    }
    text = pageTexts.join('\n\n');
  } else {
    throw new DocumentSearchUnsupportedContentError(
      `document ${JSON.stringify(documentId)} has mime_type ${JSON.stringify(document.mime_type)}, which this `
      + 'slice cannot extract text from (only text/* content, OCR-supported images '
      + `[${[...OCR_IMAGE_MIME_TYPES].join(', ')}], and application/pdf are supported)`,
    );
  }

  const classification = classifyDocType(document.doc_type);
  const chunks = chunkText(text);
  const { adapter, config: aiConfig } = await configurationService.getAiConfig(client, document.college_id);

  for (let i = 0; i < chunks.length; i += 1) {
    const [embedding] = await adapter.embed(aiConfig, [chunks[i]], { inputType: 'passage' });
    await aiDocumentChunkRepository.create(client, {
      collegeId: document.college_id,
      documentId: document.id,
      chunkIndex: i,
      chunkText: chunks[i],
      classification,
      embedding,
    });
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: document.college_id,
    userId: actorUserId,
    action: 'ai_document_ingested',
    entity: 'documents',
    entityId: document.id,
    metadata: { chunkCount: chunks.length, classification },
  });

  return { documentId: document.id, chunkCount: chunks.length, classification };
}

const DEFAULT_SEARCH_LIMIT = 5;

// The search_documents tool's own Business Service call. Row-level
// classification filtering happens HERE, not in aiToolRegistry's tool
// entry (CLAUDE.md rule 1: no business logic in the tool wrapper
// itself) — an actor with no permitted classifications at all (an
// unrecognized role) gets an empty result set, not an error; searching
// and finding nothing is not a failure the way a Policy Gate rejection
// is.
// actor: either the legacy identityContext-ish shape ({userId, role,
// collegeId, ...}, no `actorId`/`tenantId` key) or an already-built
// ActorContext (Phase 4 Group (a) — aiActorContext.
// buildActorContextForIdentity; distinguished the same way
// visibilityService.isActorContext does, by presence of a key the
// legacy shape never has, `actorId`). Unlike the other 4 affected
// functions, `actor` here also supplies role/collegeId for
// classification/tenant lookups unrelated to visibility scoping, so
// both are resolved via the same actorId/tenantId-presence check
// rather than only at the getVisibleClassIds call.
async function searchDocuments(client, { query, limit } = {}, actor) {
  if (!query || typeof query !== 'string') {
    throw new DocumentSearchValidationError('query is required and must be a non-empty string');
  }

  const collegeId = 'tenantId' in actor ? actor.tenantId : actor.collegeId;
  const classifications = aiClassificationAccess.permittedClassifications(actor.role);
  // Same department/class scoping the GET /documents route already
  // enforces via visibilityService.assertCanViewStudent — without this,
  // an hod could reach a student document outside their own
  // department through AI search alone. null means unrestricted
  // (principal); see aiDocumentChunkRepository.search's own comment.
  const classIds = await visibilityService.getVisibleClassIds(
    client,
    'actorId' in actor
      ? actor
      : { actorUserId: actor.userId, actorRole: actor.role, collegeId: actor.collegeId },
  );
  const { adapter, config: aiConfig } = await configurationService.getAiConfig(client, collegeId);
  const [queryEmbedding] = await adapter.embed(aiConfig, [query], { inputType: 'query' });
  const rows = await aiDocumentChunkRepository.search(client, {
    collegeId,
    classifications,
    embedding: queryEmbedding,
    limit: limit || DEFAULT_SEARCH_LIMIT,
    classIds,
  });

  return rows.map((row) => ({
    documentId: row.document_id,
    docType: row.doc_type,
    fileName: row.file_name,
    classification: row.classification,
    chunkText: row.chunk_text,
    distance: row.distance,
  }));
}

module.exports = {
  DocumentSearchValidationError,
  DocumentSearchNotFoundError,
  DocumentSearchAadhaarBlockedError,
  DocumentSearchUnsupportedContentError,
  chunkText,
  classifyDocType,
  ingestDocument,
  searchDocuments,
};
