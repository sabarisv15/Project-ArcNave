'use strict';

// Unit tests for classLogService (UAT Priority 1 #1, "Teaching
// Journal"/"Class Log"). No live Postgres: classLogRepository/
// auditLogRepository/visibilityService are stubbed via node:test's
// built-in mock, same technique as calendar-service.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const classLogRepository = require('../src/repositories/classLogRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const visibilityService = require('../src/services/visibilityService');
const classLogService = require('../src/services/classLogService');

test('classLogService.createLogEntry', async (t) => {
  await t.test('rejects missing classId/sessionDate/subject/topic without touching the DB', async () => {
    const createMock = t.mock.method(classLogRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => classLogService.createLogEntry({}, {}, { actorUserId: 'u1', actorRole: 'staff', collegeId: 'c1' }),
      classLogService.ClassLogValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('rejects when the actor cannot view the class, before touching the DB', async () => {
    const assertMock = t.mock.method(visibilityService, 'assertCanViewClass', async () => {
      throw new visibilityService.VisibilityForbiddenError('not allowed');
    });
    const createMock = t.mock.method(classLogRepository, 'create');
    t.after(() => {
      assertMock.mock.restore();
      createMock.mock.restore();
    });

    await assert.rejects(
      () =>
        classLogService.createLogEntry(
          {},
          {
            classId: 'cls-1',
            sessionDate: '2026-08-12',
            subject: 'DS',
            topic: 'Stacks',
          },
          { actorUserId: 'u1', actorRole: 'staff', collegeId: 'c1' },
        ),
      visibilityService.VisibilityForbiddenError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('creates an entry and audit-logs it', async () => {
    const assertMock = t.mock.method(visibilityService, 'assertCanViewClass', async () => {});
    const createMock = t.mock.method(classLogRepository, 'create', async (client, fields) => ({
      id: 'log-1',
      ...fields,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      assertMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await classLogService.createLogEntry(
      {},
      {
        classId: 'cls-1',
        sessionDate: '2026-08-12',
        subject: 'DS',
        topic: 'Stack Operations',
        notes: 'HW 1-5',
      },
      { actorUserId: 'u1', actorRole: 'staff', collegeId: 'c1' },
    );

    assert.equal(result.topic, 'Stack Operations');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'class_log_created');
  });
});

test('classLogService.updateLogEntry / deleteLogEntry', async (t) => {
  await t.test('updateLogEntry throws ClassLogNotFoundError for an unknown id', async () => {
    const findMock = t.mock.method(classLogRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => classLogService.updateLogEntry({}, 'missing', { topic: 'x' }, { actorUserId: 'u1', collegeId: 'c1' }),
      classLogService.ClassLogNotFoundError,
    );
  });

  await t.test('updateLogEntry throws ClassLogForbiddenError for a non-creator', async () => {
    const findMock = t.mock.method(classLogRepository, 'findById', async () => ({
      id: 'log-1',
      created_by_user_id: 'other-user',
    }));
    const updateMock = t.mock.method(classLogRepository, 'update');
    t.after(() => {
      findMock.mock.restore();
      updateMock.mock.restore();
    });

    await assert.rejects(
      () => classLogService.updateLogEntry({}, 'log-1', { topic: 'x' }, { actorUserId: 'u1', collegeId: 'c1' }),
      classLogService.ClassLogForbiddenError,
    );
    assert.equal(updateMock.mock.callCount(), 0);
  });

  await t.test('updateLogEntry updates and audit-logs for the creator', async () => {
    const findMock = t.mock.method(classLogRepository, 'findById', async () => ({
      id: 'log-1',
      created_by_user_id: 'u1',
      topic: 'Old',
    }));
    const updateMock = t.mock.method(classLogRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await classLogService.updateLogEntry(
      {},
      'log-1',
      { topic: 'New' },
      { actorUserId: 'u1', collegeId: 'c1' },
    );
    assert.equal(result.topic, 'New');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'class_log_updated');
  });

  await t.test('deleteLogEntry throws ClassLogForbiddenError for a non-creator', async () => {
    const findMock = t.mock.method(classLogRepository, 'findById', async () => ({
      id: 'log-1',
      created_by_user_id: 'other-user',
    }));
    const removeMock = t.mock.method(classLogRepository, 'remove');
    t.after(() => {
      findMock.mock.restore();
      removeMock.mock.restore();
    });

    await assert.rejects(
      () => classLogService.deleteLogEntry({}, 'log-1', { actorUserId: 'u1', collegeId: 'c1' }),
      classLogService.ClassLogForbiddenError,
    );
    assert.equal(removeMock.mock.callCount(), 0);
  });
});

test('classLogService.listLogEntries', async (t) => {
  await t.test('scoped to a single class asserts visibility first', async () => {
    const assertMock = t.mock.method(visibilityService, 'assertCanViewClass', async () => {});
    const listMock = t.mock.method(classLogRepository, 'list', async () => [{ id: 'log-1' }]);
    t.after(() => {
      assertMock.mock.restore();
      listMock.mock.restore();
    });

    const result = await classLogService.listLogEntries(
      {},
      { classId: 'cls-1' },
      { actorUserId: 'u1', actorRole: 'staff', collegeId: 'c1' },
    );
    assert.equal(result.length, 1);
    assert.equal(assertMock.mock.callCount(), 1);
  });

  await t.test("with no classId, restricts to the actor's visible classes", async () => {
    const visibleMock = t.mock.method(visibilityService, 'getVisibleClassIds', async () => ['cls-1', 'cls-2']);
    const listMock = t.mock.method(classLogRepository, 'list', async (client, filters) => {
      assert.deepEqual(filters.classIds, ['cls-1', 'cls-2']);
      return [];
    });
    t.after(() => {
      visibleMock.mock.restore();
      listMock.mock.restore();
    });

    await classLogService.listLogEntries({}, {}, { actorUserId: 'u1', actorRole: 'staff', collegeId: 'c1' });
    assert.equal(listMock.mock.callCount(), 1);
  });

  await t.test('with no visible classes at all, returns empty without querying', async () => {
    const visibleMock = t.mock.method(visibilityService, 'getVisibleClassIds', async () => []);
    const listMock = t.mock.method(classLogRepository, 'list');
    t.after(() => {
      visibleMock.mock.restore();
      listMock.mock.restore();
    });

    const result = await classLogService.listLogEntries(
      {},
      {},
      { actorUserId: 'u1', actorRole: 'staff', collegeId: 'c1' },
    );
    assert.deepEqual(result, []);
    assert.equal(listMock.mock.callCount(), 0);
  });
});
