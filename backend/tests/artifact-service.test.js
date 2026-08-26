'use strict';

// Unit tests for ArtifactService's pure business-logic paths — no live
// Postgres needed, same mocking convention as
// staff-work-history-service.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const artifactRepository = require('../src/repositories/artifactRepository');
const artifactVersionRepository = require('../src/repositories/artifactVersionRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const documentService = require('../src/services/documentService');
const artifactService = require('../src/services/artifactService');

test('ArtifactService (no DB)', async (t) => {
  await t.test('listOwnArtifacts passes limit/offset straight through to artifactRepository', async () => {
    const listMock = t.mock.method(artifactRepository, 'listByUser', async (client, userId, opts) => {
      assert.equal(userId, 'u1');
      assert.deepEqual(opts, { limit: 20, offset: 10 });
      return [];
    });
    t.after(() => listMock.mock.restore());

    await artifactService.listOwnArtifacts({}, { userId: 'u1', limit: 20, offset: 10 });
    assert.equal(listMock.mock.calls.length, 1);
  });

  await t.test('listOwnArtifacts with no limit/offset passes undefined through, not a default — the full library is still returned', async () => {
    const listMock = t.mock.method(artifactRepository, 'listByUser', async (client, userId, opts) => {
      assert.deepEqual(opts, { limit: undefined, offset: undefined });
      return [];
    });
    t.after(() => listMock.mock.restore());

    await artifactService.listOwnArtifacts({}, { userId: 'u1' });
  });

  await t.test('createArtifact requires title and content', async () => {
    await assert.rejects(
      () => artifactService.createArtifact({}, { title: '', content: 'x' }, { userId: 'u1', collegeId: 'c1' }),
      artifactService.ArtifactValidationError,
    );
    await assert.rejects(
      () => artifactService.createArtifact({}, { title: 'x', content: '' }, { userId: 'u1', collegeId: 'c1' }),
      artifactService.ArtifactValidationError,
    );
  });

  await t.test('createArtifact writes both artifacts and artifact_versions at version 1, and audits it', async () => {
    const createMock = t.mock.method(artifactRepository, 'create', async (client, fields) => {
      assert.equal(fields.versionNumber, 1);
      return { id: 'a1', college_id: 'c1', version_number: 1, ...fields };
    });
    const versionCreateMock = t.mock.method(artifactVersionRepository, 'create', async (client, fields) => {
      assert.deepEqual(fields, {
        collegeId: 'c1', artifactId: 'a1', versionNumber: 1, content: 'draft text', createdByUserId: 'u1',
      });
      return { id: 'v1', ...fields };
    });
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => { createMock.mock.restore(); versionCreateMock.mock.restore(); auditMock.mock.restore(); });

    const result = await artifactService.createArtifact({}, { title: 'Circular draft', content: 'draft text' }, { userId: 'u1', collegeId: 'c1' });
    assert.equal(result.id, 'a1');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'artifact_created');
  });

  await t.test('resolveOwnArtifact throws ArtifactForbiddenError for another user\'s artifact', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({ id: 'a1', user_id: 'OTHER', deleted_at: null }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => artifactService.getOwnArtifact({}, 'a1', { userId: 'u1' }),
      artifactService.ArtifactForbiddenError,
    );
  });

  await t.test('a soft-deleted artifact is unreachable via getOwnArtifact', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({ id: 'a1', user_id: 'u1', deleted_at: new Date() }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => artifactService.getOwnArtifact({}, 'a1', { userId: 'u1' }),
      artifactService.ArtifactNotFoundError,
    );
  });

  await t.test('updateArtifact bumps version_number and writes a new artifact_versions row only when content changes', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({
      id: 'a1', user_id: 'u1', college_id: 'c1', deleted_at: null, status: 'draft', content: 'old', version_number: 1,
    }));
    const updateMock = t.mock.method(artifactRepository, 'update', async (client, id, patch) => {
      assert.equal(patch.versionNumber, 2);
      return { id, version_number: 2, ...patch };
    });
    const versionCreateMock = t.mock.method(artifactVersionRepository, 'create', async (client, fields) => {
      assert.equal(fields.versionNumber, 2);
      assert.equal(fields.content, 'new');
      return { id: 'v2', ...fields };
    });
    t.after(() => { findMock.mock.restore(); updateMock.mock.restore(); versionCreateMock.mock.restore(); });

    await artifactService.updateArtifact({}, 'a1', { content: 'new' }, { userId: 'u1' });
    assert.equal(versionCreateMock.mock.calls.length, 1);
  });

  await t.test('updateArtifact with only a title change does not touch version history', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({
      id: 'a1', user_id: 'u1', college_id: 'c1', deleted_at: null, status: 'draft', content: 'old', version_number: 1,
    }));
    const updateMock = t.mock.method(artifactRepository, 'update', async (client, id, patch) => ({ id, version_number: 1, ...patch }));
    const versionCreateMock = t.mock.method(artifactVersionRepository, 'create', async () => { throw new Error('should not be called'); });
    t.after(() => { findMock.mock.restore(); updateMock.mock.restore(); versionCreateMock.mock.restore(); });

    await artifactService.updateArtifact({}, 'a1', { title: 'Renamed' }, { userId: 'u1' });
    assert.equal(versionCreateMock.mock.calls.length, 0);
  });

  await t.test('updateArtifact throws ArtifactAlreadyPublishedError once published', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({ id: 'a1', user_id: 'u1', deleted_at: null, status: 'published' }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => artifactService.updateArtifact({}, 'a1', { content: 'x' }, { userId: 'u1' }),
      artifactService.ArtifactAlreadyPublishedError,
    );
  });

  await t.test('deleteArtifact writes deleted_at via artifactRepository.update, not a remove function, and audits it', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({ id: 'a1', user_id: 'u1', college_id: 'c1', deleted_at: null, status: 'draft' }));
    const updateMock = t.mock.method(artifactRepository, 'update', async (client, id, patch) => {
      assert.ok(patch.deletedAt instanceof Date);
      return { id, ...patch };
    });
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => { findMock.mock.restore(); updateMock.mock.restore(); auditMock.mock.restore(); });

    await artifactService.deleteArtifact({}, 'a1', { userId: 'u1' });
    assert.equal(updateMock.mock.calls.length, 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'artifact_deleted');
  });

  await t.test('deleteArtifact throws ArtifactAlreadyPublishedError once published', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({ id: 'a1', user_id: 'u1', deleted_at: null, status: 'published' }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => artifactService.deleteArtifact({}, 'a1', { userId: 'u1' }),
      artifactService.ArtifactAlreadyPublishedError,
    );
  });

  await t.test('publishArtifact calls documentService.uploadPersonalDocument with the expected shape, then updates the artifact and audits it', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({
      id: 'a1', user_id: 'u1', college_id: 'c1', deleted_at: null, status: 'draft', title: 'Circular', content: 'body text',
    }));
    const uploadMock = t.mock.method(documentService, 'uploadPersonalDocument', async (client, args, opts) => {
      assert.equal(args.collegeId, 'c1');
      assert.equal(args.title, 'Circular');
      assert.equal(args.folderName, 'AI Artifacts');
      assert.equal(args.fileName, 'Circular.md');
      assert.equal(args.mimeType, 'text/markdown');
      assert.equal(Buffer.isBuffer(args.fileBuffer), true);
      assert.equal(args.fileBuffer.toString('utf8'), 'body text');
      assert.equal(opts.actorUserId, 'u1');
      return { id: 'doc1' };
    });
    const updateMock = t.mock.method(artifactRepository, 'update', async (client, id, patch) => {
      assert.equal(patch.status, 'published');
      assert.equal(patch.publishedDocumentId, 'doc1');
      return { id, ...patch };
    });
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore(); uploadMock.mock.restore(); updateMock.mock.restore(); auditMock.mock.restore();
    });

    const result = await artifactService.publishArtifact({}, 'a1', { userId: 'u1', collegeId: 'c1' });
    assert.equal(result.status, 'published');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'artifact_published');
    assert.deepEqual(auditMock.mock.calls[0].arguments[1].metadata, { documentId: 'doc1', format: 'markdown' });
  });

  await t.test('publishArtifact converts content to the requested format before uploading, and records it in the audit metadata', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({
      id: 'a1', user_id: 'u1', college_id: 'c1', deleted_at: null, status: 'draft', title: 'Report', content: '# Report\n\nSome text.',
    }));
    const uploadMock = t.mock.method(documentService, 'uploadPersonalDocument', async (client, args) => {
      assert.equal(args.fileName, 'Report.docx');
      assert.equal(args.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      assert.equal(Buffer.isBuffer(args.fileBuffer), true);
      assert.ok(args.fileBuffer.length > 0);
      return { id: 'doc2', file_name: args.fileName, mime_type: args.mimeType };
    });
    const updateMock = t.mock.method(artifactRepository, 'update', async (client, id, patch) => ({ id, ...patch }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore(); uploadMock.mock.restore(); updateMock.mock.restore(); auditMock.mock.restore();
    });

    const result = await artifactService.publishArtifact({}, 'a1', { userId: 'u1', collegeId: 'c1', format: 'docx' });
    assert.equal(result.document_file_name, 'Report.docx');
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.format, 'docx');
  });

  await t.test('publishArtifact rejects csv/xlsx when the content has no table, as ArtifactValidationError', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({
      id: 'a1', user_id: 'u1', college_id: 'c1', deleted_at: null, status: 'draft', title: 'Report', content: 'Just prose, no table.',
    }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => artifactService.publishArtifact({}, 'a1', { userId: 'u1', collegeId: 'c1', format: 'csv' }),
      artifactService.ArtifactValidationError,
    );
  });

  await t.test('publishArtifact rejects a second publish attempt', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({ id: 'a1', user_id: 'u1', deleted_at: null, status: 'published' }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => artifactService.publishArtifact({}, 'a1', { userId: 'u1', collegeId: 'c1' }),
      artifactService.ArtifactAlreadyPublishedError,
    );
  });

  await t.test('exportArtifactAs works on an ALREADY-published artifact — the retroactive "give me another format" case — without touching its status/publishedDocumentId', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({
      id: 'a1', user_id: 'u1', college_id: 'c1', deleted_at: null, status: 'published',
      title: 'Report', content: '# Report\n\nSome text.', published_document_id: 'doc-original',
    }));
    const uploadMock = t.mock.method(documentService, 'uploadPersonalDocument', async (client, args) => {
      assert.equal(args.fileName, 'Report.pdf');
      return { id: 'doc-new', file_name: args.fileName, mime_type: args.mimeType };
    });
    // Deliberately no artifactRepository.update mock — a real call would
    // throw ("no such mock"), proving exportArtifactAs never touches the
    // artifact row itself (unlike publishArtifact).
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => { findMock.mock.restore(); uploadMock.mock.restore(); auditMock.mock.restore(); });

    const result = await artifactService.exportArtifactAs({}, 'a1', 'pdf', { userId: 'u1', collegeId: 'c1' });
    assert.equal(result.id, 'doc-new');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'artifact_exported');
  });

  await t.test('exportArtifactAs also works on a DRAFT (not yet published) artifact', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({
      id: 'a1', user_id: 'u1', college_id: 'c1', deleted_at: null, status: 'draft', title: 'Draft', content: '# Draft\n\ntext',
    }));
    const uploadMock = t.mock.method(documentService, 'uploadPersonalDocument', async (client, args) => ({
      id: 'doc-new', file_name: args.fileName, mime_type: args.mimeType,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => { findMock.mock.restore(); uploadMock.mock.restore(); auditMock.mock.restore(); });

    const result = await artifactService.exportArtifactAs({}, 'a1', 'txt', { userId: 'u1', collegeId: 'c1' });
    assert.equal(result.id, 'doc-new');
  });

  await t.test('exportArtifactAs still enforces ownership — another user\'s artifact is rejected', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({ id: 'a1', user_id: 'OTHER', deleted_at: null }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => artifactService.exportArtifactAs({}, 'a1', 'pdf', { userId: 'u1', collegeId: 'c1' }),
      artifactService.ArtifactForbiddenError,
    );
  });
});

