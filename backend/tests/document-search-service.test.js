'use strict';

// Unit tests for documentSearchService's business logic — no live
// Postgres, no live embedding provider: documentService.downloadDocument,
// embeddingService.embed/currentModel (ADR-030 P0 — this file no longer
// goes through configurationService.getAiConfig/an adapter at all),
// aiDocumentChunkRepository, and auditLogRepository are stubbed via
// node:test's built-in mock, same technique document-service.test.js/
// notification-service.test.js already use for their own dependencies.
// The real cosine-search/RLS/HNSW-index/live-embedding round-trip is a
// live verification concern (this session's own throwaway script
// against docker-compose Postgres + a real NIM key), not re-proven here.

const test = require('node:test');
const assert = require('node:assert/strict');
const documentService = require('../src/services/documentService');
const tesseractOcr = require('../src/ocr/tesseractOcr');
const pdfRasterizer = require('../src/ocr/pdfRasterizer');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const aiDocumentChunkRepository = require('../src/repositories/aiDocumentChunkRepository');
const documentSearchService = require('../src/services/documentSearchService');
const embeddingService = require('../src/services/embeddingService');
const visibilityService = require('../src/services/visibilityService');
const aiActorContext = require('../src/services/aiActorContext');
const aiClassificationAccess = require('../src/services/aiClassificationAccess');

// ADR-030 P0: documentSearchService now calls embeddingService.embed(texts,
// opts) directly (no adapter/config indirection — see that file's own
// "why this must be independent of a college's chat provider" comment),
// so this mocks embeddingService.embed itself, same boundary
// ai-tool-retrieval-service.test.js already mocks it at.
function mockEmbedding(t, embedImpl, { model = 'nvidia/nv-embedqa-e5-v5' } = {}) {
  const embedMock = t.mock.method(embeddingService, 'embed', embedImpl);
  const currentModelMock = t.mock.method(embeddingService, 'currentModel', () => model);
  t.after(() => {
    embedMock.mock.restore();
    currentModelMock.mock.restore();
  });
  return embedMock;
}

test('documentSearchService.chunkText', async (t) => {
  await t.test('splits text longer than the chunk size into multiple ordered chunks', () => {
    const text = 'a'.repeat(2500);
    const chunks = documentSearchService.chunkText(text);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].length, 1000);
    assert.equal(chunks[1].length, 1000);
    assert.equal(chunks[2].length, 500);
  });

  await t.test('a short text is a single chunk, trimmed', () => {
    assert.deepEqual(documentSearchService.chunkText('  hello world  '), ['hello world']);
  });

  await t.test('blank/whitespace-only text produces zero chunks', () => {
    assert.deepEqual(documentSearchService.chunkText('   \n\t  '), []);
  });
});

test('documentSearchService.classifyDocType', async (t) => {
  await t.test('refuses an aadhaar document — CLAUDE.md rule 8, never ingested for search', () => {
    assert.throws(
      () => documentSearchService.classifyDocType(documentService.AADHAAR_DOC_TYPE),
      documentSearchService.DocumentSearchAadhaarBlockedError,
    );
  });

  await t.test('maps a known sensitive doc_type to Restricted', () => {
    assert.equal(documentSearchService.classifyDocType('scholarship_cert'), 'Restricted');
  });

  await t.test('maps a known personal doc_type to Confidential', () => {
    assert.equal(documentSearchService.classifyDocType('birth_cert'), 'Confidential');
  });

  await t.test('maps the template doc_type to Internal', () => {
    assert.equal(documentSearchService.classifyDocType(documentService.TEMPLATE_DOC_TYPE), 'Internal');
  });

  await t.test('an unknown doc_type gets the conservative Confidential default, not Internal', () => {
    assert.equal(documentSearchService.classifyDocType('some_future_doc_type'), 'Confidential');
  });
});

function mockIngestHappyPath(t, { document, embedResult } = {}) {
  const downloadMock = t.mock.method(documentService, 'downloadDocument', async () => ({
    document: document || {
      id: 'doc-1', college_id: 'college-a', doc_type: 'birth_cert', mime_type: 'text/plain',
    },
    buffer: Buffer.from('hello world, this is a real document body.'),
  }));
  const embedMock = mockEmbedding(t, async () => embedResult || [[0.1, 0.2, 0.3]]);
  const createMock = t.mock.method(aiDocumentChunkRepository, 'create', async (client, fields) => ({ id: 'chunk-1', ...fields }));
  const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
  t.after(() => {
    downloadMock.mock.restore();
    createMock.mock.restore();
    auditMock.mock.restore();
  });
  return {
    downloadMock, embedMock, createMock, auditMock,
  };
}

