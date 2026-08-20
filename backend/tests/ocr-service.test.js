'use strict';

// Unit tests for ocrService's business-logic paths — no live Postgres,
// no real filesystem: documentService.downloadDocument, ocrResultRepository,
// and documentExtractionService are stubbed via node:test's built-in
// mock, same technique as document-service.test.js/finance-service.test.js
// (works because ocrService always calls e.g.
// `ocrResultRepository.create(...)` as a fresh property lookup, never
// a destructured local).
//
// Pre-launch correctness fix (second optimization pass): ocrService used
// to run a raw byte-strip over ANY buffer, including real scanned
// images/PDFs, silently persisting near-garbage as if it were genuine
// OCR output. It now routes image/PDF mime types to the real
// Tesseract-backed pipeline (documentExtractionService.runOcr),
// decodes text/* directly (no OCR needed), and returns an honest
// 'unsupported_mime_type' result for anything else — never fabricated
// text standing in for a real extraction that didn't happen.

const test = require('node:test');
const assert = require('node:assert/strict');
const documentService = require('../src/services/documentService');
const ocrResultRepository = require('../src/repositories/ocrResultRepository');
const documentExtractionService = require('../src/services/documentExtractionService');
const ocrService = require('../src/services/ocrService');

function mockDownload(t, result) {
  return t.mock.method(documentService, 'downloadDocument', async () => result);
}

function mockCreate(t, result) {
  return t.mock.method(ocrResultRepository, 'create', async (client, fields) => (
    result || { id: 'ocr-1', ...fields }
  ));
}