// attachGeneratedFile — consumer-tool-adaptation file-generation slice
// (2026-08-26). The gate is enforced HERE (CLAUDE.md rule 1): every test
// below that expects a rejection must also assert uploadPersonalDocument
// was never called, because "refused but uploaded anyway" would be the
// actual defect the gate exists to prevent.
test('ArtifactService.attachGeneratedFile (no DB)', async (t) => {
  const passedVerification = {
    verdict: 'passed', passed: true, reason: 'ok', formulaCellCount: 2, expectedFormulaCellCount: 2,
  };

  await t.test('refuses when verification is missing entirely', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({
      id: 'a1', user_id: 'u1', college_id: 'c1', deleted_at: null, title: 'Breakdown',
    }));
    const uploadMock = t.mock.method(documentService, 'uploadPersonalDocument', async () => { throw new Error('must not be called'); });
    t.after(() => { findMock.mock.restore(); uploadMock.mock.restore(); });

    await assert.rejects(
      () => artifactService.attachGeneratedFile({}, 'a1', {
        buffer: Buffer.from('x'), fileName: 'out.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }, { userId: 'u1', collegeId: 'c1' }),
      artifactService.ArtifactValidationError,
    );
    assert.equal(uploadMock.mock.calls.length, 0);
  });

  await t.test('refuses a bare boolean verification — the caller must pass the full report, not a shortcut', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({
      id: 'a1', user_id: 'u1', college_id: 'c1', deleted_at: null, title: 'Breakdown',
    }));
    const uploadMock = t.mock.method(documentService, 'uploadPersonalDocument', async () => { throw new Error('must not be called'); });
    t.after(() => { findMock.mock.restore(); uploadMock.mock.restore(); });

    await assert.rejects(
      () => artifactService.attachGeneratedFile({}, 'a1', {
        buffer: Buffer.from('x'), fileName: 'out.xlsx', mimeType: 'x', verification: true,
      }, { userId: 'u1', collegeId: 'c1' }),
      artifactService.ArtifactValidationError,
    );
    assert.equal(uploadMock.mock.calls.length, 0);
  });

  await t.test('refuses a failed verification and states the reason', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({
      id: 'a1', user_id: 'u1', college_id: 'c1', deleted_at: null, title: 'Breakdown',
    }));
    const uploadMock = t.mock.method(documentService, 'uploadPersonalDocument', async () => { throw new Error('must not be called'); });
    t.after(() => { findMock.mock.restore(); uploadMock.mock.restore(); });

    await assert.rejects(
      () => artifactService.attachGeneratedFile({}, 'a1', {
        buffer: Buffer.from('x'),
        fileName: 'out.xlsx',
        mimeType: 'x',
        verification: { verdict: 'failed', passed: false, reason: '1 expected formula cell(s) hold literal values' },
      }, { userId: 'u1', collegeId: 'c1' }),
      (err) => err instanceof artifactService.ArtifactValidationError && /literal values/.test(err.message),
    );
    assert.equal(uploadMock.mock.calls.length, 0);
  });

  await t.test('refuses an unverified verdict exactly like a failed one — there is no "attach anyway" path', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({
      id: 'a1', user_id: 'u1', college_id: 'c1', deleted_at: null, title: 'Breakdown',
    }));
    const uploadMock = t.mock.method(documentService, 'uploadPersonalDocument', async () => { throw new Error('must not be called'); });
    t.after(() => { findMock.mock.restore(); uploadMock.mock.restore(); });

    await assert.rejects(
      () => artifactService.attachGeneratedFile({}, 'a1', {
        buffer: Buffer.from('x'),
        fileName: 'out.xlsx',
        mimeType: 'x',
        verification: { verdict: 'unverified', passed: false, reason: 'no expect_formulas_in was declared' },
      }, { userId: 'u1', collegeId: 'c1' }),
      artifactService.ArtifactValidationError,
    );
    assert.equal(uploadMock.mock.calls.length, 0);
  });

  await t.test('a passed verification uploads the buffer, updates BOTH new columns, and audits under its own action', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({
      id: 'a1', user_id: 'u1', college_id: 'c1', deleted_at: null, title: 'Breakdown',
    }));
    const uploadMock = t.mock.method(documentService, 'uploadPersonalDocument', async (client, args, opts) => {
      assert.equal(args.collegeId, 'c1');
      assert.equal(args.title, 'Breakdown');
      assert.equal(args.folderName, 'AI Artifacts');
      assert.equal(args.fileName, 'breakdown.xlsx');
      assert.equal(args.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      assert.equal(Buffer.isBuffer(args.fileBuffer), true);
      assert.equal(opts.actorUserId, 'u1');
      return { id: 'doc-9', file_name: args.fileName, mime_type: args.mimeType };
    });
    const updateMock = t.mock.method(artifactRepository, 'update', async (client, id, patch) => {
      assert.equal(id, 'a1');
      assert.equal(patch.generatedDocumentId, 'doc-9');
      assert.equal(patch.generationVerified, true);
      // publish's own columns must never be touched by this path.
      assert.ok(!('status' in patch));
      assert.ok(!('publishedDocumentId' in patch));
      return { id, ...patch };
    });
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore(); uploadMock.mock.restore(); updateMock.mock.restore(); auditMock.mock.restore();
    });

    const result = await artifactService.attachGeneratedFile({}, 'a1', {
      buffer: Buffer.from('binary'),
      fileName: 'breakdown.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      verification: passedVerification,
    }, { userId: 'u1', collegeId: 'c1' });

    assert.equal(result.generatedDocumentId, 'doc-9');
    assert.equal(result.document_file_name, 'breakdown.xlsx');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'artifact_file_generated');
    assert.deepEqual(auditMock.mock.calls[0].arguments[1].metadata, { documentId: 'doc-9', verdict: 'passed' });
  });

  await t.test('works on an already-PUBLISHED artifact — generation is a separate lifecycle from publish', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({
      id: 'a1', user_id: 'u1', college_id: 'c1', deleted_at: null, title: 'Breakdown', status: 'published',
    }));
    const uploadMock = t.mock.method(documentService, 'uploadPersonalDocument', async (client, args) => ({
      id: 'doc-10', file_name: args.fileName, mime_type: args.mimeType,
    }));
    const updateMock = t.mock.method(artifactRepository, 'update', async (client, id, patch) => ({ id, ...patch }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore(); uploadMock.mock.restore(); updateMock.mock.restore(); auditMock.mock.restore();
    });

    const result = await artifactService.attachGeneratedFile({}, 'a1', {
      buffer: Buffer.from('x'), fileName: 'out.xlsx', mimeType: 'x', verification: passedVerification,
    }, { userId: 'u1', collegeId: 'c1' });
    assert.equal(result.generatedDocumentId, 'doc-10');
  });

  await t.test('still enforces ownership — another user\'s artifact is rejected before any upload', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({ id: 'a1', user_id: 'OTHER', deleted_at: null }));
    const uploadMock = t.mock.method(documentService, 'uploadPersonalDocument', async () => { throw new Error('must not be called'); });
    t.after(() => { findMock.mock.restore(); uploadMock.mock.restore(); });

    await assert.rejects(
      () => artifactService.attachGeneratedFile({}, 'a1', {
        buffer: Buffer.from('x'), fileName: 'out.xlsx', mimeType: 'x', verification: passedVerification,
      }, { userId: 'u1', collegeId: 'c1' }),
      artifactService.ArtifactForbiddenError,
    );
    assert.equal(uploadMock.mock.calls.length, 0);
  });
});