test('documentSearchService.ingestDocument', async (t) => {
  await t.test('a missing document throws DocumentSearchNotFoundError', async () => {
    const downloadMock = t.mock.method(documentService, 'downloadDocument', async () => null);
    t.after(() => downloadMock.mock.restore());

    await assert.rejects(
      () => documentSearchService.ingestDocument({}, 'missing-id', { actorUserId: 'u1' }),
      documentSearchService.DocumentSearchNotFoundError,
    );
  });

  await t.test('an aadhaar document is refused before any embedding call', async () => {
    const { embedMock } = mockIngestHappyPath(t, {
      document: {
        id: 'doc-1', college_id: 'college-a', doc_type: documentService.AADHAAR_DOC_TYPE, mime_type: 'text/plain',
      },
    });

    await assert.rejects(
      () => documentSearchService.ingestDocument({}, 'doc-1', { actorUserId: 'u1' }),
      documentSearchService.DocumentSearchAadhaarBlockedError,
    );
    assert.equal(embedMock.mock.callCount(), 0);
  });

  await t.test('a multi-page PDF is rasterized page-by-page, each page OCR\'d, and the concatenated text chunked/embedded', async () => {
    const { embedMock, createMock, auditMock } = mockIngestHappyPath(t, {
      document: {
        id: 'doc-1', college_id: 'college-a', doc_type: 'birth_cert', mime_type: 'application/pdf',
      },
    });
    const rasterizeMock = t.mock.method(pdfRasterizer, 'rasterizePdfToImages', async () => [
      Buffer.from('page-1-png-bytes'), Buffer.from('page-2-png-bytes'), Buffer.from('page-3-png-bytes'),
    ]);
    const ocrMock = t.mock.method(tesseractOcr, 'extractTextFromPages', async (pageBuffers) => pageBuffers.map(
      (pageBuffer) => ({ text: `[text from ${pageBuffer.toString()}]`, confidence: 90 }),
    ));
    t.after(() => {
      rasterizeMock.mock.restore();
      ocrMock.mock.restore();
    });

    const result = await documentSearchService.ingestDocument({}, 'doc-1', { actorUserId: 'u1' });

    assert.equal(rasterizeMock.mock.callCount(), 1);
    assert.equal(ocrMock.mock.callCount(), 1);
    // Page order preserved: pages handed to extractTextFromPages in the order they were returned.
    const [pagesArg] = ocrMock.mock.calls[0].arguments;
    assert.equal(pagesArg[0].toString(), 'page-1-png-bytes');
    assert.equal(pagesArg[1].toString(), 'page-2-png-bytes');
    assert.equal(pagesArg[2].toString(), 'page-3-png-bytes');

    assert.equal(embedMock.mock.callCount(), 1);
    const [texts] = embedMock.mock.calls[0].arguments;
    assert.deepEqual(texts, ['[text from page-1-png-bytes]\n\n[text from page-2-png-bytes]\n\n[text from page-3-png-bytes]']);
    assert.equal(createMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'ai_document_ingested');
    assert.equal(result.chunkCount, 1);
  });

  await t.test('an Aadhaar-doc_type PDF is still refused (CLAUDE.md rule 8 applies after OCR too, no PDF shortcut)', async () => {
    const { embedMock } = mockIngestHappyPath(t, {
      document: {
        id: 'doc-1', college_id: 'college-a', doc_type: documentService.AADHAAR_DOC_TYPE, mime_type: 'application/pdf',
      },
    });
    const rasterizeMock = t.mock.method(pdfRasterizer, 'rasterizePdfToImages', async () => [Buffer.from('page-1')]);
    const ocrMock = t.mock.method(tesseractOcr, 'extractTextFromPages', async () => [{ text: 'some aadhaar text', confidence: 90 }]);
    t.after(() => {
      rasterizeMock.mock.restore();
      ocrMock.mock.restore();
    });

    await assert.rejects(
      () => documentSearchService.ingestDocument({}, 'doc-1', { actorUserId: 'u1' }),
      documentSearchService.DocumentSearchAadhaarBlockedError,
    );
    assert.equal(embedMock.mock.callCount(), 0);
  });

  await t.test('a PDF rasterization failure propagates, no embedding call', async () => {
    const { embedMock } = mockIngestHappyPath(t, {
      document: {
        id: 'doc-1', college_id: 'college-a', doc_type: 'birth_cert', mime_type: 'application/pdf',
      },
    });
    const rasterizeMock = t.mock.method(pdfRasterizer, 'rasterizePdfToImages', async () => { throw new pdfRasterizer.PdfRasterizationError('pdftoppm failed'); });
    t.after(() => rasterizeMock.mock.restore());

    await assert.rejects(
      () => documentSearchService.ingestDocument({}, 'doc-1', { actorUserId: 'u1' }),
      pdfRasterizer.PdfRasterizationError,
    );
    assert.equal(embedMock.mock.callCount(), 0);
  });

  await t.test('an OCR-supported image is run through tesseractOcr, then chunked/embedded exactly like a text document', async () => {
    const { embedMock, createMock, auditMock } = mockIngestHappyPath(t, {
      document: {
        id: 'doc-1', college_id: 'college-a', doc_type: 'birth_cert', mime_type: 'image/png',
      },
    });
    const ocrMock = t.mock.method(tesseractOcr, 'extractTextFromImage', async () => ({ text: 'text extracted from the image by Tesseract', confidence: 90 }));
    t.after(() => ocrMock.mock.restore());

    const result = await documentSearchService.ingestDocument({}, 'doc-1', { actorUserId: 'u1' });

    assert.equal(ocrMock.mock.callCount(), 1);
    assert.equal(embedMock.mock.callCount(), 1);
    const [texts] = embedMock.mock.calls[0].arguments;
    assert.deepEqual(texts, ['text extracted from the image by Tesseract']);
    assert.equal(createMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'ai_document_ingested');
    assert.equal(result.chunkCount, 1);
  });

  await t.test('an unsupported image type not in the OCR allow-list is still refused', async () => {
    const ocrMock = t.mock.method(tesseractOcr, 'extractTextFromImage', async () => { throw new Error('must not be called'); });
    const { embedMock } = mockIngestHappyPath(t, {
      document: {
        id: 'doc-1', college_id: 'college-a', doc_type: 'birth_cert', mime_type: 'image/webp',
      },
    });
    t.after(() => ocrMock.mock.restore());

    await assert.rejects(
      () => documentSearchService.ingestDocument({}, 'doc-1', { actorUserId: 'u1' }),
      documentSearchService.DocumentSearchUnsupportedContentError,
    );
    assert.equal(ocrMock.mock.callCount(), 0);
    assert.equal(embedMock.mock.callCount(), 0);
  });

  await t.test('a real text document is chunked, each chunk embedded as a passage, and stored with its classification', async () => {
    const { embedMock, createMock, auditMock } = mockIngestHappyPath(t);

    const result = await documentSearchService.ingestDocument({}, 'doc-1', { actorUserId: 'u1' });

    assert.equal(embedMock.mock.callCount(), 1);
    const [texts, options] = embedMock.mock.calls[0].arguments;
    assert.deepEqual(texts, ['hello world, this is a real document body.']);
    assert.equal(options.inputType, 'passage');

    assert.equal(createMock.mock.callCount(), 1);
    const [, fields] = createMock.mock.calls[0].arguments;
    assert.equal(fields.collegeId, 'college-a');
    assert.equal(fields.documentId, 'doc-1');
    assert.equal(fields.classification, 'Confidential');
    assert.deepEqual(fields.embedding, [0.1, 0.2, 0.3]);
    assert.equal(fields.model, 'nvidia/nv-embedqa-e5-v5', 'embedding model provenance (ADR-030 P0) is recorded on every chunk');

    assert.equal(auditMock.mock.callCount(), 1);
    const [, auditFields] = auditMock.mock.calls[0].arguments;
    assert.equal(auditFields.action, 'ai_document_ingested');

    assert.equal(result.chunkCount, 1);
    assert.equal(result.classification, 'Confidential');
  });
});

