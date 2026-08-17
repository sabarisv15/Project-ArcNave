'use strict';

// Unit tests for business rule task #20 (BusinessRules.md Platform
// administration, Academic Calendar). No live Postgres:
// calendarEventRepository/auditLogRepository are stubbed via
// node:test's built-in mock, same technique as
// academic-year-service.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const calendarEventRepository = require('../src/repositories/calendarEventRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const calendarService = require('../src/services/calendarService');

test('CalendarService.createEvent', async (t) => {
  await t.test('rejects missing title/eventType/startDate without touching the DB', async () => {
    const createMock = t.mock.method(calendarEventRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => calendarService.createEvent({}, { collegeId: 'c1' }, { actorUserId: 'u1' }),
      calendarService.CalendarEventValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('creates an event and audit-logs it', async () => {
    const createMock = t.mock.method(calendarEventRepository, 'create', async (client, fields) => ({
      id: 'ev-1', college_id: fields.collegeId, title: fields.title, event_type: fields.eventType, start_date: fields.startDate,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await calendarService.createEvent(
      {},
      { collegeId: 'c1', title: 'Semester Break', eventType: 'holiday', startDate: '2026-12-20' },
      { actorUserId: 'u1' },
    );
    assert.equal(result.title, 'Semester Break');
    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'calendar_event_created');
  });

  await t.test('event_type has no predefined restriction — any non-empty string is accepted', async () => {
    const createMock = t.mock.method(calendarEventRepository, 'create', async (client, fields) => ({ id: 'ev-2', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await calendarService.createEvent(
      {},
      { collegeId: 'c1', title: 'Alumni Meet', eventType: 'custom-institution-event', startDate: '2026-03-01' },
      { actorUserId: 'u1' },
    );
    assert.equal(result.eventType, 'custom-institution-event');
  });
});

test('CalendarService.updateEvent', async (t) => {
  await t.test('throws CalendarEventNotFoundError for an unknown id', async () => {
    const findMock = t.mock.method(calendarEventRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => calendarService.updateEvent({}, 'missing', { title: 'x' }, { actorUserId: 'u1', collegeId: 'c1' }),
      calendarService.CalendarEventNotFoundError,
    );
  });

  await t.test('rejects clearing title to empty on an existing event', async () => {
    const findMock = t.mock.method(calendarEventRepository, 'findById', async () => ({
      id: 'ev-1', title: 'Old Title', event_type: 'exam', start_date: '2026-01-01',
    }));
    const updateMock = t.mock.method(calendarEventRepository, 'update');
    t.after(() => {
      findMock.mock.restore();
      updateMock.mock.restore();
    });

    await assert.rejects(
      () => calendarService.updateEvent({}, 'ev-1', { title: '' }, { actorUserId: 'u1', collegeId: 'c1' }),
      calendarService.CalendarEventValidationError,
    );
    assert.equal(updateMock.mock.callCount(), 0);
  });

  await t.test('updates an existing event and audit-logs it', async () => {
    const findMock = t.mock.method(calendarEventRepository, 'findById', async () => ({
      id: 'ev-1', title: 'Old Title', event_type: 'exam', start_date: '2026-01-01',
    }));
    const updateMock = t.mock.method(calendarEventRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await calendarService.updateEvent({}, 'ev-1', { title: 'New Title' }, { actorUserId: 'u1', collegeId: 'c1' });
    assert.equal(result.title, 'New Title');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'calendar_event_updated');
  });
});

test('CalendarService.deleteEvent', async (t) => {
  await t.test('throws CalendarEventNotFoundError for an unknown id', async () => {
    const findMock = t.mock.method(calendarEventRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => calendarService.deleteEvent({}, 'missing', { actorUserId: 'u1', collegeId: 'c1' }),
      calendarService.CalendarEventNotFoundError,
    );
  });

  await t.test('deletes an existing event and audit-logs it', async () => {
    const findMock = t.mock.method(calendarEventRepository, 'findById', async () => ({ id: 'ev-1', title: 'Old Title' }));
    const removeMock = t.mock.method(calendarEventRepository, 'remove', async () => true);
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      removeMock.mock.restore();
      auditMock.mock.restore();
    });

    await calendarService.deleteEvent({}, 'ev-1', { actorUserId: 'u1', collegeId: 'c1' });
    assert.equal(removeMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'calendar_event_deleted');
  });
});

test('CalendarService.listEvents / getEvent', async (t) => {
  await t.test('listEvents passes collegeId/fromDate/toDate straight through to the repository', async () => {
    const listMock = t.mock.method(calendarEventRepository, 'list', async (client, filters) => [{ id: 'ev-1', ...filters }]);
    t.after(() => listMock.mock.restore());

    const result = await calendarService.listEvents({}, { collegeId: 'c1', fromDate: '2026-01-01', toDate: '2026-12-31' });
    assert.equal(result.length, 1);
    assert.deepEqual(listMock.mock.calls[0].arguments[1], { collegeId: 'c1', fromDate: '2026-01-01', toDate: '2026-12-31' });
  });

  await t.test('getEvent throws CalendarEventNotFoundError for an unknown id', async () => {
    const findMock = t.mock.method(calendarEventRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => calendarService.getEvent({}, 'missing'),
      calendarService.CalendarEventNotFoundError,
    );
  });
});
