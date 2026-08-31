'use strict';

// Unit tests for personalNoteService (UAT Priority 1 #3). No live
// Postgres: personalNoteRepository is stubbed via node:test's built-in
// mock, same technique as calendar-service.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const personalNoteRepository = require('../src/repositories/personalNoteRepository');
const personalNoteService = require('../src/services/personalNoteService');

test('personalNoteService.createNote', async (t) => {
  await t.test('rejects a missing body without touching the DB', async () => {
    const createMock = t.mock.method(personalNoteRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => personalNoteService.createNote({}, {}, { actorUserId: 'u1', collegeId: 'c1' }),
      personalNoteService.PersonalNoteValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('creates a note scoped to the actor', async () => {
    const createMock = t.mock.method(personalNoteRepository, 'create', async (client, fields) => ({
      id: 'note-1',
      ...fields,
    }));
    t.after(() => createMock.mock.restore());

    const result = await personalNoteService.createNote(
      {},
      { body: 'Remember to submit marks' },
      { actorUserId: 'u1', collegeId: 'c1' },
    );
    assert.equal(result.userId, 'u1');
    assert.equal(result.body, 'Remember to submit marks');
  });
});

test('personalNoteService.updateNote / deleteNote — ownership', async (t) => {
  await t.test('throws PersonalNoteNotFoundError for an unknown id', async () => {
    const findMock = t.mock.method(personalNoteRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => personalNoteService.updateNote({}, 'missing', { body: 'x' }, { actorUserId: 'u1' }),
      personalNoteService.PersonalNoteNotFoundError,
    );
  });

  await t.test('throws PersonalNoteForbiddenError for a non-owner', async () => {
    const findMock = t.mock.method(personalNoteRepository, 'findById', async () => ({
      id: 'note-1',
      user_id: 'other-user',
    }));
    const updateMock = t.mock.method(personalNoteRepository, 'update');
    t.after(() => {
      findMock.mock.restore();
      updateMock.mock.restore();
    });

    await assert.rejects(
      () => personalNoteService.updateNote({}, 'note-1', { body: 'x' }, { actorUserId: 'u1' }),
      personalNoteService.PersonalNoteForbiddenError,
    );
    assert.equal(updateMock.mock.callCount(), 0);
  });

  await t.test('updates a note for its owner', async () => {
    const findMock = t.mock.method(personalNoteRepository, 'findById', async () => ({
      id: 'note-1',
      user_id: 'u1',
      body: 'Old',
    }));
    const updateMock = t.mock.method(personalNoteRepository, 'update', async (client, id, fields) => ({
      id,
      ...fields,
    }));
    t.after(() => {
      findMock.mock.restore();
      updateMock.mock.restore();
    });

    const result = await personalNoteService.updateNote({}, 'note-1', { body: 'New' }, { actorUserId: 'u1' });
    assert.equal(result.body, 'New');
  });

  await t.test('deleteNote throws PersonalNoteForbiddenError for a non-owner', async () => {
    const findMock = t.mock.method(personalNoteRepository, 'findById', async () => ({
      id: 'note-1',
      user_id: 'other-user',
    }));
    const removeMock = t.mock.method(personalNoteRepository, 'remove');
    t.after(() => {
      findMock.mock.restore();
      removeMock.mock.restore();
    });

    await assert.rejects(
      () => personalNoteService.deleteNote({}, 'note-1', { actorUserId: 'u1' }),
      personalNoteService.PersonalNoteForbiddenError,
    );
    assert.equal(removeMock.mock.callCount(), 0);
  });
});

test('personalNoteService.listNotes', async (t) => {
  await t.test("lists only the actor's own notes", async () => {
    const listMock = t.mock.method(personalNoteRepository, 'listByUser', async (client, userId) => {
      assert.equal(userId, 'u1');
      return [{ id: 'note-1' }];
    });
    t.after(() => listMock.mock.restore());

    const result = await personalNoteService.listNotes({}, { actorUserId: 'u1' });
    assert.equal(result.length, 1);
  });
});
