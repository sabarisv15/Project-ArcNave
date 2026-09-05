'use strict';

// RS-TTB-001 additions to academicService — generateSlotGrid,
// generateTimetable's Theory/Practical + co-teaching + session-block +
// max-hours/day + ownership extensions, and reviseTimetable. Same
// node:test mock-the-repositories technique as
// timetable-generation-service.test.js (that file's own original
// tests are left untouched and still pass unmodified — see
// generateTimetable's own comment on attempt-1 byte-identical
// behavior).

const test = require('node:test');
const assert = require('node:assert/strict');
const classRepository = require('../src/repositories/classRepository');
const timetablePeriodRepository = require('../src/repositories/timetablePeriodRepository');
const facultyAllocationRepository = require('../src/repositories/facultyAllocationRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const identityService = require('../src/services/identityService');
const workflowChainService = require('../src/services/workflowChainService');
const workflowService = require('../src/services/workflowService');
const academicService = require('../src/services/academicService');

test('generateSlotGrid', async (t) => {
  await t.test('rejects missing config', async () => {
    await assert.rejects(
      () => academicService.generateSlotGrid({}, 'college-1', {}),
      academicService.TimetableConfigValidationError,
    );
  });

  await t.test('rejects an unrecognized working day', async () => {
    await assert.rejects(
      () =>
        academicService.generateSlotGrid({}, 'college-1', {
          workingDays: ['Funday'],
          startTime: '09:00',
          endTime: '10:00',
          slotDurationMinutes: 60,
        }),
      academicService.TimetableConfigValidationError,
    );
  });

  await t.test(
    'builds a slot grid from working days/start/end/duration/break, skipping breaks and existing slots',
    async () => {
      const existing = new Set(['Monday-1']);
      const findMock = t.mock.method(
        timetablePeriodRepository,
        'findByCollegeDayAndHour',
        async (client, collegeId, day, hourIndex) => {
          const key = `${day}-${hourIndex}`;
          return existing.has(key) ? { id: key, day_of_week: day, hour_index: hourIndex } : null;
        },
      );
      const createMock = t.mock.method(timetablePeriodRepository, 'create', async (client, fields) => ({
        id: `${fields.dayOfWeek}-${fields.hourIndex}`,
        ...fields,
      }));
      const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
      t.after(() => {
        findMock.mock.restore();
        createMock.mock.restore();
        auditMock.mock.restore();
      });

      // 09:00-11:00, 60-min slots, break after every 1 slot -> Slot 1
      // (09:00-10:00), break (10:00-11:00 skipped), no room for Slot 2.
      const result = await academicService.generateSlotGrid(
        {},
        'college-1',
        {
          workingDays: ['Monday', 'Tuesday'],
          startTime: '09:00',
          endTime: '11:00',
          slotDurationMinutes: 60,
          breakAfterSlots: 1,
        },
        { actorUserId: 'principal-1' },
      );

      assert.equal(result.slotsPerDay, 1);
      assert.equal(result.totalWeeklySlots, 2);
      // Monday-1 already existed -> skipped, not recreated.
      assert.equal(result.created.length, 1);
      assert.equal(result.created[0].dayOfWeek, 'Tuesday');
      assert.equal(result.skipped.length, 1);
    },
  );
});

test('generateTimetable — Theory/Practical/co-teaching/session blocks', async (t) => {
  const PERIODS = [
    { id: 'mon-1', day_of_week: 'Monday', hour_index: 1, start_time: '09:00:00', end_time: '10:00:00' },
    { id: 'mon-2', day_of_week: 'Monday', hour_index: 2, start_time: '10:00:00', end_time: '11:00:00' },
    { id: 'mon-3', day_of_week: 'Monday', hour_index: 3, start_time: '11:00:00', end_time: '12:00:00' },
    { id: 'tue-1', day_of_week: 'Tuesday', hour_index: 1, start_time: '09:00:00', end_time: '10:00:00' },
  ];

  function mockLookups(t, { periods = PERIODS, existingForClass = [], staffAllocations = [] } = {}) {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({
      id: 'class-1',
      college_id: 'c1',
      timetable_status: 'Draft',
      max_hours_per_day_per_staff: null,
    }));
    const findPeriodsMock = t.mock.method(timetablePeriodRepository, 'findAllByCollege', async () => periods);
    const findExistingMock = t.mock.method(facultyAllocationRepository, 'findByClassId', async () => existingForClass);
    const findByStaffMock = t.mock.method(
      facultyAllocationRepository,
      'findByStaffUserId',
      async () => staffAllocations,
    );
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    const removeMock = t.mock.method(facultyAllocationRepository, 'remove', async () => {});
    return () => {
      findClassMock.mock.restore();
      findPeriodsMock.mock.restore();
      findExistingMock.mock.restore();
      findByStaffMock.mock.restore();
      auditMock.mock.restore();
      removeMock.mock.restore();
    };
  }

  await t.test('rejects Theory with two faculty', async (t2) => {
    const restore = mockLookups(t2);
    t2.after(restore);
    await assert.rejects(
      () =>
        academicService.generateTimetable({}, 'class-1', [
          {
            subject: 'Maths',
            subjectType: 'Theory',
            staffUserIds: ['s1', 's2'],
            periodsPerWeek: 1,
          },
        ]),
      academicService.TimetableGenerationValidationError,
    );
  });

  await t.test('rejects Practical with three faculty', async (t2) => {
    const restore = mockLookups(t2);
    t2.after(restore);
    await assert.rejects(
      () =>
        academicService.generateTimetable({}, 'class-1', [
          {
            subject: 'Physics Lab',
            subjectType: 'Practical',
            staffUserIds: ['s1', 's2', 's3'],
            periodsPerWeek: 1,
          },
        ]),
      academicService.TimetableGenerationValidationError,
    );
  });

  await t.test('rejects sessionBlocks that do not sum to periodsPerWeek', async (t2) => {
    const restore = mockLookups(t2);
    t2.after(restore);
    await assert.rejects(
      () =>
        academicService.generateTimetable({}, 'class-1', [
          {
            subject: 'Physics Lab',
            subjectType: 'Practical',
            staffUserIds: ['s1'],
            periodsPerWeek: 5,
            sessionBlocks: [2, 2],
          },
        ]),
      academicService.TimetableGenerationValidationError,
    );
  });

  await t.test(
    'places a two-faculty practical block as one continuous window, both faculty on every row',
    async (t2) => {
      const restore = mockLookups(t2);
      const createMock = t2.mock.method(facultyAllocationRepository, 'create', async (client, fields) => ({
        id: `alloc-${fields.periodId}-${fields.staffUserId}`,
        ...fields,
      }));
      t2.after(() => {
        restore();
        createMock.mock.restore();
      });

      const result = await academicService.generateTimetable({}, 'class-1', [
        {
          subject: 'Physics Lab',
          subjectType: 'Practical',
          staffUserIds: ['fac-1', 'fac-2'],
          periodsPerWeek: 2,
          sessionBlocks: [2],
        },
      ]);

      assert.equal(result.conflicts.length, 0);
      // 2-hour block x 2 faculty = 4 rows, all sharing one sessionBlockId.
      assert.equal(result.placements.length, 4);
      const blockIds = new Set(result.placements.map((p) => p.sessionBlockId));
      assert.equal(blockIds.size, 1);
      const periodIds = new Set(result.placements.map((p) => p.periodId));
      assert.deepEqual([...periodIds].sort(), ['mon-1', 'mon-2']);
    },
  );

  await t.test('max hours/day per staff blocks a placement that would exceed the cap', async (t2) => {
    // Monday-only fixture — with Tuesday's period available the third
    // hour would simply land there instead (the cap is per-day, not
    // weekly), which would defeat the point of this test.
    const restore = mockLookups(t2, { periods: PERIODS.filter((p) => p.day_of_week === 'Monday') });
    const createMock = t2.mock.method(facultyAllocationRepository, 'create', async (client, fields) => ({
      id: `alloc-${fields.periodId}`,
      period_id: fields.periodId,
      staff_user_id: fields.staffUserId,
      session_block_id: fields.sessionBlockId,
      ...fields,
    }));
    t2.after(() => {
      restore();
      createMock.mock.restore();
    });

    const result = await academicService.generateTimetable(
      {},
      'class-1',
      [{ subject: 'Maths', subjectType: 'Theory', staffUserIds: ['fac-1'], periodsPerWeek: 3 }],
      { maxHoursPerDay: 2 },
    );

    // Only Monday has periods in this fixture; cap of 2 hrs/day means
    // only 2 of the 3 requested Monday periods can go to fac-1.
    assert.equal(result.placements.length, 2);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].category, 'Daily Hour Limit');
  });

  await t.test('returns a generation summary with a quality score', async (t2) => {
    const restore = mockLookups(t2);
    const createMock = t2.mock.method(facultyAllocationRepository, 'create', async (client, fields) => ({
      id: `alloc-${fields.periodId}`,
      period_id: fields.periodId,
      staff_user_id: fields.staffUserId,
      session_block_id: fields.sessionBlockId,
      ...fields,
    }));
    t2.after(() => {
      restore();
      createMock.mock.restore();
    });

    const result = await academicService.generateTimetable({}, 'class-1', [
      { subject: 'Maths', staffUserId: 'fac-1', periodsPerWeek: 2 },
    ]);
    assert.equal(typeof result.summary.qualityScore, 'number');
    assert.equal(result.summary.conflictCount, 0);
    assert.equal(result.summary.totalTeachingHoursAllocated, 2);
  });

  await t.test("a staff-role actor who is not this class's tutor is forbidden", async (t2) => {
    const restore = mockLookups(t2);
    const resolveMock = t2.mock.method(identityService, 'resolvePositionOccupant', async () => 'someone-else');
    t2.after(() => {
      restore();
      resolveMock.mock.restore();
    });

    await assert.rejects(
      () =>
        academicService.generateTimetable(
          {},
          'class-1',
          [{ subject: 'Maths', staffUserId: 'fac-1', periodsPerWeek: 1 }],
          { actorUserId: 'tutor-1', actorRole: 'staff' },
        ),
      academicService.TimetableGenerationForbiddenError,
    );
  });

  // 4-login authorization architecture (2026-08-09) — the critical
  // regression case: tutor-1 IS the real, resolved tutor of class-1
  // (Position Occupancy), but is using their personal Staff login
  // (actorRole: 'staff'), not the L4 Position Account login. Now
  // rejected — this test previously asserted the opposite (the exact
  // merge this architecture removes); the sibling test right below
  // ("a class_tutor-effectiveRole actor... is allowed") covers the
  // real, still-legitimate path.
  await t.test(
    "a staff-role actor who IS this class's tutor is still forbidden (Position Occupancy alone is not Current Login Identity)",
    async (t2) => {
      const restore = mockLookups(t2);
      const resolveMock = t2.mock.method(identityService, 'resolvePositionOccupant', async () => 'tutor-1');
      t2.after(() => {
        restore();
        resolveMock.mock.restore();
      });

      await assert.rejects(
        () =>
          academicService.generateTimetable(
            {},
            'class-1',
            [{ subject: 'Maths', staffUserId: 'fac-1', periodsPerWeek: 1 }],
            { actorUserId: 'tutor-1', actorRole: 'staff' },
          ),
        academicService.TimetableGenerationForbiddenError,
      );
    },
  );

  await t.test(
    "a class_tutor-effectiveRole actor (genuine Position Account seat login) who IS this class's tutor is allowed",
    async (t2) => {
      // Regression test for this session's own bug: a seat login's
      // effectiveRole is 'class_tutor', not 'staff' — the original
      // ownership check only ever recognized 'staff', so a real seat
      // login was silently never admitted at all.
      const restore = mockLookups(t2);
      const resolveMock = t2.mock.method(identityService, 'resolvePositionOccupant', async () => 'tutor-1');
      const createMock = t2.mock.method(facultyAllocationRepository, 'create', async (client, fields) => ({
        id: `alloc-${fields.periodId}`,
        period_id: fields.periodId,
        staff_user_id: fields.staffUserId,
        session_block_id: fields.sessionBlockId,
        ...fields,
      }));
      t2.after(() => {
        restore();
        resolveMock.mock.restore();
        createMock.mock.restore();
      });

      const result = await academicService.generateTimetable(
        {},
        'class-1',
        [{ subject: 'Maths', staffUserId: 'fac-1', periodsPerWeek: 1 }],
        { actorUserId: 'tutor-1', actorRole: 'class_tutor' },
      );
      assert.equal(result.conflicts.length, 0);
    },
  );

  await t.test("a class_tutor-effectiveRole actor who is NOT this class's tutor is forbidden", async (t2) => {
    const restore = mockLookups(t2);
    const resolveMock = t2.mock.method(identityService, 'resolvePositionOccupant', async () => 'someone-else');
    t2.after(() => {
      restore();
      resolveMock.mock.restore();
    });

    await assert.rejects(
      () =>
        academicService.generateTimetable(
          {},
          'class-1',
          [{ subject: 'Maths', staffUserId: 'fac-1', periodsPerWeek: 1 }],
          { actorUserId: 'tutor-1', actorRole: 'class_tutor' },
        ),
      academicService.TimetableGenerationForbiddenError,
    );
  });

  await t.test('a principal actor is never ownership-checked', async (t2) => {
    const restore = mockLookups(t2);
    const resolveMock = t2.mock.method(identityService, 'resolvePositionOccupant', async () => {
      throw new Error('should not be called');
    });
    const createMock = t2.mock.method(facultyAllocationRepository, 'create', async (client, fields) => ({
      id: `alloc-${fields.periodId}`,
      period_id: fields.periodId,
      staff_user_id: fields.staffUserId,
      session_block_id: fields.sessionBlockId,
      ...fields,
    }));
    t2.after(() => {
      restore();
      resolveMock.mock.restore();
      createMock.mock.restore();
    });

    const result = await academicService.generateTimetable(
      {},
      'class-1',
      [{ subject: 'Maths', staffUserId: 'fac-1', periodsPerWeek: 1 }],
      { actorUserId: 'principal-1', actorRole: 'principal' },
    );
    assert.equal(result.conflicts.length, 0);
  });
});

