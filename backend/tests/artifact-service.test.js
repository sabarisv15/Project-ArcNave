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
    assert.deepEqual(auditMock.mock.calls[0].arguments[1].metadata, { documentId: 'doc1' });
  });

  await t.test('publishArtifact rejects a second publish attempt', async () => {
    const findMock = t.mock.method(artifactRepository, 'findById', async () => ({ id: 'a1', user_id: 'u1', deleted_at: null, status: 'published' }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => artifactService.publishArtifact({}, 'a1', { userId: 'u1', collegeId: 'c1' }),
      artifactService.ArtifactAlreadyPublishedError,
    );
  });
});