test('ocrService.processDocument', async (t) => {
  await t.test('rejects a missing documentId without calling DocumentService', async () => {
    const downloadMock = mockDownload(t, null);
    t.after(() => downloadMock.mock.restore());

    await assert.rejects(
      () => ocrService.processDocument({}, undefined, { actorUserId: 'u1' }),
      ocrService.OcrValidationError,
    );
    assert.equal(downloadMock.mock.callCount(), 0);
  });

  await t.test('rejects a missing actorUserId without calling DocumentService', async () => {
    const downloadMock = mockDownload(t, null);
    t.after(() => downloadMock.mock.restore());

    await assert.rejects(
      () => ocrService.processDocument({}, 'doc-1', {}),
      ocrService.OcrValidationError,
    );
    assert.equal(downloadMock.mock.callCount(), 0);
  });

  await t.test('unsupported/unknown document (downloadDocument returns null) is a real 404-shaped error, not a crash', async () => {
    const downloadMock = mockDownload(t, null);
    const createMock = mockCreate(t);
    t.after(() => {
      downloadMock.mock.restore();
      createMock.mock.restore();
    });

    await assert.rejects(
      () => ocrService.processDocument({}, 'missing-doc', { actorUserId: 'u1' }),
      ocrService.OcrDocumentNotFoundError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('text/* documents are decoded directly, never routed through OCR', async () => {
    const downloadMock = mockDownload(t, {
      document: { id: 'doc-1', college_id: 'c1', mime_type: 'text/plain' },
      buffer: Buffer.from('Certificate of Completion\nAwarded to: Priya', 'utf8'),
    });
    const createMock = mockCreate(t);
    const runOcrMock = t.mock.method(documentExtractionService, 'runOcr', async () => {
      throw new Error('runOcr must never be called for a text/* document');
    });
    t.after(() => {
      downloadMock.mock.restore();
      createMock.mock.restore();
      runOcrMock.mock.restore();
    });

    await ocrService.processDocument({}, 'doc-1', { actorUserId: 'u1' });

    assert.equal(runOcrMock.mock.callCount(), 0);
    assert.equal(createMock.mock.callCount(), 1);
    const fields = createMock.mock.calls[0].arguments[1];
    assert.equal(fields.collegeId, 'c1');
    assert.equal(fields.documentId, 'doc-1');
    assert.equal(fields.status, 'completed');
    assert.match(fields.extractedText, /Certificate of Completion/);
    assert.match(fields.extractedText, /Awarded to: Priya/);
  });

  await t.test('an empty text/* document is persisted as no_text_found, not completed', async () => {
    const downloadMock = mockDownload(t, {
      document: { id: 'doc-1', college_id: 'c1', mime_type: 'text/plain' },
      buffer: Buffer.from('   \n  ', 'utf8'),
    });
    const createMock = mockCreate(t);
    t.after(() => {
      downloadMock.mock.restore();
      createMock.mock.restore();
    });

    await ocrService.processDocument({}, 'doc-1', { actorUserId: 'u1' });

    const fields = createMock.mock.calls[0].arguments[1];
    assert.equal(fields.status, 'no_text_found');
    assert.equal(fields.extractedText, '');
  });

  await t.test('image/PDF documents are routed to the real Tesseract-backed pipeline, never byte-stripped', async () => {
    const downloadMock = mockDownload(t, {
      document: { id: 'doc-1', college_id: 'c1', mime_type: 'application/pdf' },
      buffer: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02, 0xff]), // "%PDF" + binary junk
    });
    const createMock = mockCreate(t);
    const langMock = t.mock.method(documentExtractionService, 'resolveOcrLang', async () => 'eng');
    const runOcrMock = t.mock.method(documentExtractionService, 'runOcr', async (buffer, mimeType, opts) => {
      assert.equal(mimeType, 'application/pdf');
      assert.equal(opts.lang, 'eng');
      return { text: 'Real Tesseract output', ocrConfidence: 92, ocrEngine: 'tesseract.js', ocrEngineVersion: '7.0.0' };
    });
    t.after(() => {
      downloadMock.mock.restore();
      createMock.mock.restore();
      langMock.mock.restore();
      runOcrMock.mock.restore();
    });

    await ocrService.processDocument({}, 'doc-1', { actorUserId: 'u1' });

    assert.equal(runOcrMock.mock.callCount(), 1);
    const fields = createMock.mock.calls[0].arguments[1];
    assert.equal(fields.status, 'completed');
    assert.equal(fields.extractedText, 'Real Tesseract output');
    // Never the old byte-stripping behavior — real OCR text has no
    // resemblance to the raw "%PDF" + binary-junk input buffer.
    assert.doesNotMatch(fields.extractedText, /%PDF/);
  });

  await t.test('a mime type OCR cannot process is an honest unsupported_mime_type result, never fabricated text', async () => {
    const downloadMock = mockDownload(t, {
      document: { id: 'doc-1', college_id: 'c1', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]), // a real .docx's zip magic bytes
    });
    const createMock = mockCreate(t);
    const langMock = t.mock.method(documentExtractionService, 'resolveOcrLang', async () => 'eng');
    // Explicitly mocked (not left to the real implementation) so this
    // test is self-contained regardless of test-runner mock-restore
    // ordering across sibling subtests — same real error class runOcr
    // itself throws for a mime type outside [image/*, application/pdf].
    const runOcrMock = t.mock.method(documentExtractionService, 'runOcr', async () => {
      throw new documentExtractionService.DocumentExtractionValidationError('mimeType is not supported for OCR');
    });
    t.after(() => {
      downloadMock.mock.restore();
      createMock.mock.restore();
      langMock.mock.restore();
      runOcrMock.mock.restore();
    });

    await ocrService.processDocument({}, 'doc-1', { actorUserId: 'u1' });

    const fields = createMock.mock.calls[0].arguments[1];
    assert.equal(fields.status, 'unsupported_mime_type');
    assert.equal(fields.extractedText, '');
  });
});

test('ocrService.listForDocument', async (t) => {
  await t.test('is a thin pass-through to ocrResultRepository.findByDocumentId', async () => {
    const rows = [{ id: 'ocr-1', document_id: 'doc-1' }];
    const findMock = t.mock.method(ocrResultRepository, 'findByDocumentId', async (client, documentId) => {
      assert.equal(documentId, 'doc-1');
      return rows;
    });
    t.after(() => findMock.mock.restore());

    const result = await ocrService.listForDocument({}, 'doc-1');
    assert.equal(findMock.mock.callCount(), 1);
    assert.equal(result, rows);
  });
});
