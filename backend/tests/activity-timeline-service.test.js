'use strict';

// Unit tests for activityTimelineService (UAT Priority 2 #5). No live
// Postgres: auditLogRepository is stubbed via node:test's built-in
// mock.

const test = require('node:test');
const assert = require('node:assert/strict');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const activityTimelineService = require('../src/services/activityTimelineService');

test('activityTimelineService.getOwnActivity', async (t) => {
  await t.test("always queries by the actor's own userId, never a caller-supplied one", async () => {
    const findMock = t.mock.method(auditLogRepository, 'findByUser', async (client, userId, opts) => {
      assert.equal(userId, 'u1');
      assert.deepEqual(opts, { limit: 10, offset: 0 });
      return [{ id: 'log-1', action: 'attendance_marked' }];
    });
    t.after(() => findMock.mock.restore());

    const result = await activityTimelineService.getOwnActivity({}, { actorUserId: 'u1', limit: 10, offset: 0 });
    assert.equal(result.length, 1);
    assert.equal(result[0].action, 'attendance_marked');
  });
});
