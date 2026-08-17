'use strict';

const documentService = require('./documentService');
const ocrResultRepository = require('../repositories/ocrResultRepository');

class OcrValidationError extends Error {}
class OcrDocumentNotFoundError extends Error {}

function extractReadableText(buffer) {
  return buffer.toString('utf8')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function processDocument(client, documentId, { actorUserId } = {}) {
  if (!documentId || !actorUserId) {
    throw new OcrValidationError('documentId and actorUserId are required');
  }

  const result = await documentService.downloadDocument(client, documentId);
  if (result === null) {
    throw new OcrDocumentNotFoundError(`document ${JSON.stringify(documentId)} does not exist`);
  }

  const extractedText = extractReadableText(result.buffer);
  return ocrResultRepository.create(client, {
    collegeId: result.document.college_id,
    documentId,
    extractedText,
    status: extractedText ? 'completed' : 'no_text_found',
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
