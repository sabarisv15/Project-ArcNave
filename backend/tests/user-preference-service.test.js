'use strict';

// Unit tests for userPreferenceService (UAT Priority 2 #6/#7 + the
// recommended Personal Dashboard Configuration feature — one generic
// key/value store backing all three). No live Postgres:
// userPreferenceRepository is stubbed via node:test's built-in mock.

const test = require('node:test');
const assert = require('node:assert/strict');
const userPreferenceRepository = require('../src/repositories/userPreferenceRepository');
const userPreferenceService = require('../src/services/userPreferenceService');

test('userPreferenceService.setPreference', async (t) => {
  await t.test('rejects a missing preferenceKey without touching the DB', async () => {
    const upsertMock = t.mock.method(userPreferenceRepository, 'upsert');
    t.after(() => upsertMock.mock.restore());

    await assert.rejects(
      () => userPreferenceService.setPreference({}, undefined, { a: 1 }, { actorUserId: 'u1', collegeId: 'c1' }),
      userPreferenceService.UserPreferenceValidationError,
    );
    assert.equal(upsertMock.mock.callCount(), 0);
  });

  await t.test('rejects an undefined value without touching the DB', async () => {
    const upsertMock = t.mock.method(userPreferenceRepository, 'upsert');
    t.after(() => upsertMock.mock.restore());

    await assert.rejects(
      () => userPreferenceService.setPreference({}, 'dashboard_layout', undefined, { actorUserId: 'u1', collegeId: 'c1' }),
      userPreferenceService.UserPreferenceValidationError,
    );
    assert.equal(upsertMock.mock.callCount(), 0);
  });

  await t.test('upserts a preference scoped to the actor', async () => {
    const upsertMock = t.mock.method(userPreferenceRepository, 'upsert', async (client, fields) => ({ id: 'pref-1', ...fields }));
    t.after(() => upsertMock.mock.restore());

    const result = await userPreferenceService.setPreference({}, 'dashboard_layout', ['widget-a', 'widget-b'], { actorUserId: 'u1', collegeId: 'c1' });
    assert.equal(result.userId, 'u1');
    assert.deepEqual(result.value, ['widget-a', 'widget-b']);
  });
});

test('userPreferenceService.getPreference / listPreferences / deletePreference', async (t) => {
  await t.test('getPreference passes the actor\'s own userId through, not any caller-supplied one', async () => {
    const findMock = t.mock.method(userPreferenceRepository, 'findByUserAndKey', async (client, userId, key) => {
      assert.equal(userId, 'u1');
      assert.equal(key, 'notification_channels');
      return { id: 'pref-1', value: { email: true } };
    });
    t.after(() => findMock.mock.restore());

    const result = await userPreferenceService.getPreference({}, 'notification_channels', { actorUserId: 'u1' });
    assert.deepEqual(result.value, { email: true });
  });

  await t.test('listPreferences lists only the actor\'s own preferences', async () => {
    const listMock = t.mock.method(userPreferenceRepository, 'listByUser', async (client, userId) => {
      assert.equal(userId, 'u1');
      return [{ id: 'pref-1' }];
    });
    t.after(() => listMock.mock.restore());

    const result = await userPreferenceService.listPreferences({}, { actorUserId: 'u1' });
    assert.equal(result.length, 1);
  });

  await t.test('deletePreference rejects a missing preferenceKey without touching the DB', async () => {
    const removeMock = t.mock.method(userPreferenceRepository, 'remove');
    t.after(() => removeMock.mock.restore());

    await assert.rejects(
      () => userPreferenceService.deletePreference({}, undefined, { actorUserId: 'u1' }),
      userPreferenceService.UserPreferenceValidationError,
    );
    assert.equal(removeMock.mock.callCount(), 0);
  });
});