test('reviseTimetable', async (t) => {
  const PERIODS = [
    { id: 'mon-1', day_of_week: 'Monday', hour_index: 1, start_time: '09:00:00', end_time: '10:00:00' },
    { id: 'mon-2', day_of_week: 'Monday', hour_index: 2, start_time: '10:00:00', end_time: '11:00:00' },
  ];

  await t.test("removes only the changed subject's rows and leaves the other subject untouched", async (t2) => {
    const findClassMock = t2.mock.method(classRepository, 'findById', async () => ({
      id: 'class-1',
      college_id: 'c1',
      department_id: 'dept-1',
      timetable_status: 'Approved',
      max_hours_per_day_per_staff: null,
    }));
    const findPeriodsMock = t2.mock.method(timetablePeriodRepository, 'findAllByCollege', async () => PERIODS);
    const existingRows = [
      {
        id: 'alloc-maths',
        class_id: 'class-1',
        period_id: 'mon-1',
        subject: 'Maths',
        staff_user_id: 'old-fac',
      },
      {
        id: 'alloc-physics',
        class_id: 'class-1',
        period_id: 'mon-2',
        subject: 'Physics',
        staff_user_id: 'fac-2',
      },
    ];
    const removedIds = [];
    const findBySubjectMock = t2.mock.method(
      facultyAllocationRepository,
      'findByClassAndSubject',
      async (client, classId, subject) => existingRows.filter((r) => r.subject === subject),
    );
    const removeMock = t2.mock.method(facultyAllocationRepository, 'remove', async (client, id) => {
      removedIds.push(id);
    });
    const findByClassMock = t2.mock.method(facultyAllocationRepository, 'findByClassId', async () =>
      existingRows.filter((r) => !removedIds.includes(r.id)),
    );
    const findByStaffMock = t2.mock.method(facultyAllocationRepository, 'findByStaffUserId', async () => []);
    const createMock = t2.mock.method(facultyAllocationRepository, 'create', async (client, fields) => ({
      id: `alloc-${fields.periodId}`,
      period_id: fields.periodId,
      staff_user_id: fields.staffUserId,
      session_block_id: fields.sessionBlockId,
      ...fields,
    }));
    // reviseTimetable calls submitTimetableForApproval as a bare local
    // function reference, not through module.exports — mocking that
    // export wouldn't be seen by the internal call, so its own real
    // dependencies (workflowChainService/workflowService/
    // classRepository.update) are stubbed instead, letting the real
    // submitTimetableForApproval run.
    const resolveChainMock = t2.mock.method(workflowChainService, 'resolveApproverChain', async () => [
      'hod-1',
      'principal-1',
    ]);
    const submitRequestMock = t2.mock.method(workflowService, 'submitRequest', async () => ({
      id: 'wf-1',
      status: 'Pending',
    }));
    const updateClassMock = t2.mock.method(classRepository, 'update', async () => ({
      id: 'class-1',
      timetable_status: 'Pending HOD',
    }));
    const auditMock = t2.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t2.after(() => {
      findClassMock.mock.restore();
      findPeriodsMock.mock.restore();
      findBySubjectMock.mock.restore();
      removeMock.mock.restore();
      findByClassMock.mock.restore();
      findByStaffMock.mock.restore();
      createMock.mock.restore();
      resolveChainMock.mock.restore();
      submitRequestMock.mock.restore();
      updateClassMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await academicService.reviseTimetable(
      {},
      'class-1',
      [{ subject: 'Maths', staffUserId: 'new-fac', periodsPerWeek: 1 }],
      { actorUserId: 'tutor-1' },
    );

    assert.deepEqual(removedIds, ['alloc-maths']);
    assert.equal(result.removedSessions.length, 1);
    assert.equal(result.removedSessions[0].subject, 'Maths');
    assert.equal(result.workflowRequest.id, 'wf-1');
    assert.equal(result.conflicts.length, 0);
  });
});
