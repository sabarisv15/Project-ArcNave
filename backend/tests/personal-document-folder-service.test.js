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
    const createMock = t.mock.method(personalDocumentFolderRepository, 'create', async (client, fields) => ({
      id: 'f1',
      ...fields,
    }));
    t.after(() => createMock.mock.restore());

    const result = await personalDocumentFolderService.createFolder(
      {},
      { name: '  Physics  ' },
      { actorUserId: 'u1', collegeId: 'c1' },
    );
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
    const findMock = t.mock.method(personalDocumentFolderRepository, 'findById', async () => ({
      id: 'f1',
      owner_user_id: 'other-user',
    }));
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
    const findMock = t.mock.method(personalDocumentFolderRepository, 'findById', async () => ({
      id: 'f1',
      owner_user_id: 'u1',
    }));
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
  await t.test("lists only the actor's own folders", async () => {
    const listMock = t.mock.method(personalDocumentFolderRepository, 'listByOwner', async (client, ownerUserId) => {
      assert.equal(ownerUserId, 'u1');
      return [{ id: 'f1', name: 'Physics' }];
    });
    t.after(() => listMock.mock.restore());

    const result = await personalDocumentFolderService.listFolders({}, { actorUserId: 'u1' });
    assert.equal(result.length, 1);
  });
});

// Nested folders (Documents module real-backend wiring, this session):
// updateFolder is the one entry point for both Rename (name only) and
// Move to... (parentId only) — same reasoning documentRepository.update's
// own entries-filter gives, exercised here through the service's own
// ownership + cycle guards.
test('personalDocumentFolderService.updateFolder', async (t) => {
  await t.test('throws ForbiddenError renaming a folder owned by someone else', async () => {
    const findMock = t.mock.method(personalDocumentFolderRepository, 'findById', async () => ({
      id: 'f1',
      owner_user_id: 'other-user',
    }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => personalDocumentFolderService.updateFolder({}, 'f1', { name: 'New name' }, { actorUserId: 'u1' }),
      personalDocumentFolderService.PersonalDocumentFolderForbiddenError,
    );
  });

  await t.test('rejects a blank rename', async () => {
    const findMock = t.mock.method(personalDocumentFolderRepository, 'findById', async () => ({
      id: 'f1',
      owner_user_id: 'u1',
    }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => personalDocumentFolderService.updateFolder({}, 'f1', { name: '   ' }, { actorUserId: 'u1' }),
      personalDocumentFolderService.PersonalDocumentFolderValidationError,
    );
  });

  await t.test('renames for the real owner', async () => {
    const findMock = t.mock.method(personalDocumentFolderRepository, 'findById', async () => ({
      id: 'f1',
      owner_user_id: 'u1',
    }));
    const updateMock = t.mock.method(personalDocumentFolderRepository, 'update', async (client, id, fields) => ({
      id,
      ...fields,
    }));
    t.after(() => {
      findMock.mock.restore();
      updateMock.mock.restore();
    });

    const result = await personalDocumentFolderService.updateFolder(
      {},
      'f1',
      { name: '  Chemistry  ' },
      { actorUserId: 'u1' },
    );
    assert.equal(result.name, 'Chemistry');
  });

  await t.test('rejects moving a folder into itself', async () => {
    const findMock = t.mock.method(personalDocumentFolderRepository, 'findById', async (client, id) => ({
      id,
      owner_user_id: 'u1',
      parent_id: null,
    }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => personalDocumentFolderService.updateFolder({}, 'f1', { parentId: 'f1' }, { actorUserId: 'u1' }),
      personalDocumentFolderService.PersonalDocumentFolderCycleError,
    );
  });

  await t.test('rejects moving a folder into its own descendant', async () => {
    // f1 (root) -> f2 -> f3. Moving f1 under f3 would create a cycle.
    const tree = {
      f1: { id: 'f1', owner_user_id: 'u1', parent_id: null },
      f2: { id: 'f2', owner_user_id: 'u1', parent_id: 'f1' },
      f3: { id: 'f3', owner_user_id: 'u1', parent_id: 'f2' },
    };
    const findMock = t.mock.method(
      personalDocumentFolderRepository,
      'findById',
      async (client, id) => tree[id] || null,
    );
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => personalDocumentFolderService.updateFolder({}, 'f1', { parentId: 'f3' }, { actorUserId: 'u1' }),
      personalDocumentFolderService.PersonalDocumentFolderCycleError,
    );
  });

  await t.test('rejects a parentId that does not resolve to a folder this actor owns', async () => {
    const tree = {
      f1: { id: 'f1', owner_user_id: 'u1', parent_id: null },
      other: { id: 'other', owner_user_id: 'someone-else', parent_id: null },
    };
    const findMock = t.mock.method(
      personalDocumentFolderRepository,
      'findById',
      async (client, id) => tree[id] || null,
    );
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => personalDocumentFolderService.updateFolder({}, 'f1', { parentId: 'other' }, { actorUserId: 'u1' }),
      personalDocumentFolderService.PersonalDocumentFolderParentNotFoundError,
    );
  });

  await t.test('moves into a real, valid, non-cyclic parent', async () => {
    const tree = {
      f1: { id: 'f1', owner_user_id: 'u1', parent_id: null },
      f2: { id: 'f2', owner_user_id: 'u1', parent_id: null },
    };
    const findMock = t.mock.method(
      personalDocumentFolderRepository,
      'findById',
      async (client, id) => tree[id] || null,
    );
    const updateMock = t.mock.method(personalDocumentFolderRepository, 'update', async (client, id, fields) => ({
      id,
      ...fields,
    }));
    t.after(() => {
      findMock.mock.restore();
      updateMock.mock.restore();
    });

    const result = await personalDocumentFolderService.updateFolder(
      {},
      'f1',
      { parentId: 'f2' },
      { actorUserId: 'u1' },
    );
    assert.equal(result.parentId, 'f2');
  });
});
