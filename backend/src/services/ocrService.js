'use strict';

const documentService = require('./documentService');
const ocrResultRepository = require('../repositories/ocrResultRepository');
const documentExtractionService = require('./documentExtractionService');

class OcrValidationError extends Error {}
class OcrDocumentNotFoundError extends Error {}

const TEXT_MIME_PREFIX = 'text/';

// Pre-launch correctness fix: this previously ran extractReadableText
// (a raw byte-strip of non-ASCII characters) against ANY buffer,
// including real scanned images/PDFs — for those, byte-stripping
// produces near-garbage that got persisted with status: 'completed'
// and served back via GET /documents/:id/ocr as if it were genuine
// OCR output. A real Tesseract-backed pipeline already exists
// (documentExtractionService.runOcr, used by documentSearchService's
// RAG ingestion and the admission-draft extraction flow) — this now
// routes to it instead of re-implementing or faking anything new.
//
// text/* is handled separately, not via runOcr (which only supports
// image/PDF and throws otherwise): a plain-text document needs no
// OCR at all, so it's decoded directly — the same real, honest
// pattern documentSearchService.ingestDocument's own text/* branch
// already uses, not a second fake path.
//
// Any mime type runOcr genuinely can't process (docx/xlsx/pptx/etc.)
// is now an honest 'unsupported_mime_type' result — never fabricated
// text standing in for a real extraction that didn't happen.
async function extractText(client, { document, buffer }) {
  const mimeType = document.mime_type;
  if (typeof mimeType === 'string' && mimeType.startsWith(TEXT_MIME_PREFIX)) {
    const text = buffer.toString('utf8').trim();
    return { extractedText: text, status: text ? 'completed' : 'no_text_found' };
  }

  try {
    const lang = await documentExtractionService.resolveOcrLang(client, document.college_id);
    const ocrResult = await documentExtractionService.runOcr(buffer, mimeType, { lang });
    const text = ocrResult.text || '';
    return { extractedText: text, status: text ? 'completed' : 'no_text_found' };
  } catch (err) {
    if (err instanceof documentExtractionService.DocumentExtractionValidationError) {
      return { extractedText: '', status: 'unsupported_mime_type' };
    }
    throw err;
  }
}

async function processDocument(client, documentId, { actorUserId } = {}) {
  if (!documentId || !actorUserId) {
    throw new OcrValidationError('documentId and actorUserId are required');
  }

  const result = await documentService.downloadDocument(client, documentId);
  if (result === null) {
    throw new OcrDocumentNotFoundError(`document ${JSON.stringify(documentId)} does not exist`);
  }

  const { extractedText, status } = await extractText(client, result);
  return ocrResultRepository.create(client, {
    collegeId: result.document.college_id,
    documentId,
    extractedText,
    status,
    createdByUserId: actorUserId,
  });
}

async function listForDocument(client, documentId) {
  return ocrResultRepository.findByDocumentId(client, documentId);
}

module.exports = {
  OcrValidationError,
  OcrDocumentNotFoundError,
  processDocument,
  listForDocument,
};
