'use strict';

// Unit tests for personalDocumentFolderService. No live Postgres:
// personalDocumentFolderRepository is stubbed via node:test's built-in
// mock, same technique class-log-service.test.js already uses.

const test = require('node:test');
const assert = require('node:assert/strict');
const personalDocumentFolderRepository = require('../src/repositories/personalDocumentFolderRepository');
const personalDocumentFolderService = require('../src/services/personalDocumentFolderService');

test('personalDocumentFolderService.createFolder', async (t) => {
  await t.test('rejects a blank name without touching the DB', async () => {
    const createMock = t.mock.method(personalDocumentFolderRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => personalDocumentFolderService.createFolder({}, { name: '   ' }, { actorUserId: 'u1', collegeId: 'c1' }),
      personalDocumentFolderService.PersonalDocumentFolderValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('trims the name and scopes it to the actor', async () => {
    const createMock = t.mock.method(personalDocumentFolderRepository, 'create', async (client, fields) => ({ id: 'f1', ...fields }));
    t.after(() => createMock.mock.restore());

    const result = await personalDocumentFolderService.createFolder({}, { name: '  Physics  ' }, { actorUserId: 'u1', collegeId: 'c1' });
    assert.equal(result.name, 'Physics');
    assert.equal(createMock.mock.calls[0].arguments[1].ownerUserId, 'u1');
  });

  await t.test('translates a unique-violation into PersonalDocumentFolderConflictError', async () => {
    const createMock = t.mock.method(personalDocumentFolderRepository, 'create', async () => {
      const err = new Error('duplicate key');
      err.code = '23505';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => personalDocumentFolderService.createFolder({}, { name: 'Physics' }, { actorUserId: 'u1', collegeId: 'c1' }),
      personalDocumentFolderService.PersonalDocumentFolderConflictError,
    );
  });
});

test('personalDocumentFolderService.removeFolder', async (t) => {
  await t.test('throws NotFoundError for an unknown id', async () => {
    const findMock = t.mock.method(personalDocumentFolderRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => personalDocumentFolderService.removeFolder({}, 'missing', { actorUserId: 'u1' }),
      personalDocumentFolderService.PersonalDocumentFolderNotFoundError,
    );
  });

  await t.test('throws ForbiddenError for a non-owner', async () => {
    const findMock = t.mock.method(personalDocumentFolderRepository, 'findById', async () => ({ id: 'f1', owner_user_id: 'other-user' }));
    const removeMock = t.mock.method(personalDocumentFolderRepository, 'remove');
    t.after(() => {
      findMock.mock.restore();
      removeMock.mock.restore();
    });

    await assert.rejects(
      () => personalDocumentFolderService.removeFolder({}, 'f1', { actorUserId: 'u1' }),
      personalDocumentFolderService.PersonalDocumentFolderForbiddenError,
    );
    assert.equal(removeMock.mock.callCount(), 0);
  });

  await t.test('removes for the owner', async () => {
    const findMock = t.mock.method(personalDocumentFolderRepository, 'findById', async () => ({ id: 'f1', owner_user_id: 'u1' }));
    const removeMock = t.mock.method(personalDocumentFolderRepository, 'remove', async () => true);
    t.after(() => {
      findMock.mock.restore();
      removeMock.mock.restore();
    });

    await personalDocumentFolderService.removeFolder({}, 'f1', { actorUserId: 'u1' });
    assert.equal(removeMock.mock.callCount(), 1);
  });
});

test('personalDocumentFolderService.listFolders', async (t) => {
  await t.test('lists only the actor\'s own folders', async () => {
    const listMock = t.mock.method(personalDocumentFolderRepository, 'listByOwner', async (client, ownerUserId) => {
      assert.equal(ownerUserId, 'u1');
      return [{ id: 'f1', name: 'Physics' }];
    });
    t.after(() => listMock.mock.restore());

    const result = await personalDocumentFolderService.listFolders({}, { actorUserId: 'u1' });
    assert.equal(result.length, 1);
  });
});
