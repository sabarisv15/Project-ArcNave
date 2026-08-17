'use strict';

// Unit tests for ocrService's business-logic paths — no live Postgres,
// no real filesystem: documentService.downloadDocument and
// ocrResultRepository are stubbed via node:test's built-in mock, same
// technique as document-service.test.js/finance-service.test.js
// (works because ocrService always calls e.g.
// `ocrResultRepository.create(...)` as a fresh property lookup, never
// a destructured local). ocrService itself calls documentService, not
// documentRepository/fileStorage directly (CLAUDE.md rule 2:
// DocumentService is the sole owner of file storage) — so this file
// mocks that one seam, not the two layers underneath it.
//
// There is no external OCR provider to mock: ocrService's
// extractReadableText is a pure in-process text-extraction pass over
// whatever bytes documentService.downloadDocument hands back — no
// network call, nothing to stub beyond the document lookup itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const documentService = require('../src/services/documentService');
const ocrResultRepository = require('../src/repositories/ocrResultRepository');
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

  await t.test('goes through documentService.downloadDocument, never documentRepository/fileStorage directly', async () => {
    const downloadMock = mockDownload(t, {
      document: { id: 'doc-1', college_id: 'c1' },
      buffer: Buffer.from('Hello, this is readable text.', 'utf8'),
    });
    const createMock = mockCreate(t);
    t.after(() => {
      downloadMock.mock.restore();
      createMock.mock.restore();
    });

    await ocrService.processDocument({}, 'doc-1', { actorUserId: 'u1' });

    assert.equal(downloadMock.mock.callCount(), 1);
    assert.equal(downloadMock.mock.calls[0].arguments[1], 'doc-1');
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

  await t.test('extracts readable text and persists a completed result via ocrResultRepository', async () => {
    const downloadMock = mockDownload(t, {
      document: { id: 'doc-1', college_id: 'c1' },
      buffer: Buffer.from('Certificate of Completion\nAwarded to: Priya', 'utf8'),
    });
    const createMock = mockCreate(t);
    t.after(() => {
      downloadMock.mock.restore();
      createMock.mock.restore();
    });

    await ocrService.processDocument({}, 'doc-1', { actorUserId: 'u1' });

    assert.equal(createMock.mock.callCount(), 1);
    const fields = createMock.mock.calls[0].arguments[1];
    assert.equal(fields.collegeId, 'c1');
    assert.equal(fields.documentId, 'doc-1');
    assert.equal(fields.status, 'completed');
    assert.equal(fields.createdByUserId, 'u1');
    assert.match(fields.extractedText, /Certificate of Completion/);
    assert.match(fields.extractedText, /Awarded to: Priya/);
  });

  await t.test('strips non-printable bytes instead of persisting binary noise (an image/PDF fed in as raw bytes)', async () => {
    const downloadMock = mockDownload(t, {
      document: { id: 'doc-1', college_id: 'c1' },
      buffer: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02, 0xff]), // "%PDF" + binary junk
    });
    const createMock = mockCreate(t);
    t.after(() => {
      downloadMock.mock.restore();
      createMock.mock.restore();
    });

    await ocrService.processDocument({}, 'doc-1', { actorUserId: 'u1' });

    const fields = createMock.mock.calls[0].arguments[1];
    assert.doesNotMatch(fields.extractedText, /[\x00-\x08\x0B\x0C\x0E-\x1F]/);
  });

  await t.test('a document with no readable text is persisted as no_text_found, not completed', async () => {
    const downloadMock = mockDownload(t, {
      document: { id: 'doc-1', college_id: 'c1' },
      buffer: Buffer.from([0x00, 0x01, 0x02, 0x03]),
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
