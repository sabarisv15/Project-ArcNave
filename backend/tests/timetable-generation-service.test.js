'use strict';

// Unit tests for academicService.generateTimetable — no live Postgres
// needed: classRepository/timetablePeriodRepository/
// facultyAllocationRepository/auditLogRepository are stubbed via
// node:test's built-in mock, same technique as every other
// *-service.test.js file in this suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const classRepository = require('../src/repositories/classRepository');
const timetablePeriodRepository = require('../src/repositories/timetablePeriodRepository');
const facultyAllocationRepository = require('../src/repositories/facultyAllocationRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const academicService = require('../src/services/academicService');

const PERIODS = [
  { id: 'mon-1', day_of_week: 'Monday', hour_index: 1 },
  { id: 'mon-2', day_of_week: 'Monday', hour_index: 2 },
  { id: 'tue-1', day_of_week: 'Tuesday', hour_index: 1 },
];

test('generateTimetable validation', async (t) => {
  await t.test('rejects missing classId/requirements', async () => {
    await assert.rejects(
      () => academicService.generateTimetable({}, null, []),
      academicService.TimetableGenerationValidationError,
    );
  });

  await t.test('rejects a requirement missing periodsPerWeek', async () => {
    await assert.rejects(
      () => academicService.generateTimetable({}, 'class-1', [{ subject: 'DBMS', staffUserId: 'u1' }]),
      academicService.TimetableGenerationValidationError,
    );
  });

  await t.test('rejects an unknown classId', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => null);
    t.after(() => findClassMock.mock.restore());
    await assert.rejects(
      () => academicService.generateTimetable({}, 'missing', [{ subject: 'DBMS', staffUserId: 'u1', periodsPerWeek: 1 }]),
      academicService.ClassValidationError,
    );
  });

  await t.test('rejects regenerating an already-Approved class', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1', timetable_status: 'Approved' }));
    t.after(() => findClassMock.mock.restore());
    await assert.rejects(
      () => academicService.generateTimetable({}, 'class-1', [{ subject: 'DBMS', staffUserId: 'u1', periodsPerWeek: 1 }]),
      academicService.TimetableGenerationClassApprovedError,
    );
  });
});

test('generateTimetable placement', async (t) => {
  function mockLookups(t, { periods = PERIODS, existingForClass = [] } = {}) {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1', timetable_status: 'Draft' }));
    const findPeriodsMock = t.mock.method(timetablePeriodRepository, 'findAllByCollege', async () => periods);
    const findExistingMock = t.mock.method(facultyAllocationRepository, 'findByClassId', async () => existingForClass);
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    // RS-TTB-001's shuffle-and-retry loop removes a failed attempt's
    // own rows before trying the next candidate order — a genuinely
    // new call these pre-existing fixtures never needed to stub.
    const removeMock = t.mock.method(facultyAllocationRepository, 'remove', async () => {});
    return {
      restore: () => {
        findClassMock.mock.restore();
        findPeriodsMock.mock.restore();
        findExistingMock.mock.restore();
        auditMock.mock.restore();
        removeMock.mock.restore();
      },
    };
  }

  await t.test('places requirements into the earliest available periods in calendar order', async () => {
    const { restore } = mockLookups(t);
    const createMock = t.mock.method(facultyAllocationRepository, 'create', async (client, fields) => ({ id: `alloc-${fields.periodId}`, ...fields }));
    t.after(() => {
      restore();
      createMock.mock.restore();
    });

    const result = await academicService.generateTimetable({}, 'class-1', [
      { subject: 'DBMS', staffUserId: 'staff-1', periodsPerWeek: 2 },
    ], { actorUserId: 'principal-1' });

    assert.equal(result.placements.length, 2);
    assert.equal(result.conflicts.length, 0);
    assert.equal(result.placements[0].periodId, 'mon-1');
    assert.equal(result.placements[1].periodId, 'mon-2');
  });

  await t.test('skips a period already used by this class', async () => {
    const { restore } = mockLookups(t, { existingForClass: [{ period_id: 'mon-1' }] });
    const createMock = t.mock.method(facultyAllocationRepository, 'create', async (client, fields) => ({ id: `alloc-${fields.periodId}`, ...fields }));
    t.after(() => {
      restore();
      createMock.mock.restore();
    });

    const result = await academicService.generateTimetable({}, 'class-1', [
      { subject: 'DBMS', staffUserId: 'staff-1', periodsPerWeek: 1 },
    ]);
    assert.equal(result.placements[0].periodId, 'mon-2');
  });

  await t.test('falls back to the next period when the staff member is already booked elsewhere (DB conflict)', async () => {
    const { restore } = mockLookups(t);
    const createMock = t.mock.method(facultyAllocationRepository, 'create', async (client, fields) => {
      if (fields.periodId === 'mon-1') {
        const err = new Error('dup');
        err.code = '23505';
        throw err;
      }
      return { id: `alloc-${fields.periodId}`, ...fields };
    });
    t.after(() => {
      restore();
      createMock.mock.restore();
    });

    const result = await academicService.generateTimetable({}, 'class-1', [
      { subject: 'DBMS', staffUserId: 'staff-1', periodsPerWeek: 1 },
    ]);
    assert.equal(result.placements.length, 1);
    assert.equal(result.placements[0].periodId, 'mon-2');
  });

  await t.test('reports a conflict when there are not enough free periods', async () => {
    const { restore } = mockLookups(t);
    const createMock = t.mock.method(facultyAllocationRepository, 'create', async (client, fields) => ({ id: `alloc-${fields.periodId}`, ...fields }));
    t.after(() => {
      restore();
      createMock.mock.restore();
    });

    const result = await academicService.generateTimetable({}, 'class-1', [
      { subject: 'DBMS', staffUserId: 'staff-1', periodsPerWeek: 10 },
    ]);
    assert.equal(result.placements.length, 3);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].placed, 3);
    assert.equal(result.conflicts[0].requested, 10);
  });

  await t.test('a later requirement does not reuse a period already placed by an earlier one', async () => {
    const { restore } = mockLookups(t);
    const createMock = t.mock.method(facultyAllocationRepository, 'create', async (client, fields) => ({ id: `alloc-${fields.periodId}`, ...fields }));
    t.after(() => {
      restore();
      createMock.mock.restore();
    });

    const result = await academicService.generateTimetable({}, 'class-1', [
      { subject: 'DBMS', staffUserId: 'staff-1', periodsPerWeek: 1 },
      { subject: 'OS', staffUserId: 'staff-2', periodsPerWeek: 1 },
    ]);
    assert.equal(result.placements[0].periodId, 'mon-1');
    assert.equal(result.placements[1].periodId, 'mon-2');
  });
});