test('documentSearchService.searchDocuments', async (t) => {
  await t.test('rejects a missing/empty query before any embedding call', async () => {
    const embedMock = mockEmbedding(t, async () => [[0.1]]);

    await assert.rejects(
      () => documentSearchService.searchDocuments({}, { query: '' }, { role: 'principal', collegeId: 'college-a' }),
      documentSearchService.DocumentSearchValidationError,
    );
    assert.equal(embedMock.mock.callCount(), 0);
  });

  await t.test('embeds the query as a query (not a passage) and scopes the repository search to the actor tenant/classifications/visible classes', async () => {
    const embedMock = mockEmbedding(t, async () => [[0.4, 0.5, 0.6]]);
    const visibleClassIdsMock = t.mock.method(visibilityService, 'getVisibleClassIds', async () => ['class-1']);
    const searchMock = t.mock.method(aiDocumentChunkRepository, 'search', async () => [
      {
        document_id: 'doc-1', chunk_index: 0, chunk_text: 'a chunk', classification: 'Internal', doc_type: 'birth_cert', file_name: 'x.txt', distance: 0.1,
      },
    ]);
    t.after(() => {
      visibleClassIdsMock.mock.restore();
      searchMock.mock.restore();
    });

    const results = await documentSearchService.searchDocuments(
      {},
      { query: 'what is in my birth certificate?' },
      { userId: 'hod-1', role: 'hod', collegeId: 'college-a' },
    );

    assert.equal(embedMock.mock.callCount(), 1);
    const [, embedOptions] = embedMock.mock.calls[0].arguments;
    assert.equal(embedOptions.inputType, 'query');

    assert.equal(visibleClassIdsMock.mock.callCount(), 1);
    const [, visibleClassIdsArgs] = visibleClassIdsMock.mock.calls[0].arguments;
    assert.equal(visibleClassIdsArgs.actorUserId, 'hod-1');
    assert.equal(visibleClassIdsArgs.actorRole, 'hod');
    assert.equal(visibleClassIdsArgs.collegeId, 'college-a');

    assert.equal(searchMock.mock.callCount(), 1);
    const [, searchArgs] = searchMock.mock.calls[0].arguments;
    assert.equal(searchArgs.collegeId, 'college-a');
    assert.deepEqual(searchArgs.classifications, ['Internal', 'Confidential']);
    assert.deepEqual(searchArgs.embedding, [0.4, 0.5, 0.6]);
    assert.deepEqual(searchArgs.classIds, ['class-1']);
    assert.equal(searchArgs.model, 'nvidia/nv-embedqa-e5-v5', 'the search is scoped to the current embedding model (ADR-030 P0), never mixed across models');

    assert.equal(results.length, 1);
    assert.equal(results[0].chunkText, 'a chunk');
  });

  await t.test('a principal (unrestricted) gets null classIds, not a filtered list', async () => {
    mockEmbedding(t, async () => [[0.1, 0.2]]);
    const visibleClassIdsMock = t.mock.method(visibilityService, 'getVisibleClassIds', async () => null);
    const searchMock = t.mock.method(aiDocumentChunkRepository, 'search', async () => []);
    t.after(() => {
      visibleClassIdsMock.mock.restore();
      searchMock.mock.restore();
    });

    await documentSearchService.searchDocuments(
      {},
      { query: 'anything' },
      { userId: 'principal-1', role: 'principal', collegeId: 'college-a' },
    );

    const [, searchArgs] = searchMock.mock.calls[0].arguments;
    assert.equal(searchArgs.classIds, null);
  });

  await t.test('an unrecognized role gets no permitted classifications, so the repository is called with an empty list', async () => {
    mockEmbedding(t, async () => [[0.1]]);
    const visibleClassIdsMock = t.mock.method(visibilityService, 'getVisibleClassIds', async () => []);
    const searchMock = t.mock.method(aiDocumentChunkRepository, 'search', async () => []);
    t.after(() => {
      visibleClassIdsMock.mock.restore();
      searchMock.mock.restore();
    });

    const results = await documentSearchService.searchDocuments(
      {},
      { query: 'anything' },
      { userId: 'u1', role: 'someone_unrecognized', collegeId: 'college-a' },
    );

    const [, searchArgs] = searchMock.mock.calls[0].arguments;
    assert.deepEqual(searchArgs.classifications, []);
    assert.equal(results.length, 0);
  });

  // Phase 4 Group (c): an already-built ActorContext (Phase 4 Group (a)
  // — aiActorContext.buildActorContextForIdentity, what aiToolRegistry.js's
  // search_documents handler now passes, Group (b)) is forwarded straight
  // into getVisibleClassIds unchanged — never rebuilt into the legacy
  // {actorUserId, actorRole, collegeId} shape — and collegeId/role for
  // the rest of this function (aiConfig, classifications) resolve from
  // the ActorContext's own tenantId/role fields, not actor.collegeId/
  // actor.userId (which an ActorContext doesn't have).
  await t.test('an ActorContext-shaped actor (Institutional Class Tutor Position Account) is forwarded unchanged to getVisibleClassIds, scoped to the position\'s own class only', async () => {
    mockEmbedding(t, async () => [[0.2]]);
    const visibleClassIdsMock = t.mock.method(visibilityService, 'getVisibleClassIds', async () => ['class-1']);
    const searchMock = t.mock.method(aiDocumentChunkRepository, 'search', async () => []);
    t.after(() => {
      visibleClassIdsMock.mock.restore();
      searchMock.mock.restore();
    });

    const institutionalActorContext = aiActorContext.buildActorContextForIdentity({
      userId: 'tutor-u1', role: 'class_tutor', collegeId: 'college-a', departmentIds: [], classIds: ['class-1'], scopeLevel: 'class', positionAccountId: 'position-account-1',
    });

    await documentSearchService.searchDocuments({}, { query: 'anything' }, institutionalActorContext);

    assert.equal(visibleClassIdsMock.mock.callCount(), 1);
    const [, forwardedActorInput] = visibleClassIdsMock.mock.calls[0].arguments;
    assert.equal(forwardedActorInput, institutionalActorContext, 'the ActorContext must be forwarded by reference, never rebuilt into the legacy shape');

    const [, searchArgs] = searchMock.mock.calls[0].arguments;
    assert.equal(searchArgs.collegeId, 'college-a');
    assert.deepEqual(searchArgs.classifications, aiClassificationAccess.permittedClassifications('class_tutor'));
  });
});
