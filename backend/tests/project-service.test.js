'use strict';

// Unit tests for ProjectService's pure business-logic paths — no live
// Postgres needed, same mocking convention as
// staff-work-history-service.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const projectRepository = require('../src/repositories/projectRepository');
const projectDocumentRepository = require('../src/repositories/projectDocumentRepository');
const documentService = require('../src/services/documentService');
const projectService = require('../src/services/projectService');

test('ProjectService (no DB)', async (t) => {
  await t.test('createProject requires a non-blank name', async () => {
    await assert.rejects(
      () => projectService.createProject({}, { name: '  ' }, { userId: 'u1', collegeId: 'c1' }),
      projectService.ProjectValidationError,
    );
  });

  await t.test('createProject trims the name and writes it against the caller\'s own ids', async () => {
    const createMock = t.mock.method(projectRepository, 'create', async (client, fields) => {
      assert.deepEqual(fields, { collegeId: 'c1', userId: 'u1', name: 'NAAC prep' });
      return { id: 'p1', ...fields };
    });
    t.after(() => createMock.mock.restore());

    const result = await projectService.createProject({}, { name: '  NAAC prep  ' }, { userId: 'u1', collegeId: 'c1' });
    assert.equal(result.id, 'p1');
  });

  await t.test('updateProject throws ProjectForbiddenError for another user\'s project', async () => {
    const findMock = t.mock.method(projectRepository, 'findById', async () => ({ id: 'p1', user_id: 'OTHER' }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => projectService.updateProject({}, 'p1', { name: 'New name' }, { userId: 'u1' }),
      projectService.ProjectForbiddenError,
    );
  });

  await t.test('updateProject throws ProjectNotFoundError for a nonexistent project', async () => {
    const findMock = t.mock.method(projectRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => projectService.updateProject({}, 'missing', { name: 'New name' }, { userId: 'u1' }),
      projectService.ProjectNotFoundError,
    );
  });

  await t.test('updateProject requires at least one field', async () => {
    const findMock = t.mock.method(projectRepository, 'findById', async () => ({ id: 'p1', user_id: 'u1' }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => projectService.updateProject({}, 'p1', {}, { userId: 'u1' }),
      projectService.ProjectValidationError,
    );
  });

  await t.test('updateProject writes trimmed instructions, blank clears to null', async () => {
    const findMock = t.mock.method(projectRepository, 'findById', async () => ({ id: 'p1', user_id: 'u1' }));
    const updateMock = t.mock.method(projectRepository, 'update', async (client, id, fields) => {
      assert.equal(id, 'p1');
      assert.deepEqual(fields, { instructions: 'Always answer in bullet points' });
      return { id: 'p1', ...fields };
    });
    t.after(() => { findMock.mock.restore(); updateMock.mock.restore(); });

    await projectService.updateProject({}, 'p1', { instructions: '  Always answer in bullet points  ' }, { userId: 'u1' });
    assert.equal(updateMock.mock.calls.length, 1);
  });

  await t.test('updateProject writes pinned as a coerced boolean', async () => {
    const findMock = t.mock.method(projectRepository, 'findById', async () => ({ id: 'p1', user_id: 'u1' }));
    const updateMock = t.mock.method(projectRepository, 'update', async (client, id, fields) => {
      assert.equal(id, 'p1');
      assert.deepEqual(fields, { pinned: true });
      return { id: 'p1', ...fields };
    });
    t.after(() => { findMock.mock.restore(); updateMock.mock.restore(); });

    await projectService.updateProject({}, 'p1', { pinned: true }, { userId: 'u1' });
    assert.equal(updateMock.mock.calls.length, 1);
  });

  await t.test('deleteProject removes an owned project', async () => {
    const findMock = t.mock.method(projectRepository, 'findById', async () => ({ id: 'p1', user_id: 'u1' }));
    const removeMock = t.mock.method(projectRepository, 'remove', async (client, id) => {
      assert.equal(id, 'p1');
    });
    t.after(() => { findMock.mock.restore(); removeMock.mock.restore(); });

    await projectService.deleteProject({}, 'p1', { userId: 'u1' });
    assert.equal(removeMock.mock.calls.length, 1);
  });

  await t.test('attachProjectDocument rejects a document the acting user does not own', async () => {
    const findMock = t.mock.method(projectRepository, 'findById', async () => ({ id: 'p1', user_id: 'u1', college_id: 'c1' }));
    const getDocMock = t.mock.method(documentService, 'getDocument', async () => ({ id: 'd1', uploaded_by_user_id: 'OTHER' }));
    t.after(() => { findMock.mock.restore(); getDocMock.mock.restore(); });

    await assert.rejects(
      () => projectService.attachProjectDocument({}, 'p1', { documentId: 'd1' }, { userId: 'u1' }),
      projectService.ProjectForbiddenError,
    );
  });

  await t.test('attachProjectDocument rejects a document that does not exist', async () => {
    const findMock = t.mock.method(projectRepository, 'findById', async () => ({ id: 'p1', user_id: 'u1', college_id: 'c1' }));
    const getDocMock = t.mock.method(documentService, 'getDocument', async () => null);
    t.after(() => { findMock.mock.restore(); getDocMock.mock.restore(); });

    await assert.rejects(
      () => projectService.attachProjectDocument({}, 'p1', { documentId: 'missing' }, { userId: 'u1' }),
      projectService.ProjectNotFoundError,
    );
  });

  await t.test('attachProjectDocument rejects an already-attached document', async () => {
    const findMock = t.mock.method(projectRepository, 'findById', async () => ({ id: 'p1', user_id: 'u1', college_id: 'c1' }));
    const getDocMock = t.mock.method(documentService, 'getDocument', async () => ({ id: 'd1', uploaded_by_user_id: 'u1' }));
    const findLinkMock = t.mock.method(projectDocumentRepository, 'findByProjectAndDocument', async () => ({ id: 'link1' }));
    t.after(() => { findMock.mock.restore(); getDocMock.mock.restore(); findLinkMock.mock.restore(); });

    await assert.rejects(
      () => projectService.attachProjectDocument({}, 'p1', { documentId: 'd1' }, { userId: 'u1' }),
      projectService.ProjectDocumentAlreadyAttachedError,
    );
  });

  await t.test('attachProjectDocument creates the link for an owned, unattached document', async () => {
    const findMock = t.mock.method(projectRepository, 'findById', async () => ({ id: 'p1', user_id: 'u1', college_id: 'c1' }));
    const getDocMock = t.mock.method(documentService, 'getDocument', async () => ({ id: 'd1', uploaded_by_user_id: 'u1' }));
    const findLinkMock = t.mock.method(projectDocumentRepository, 'findByProjectAndDocument', async () => null);
    const createMock = t.mock.method(projectDocumentRepository, 'create', async (client, fields) => {
      assert.deepEqual(fields, {
        collegeId: 'c1', projectId: 'p1', documentId: 'd1', addedByUserId: 'u1',
      });
      return { id: 'link1', ...fields };
    });
    t.after(() => {
      findMock.mock.restore(); getDocMock.mock.restore(); findLinkMock.mock.restore(); createMock.mock.restore();
    });

    const result = await projectService.attachProjectDocument({}, 'p1', { documentId: 'd1' }, { userId: 'u1' });
    assert.equal(result.id, 'link1');
  });

  await t.test('detachProjectDocument rejects another user\'s project', async () => {
    const findMock = t.mock.method(projectRepository, 'findById', async () => ({ id: 'p1', user_id: 'OTHER' }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => projectService.detachProjectDocument({}, 'p1', 'd1', { userId: 'u1' }),
      projectService.ProjectForbiddenError,
    );
  });
});
