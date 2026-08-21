'use strict';

// Unit tests for AttendanceService's pure business-logic paths — no
// live Postgres needed: attendanceRepository, academicService, and
// auditLogRepository are stubbed via node:test's built-in mock,
// same technique as academic-service.test.js/staff-service.test.js
// (works because attendanceService always calls e.g.
// `attendanceRepository.create(...)` as a fresh property lookup, never
// a destructured local).
//
// What's deliberately NOT here: an actual
// attendance_sessions_class_date_hour_key violation reaching its
// domain error end-to-end through a real Postgres constraint, or a
// real jsonb-serialization error from passing a raw array instead of
// a JSON string. Both were live-verified against the real
// docker-compose Postgres while building this slice (see
// .ai/RESULT.md) — this file trusts that grounding rather than
// re-running a live database for a service layer that adds no new SQL
// of its own.

const test = require('node:test');
const assert = require('node:assert/strict');
const attendanceRepository = require('../src/repositories/attendanceRepository');
const academicService = require('../src/services/academicService');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const identityService = require('../src/services/identityService');
const attendanceService = require('../src/services/attendanceService');

const APPROVED_CLASS = {
  id: 'class-1',
  college_id: 'c1',
  timetable_status: 'Approved',
};

// Phase 2 step 15: assertCanMark's tutor check moved off
// classes.tutor_user_id onto identityService.resolvePositionOccupant's
// {classId} overload — mocked per-test below (tutor-user is the
// conceptual tutor of APPROVED_CLASS everywhere except where a test
// overrides it) rather than the class row carrying tutor_user_id.
function mockTutor(t, userId) {
  const mock = t.mock.method(identityService, 'resolvePositionOccupant', async () => userId);
  t.after(() => mock.mock.restore());
  return mock;
}

test('AttendanceService validation, authorization, and audit logging (no DB)', async (t) => {
  await t.test('markAttendance rejects a missing classId without touching the DB', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass');
    t.after(() => getClassMock.mock.restore());

    await assert.rejects(
      () => attendanceService.markAttendance({}, { sessionDate: '2026-07-04', hourIndex: 1, totalStudents: 10 }, { actorUserId: 'u1', actorRole: 'hod' }),
      attendanceService.AttendanceValidationError,
    );
    assert.equal(getClassMock.mock.callCount(), 0);
  });

  await t.test('markAttendance rejects a missing hourIndex without touching the DB', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass');
    t.after(() => getClassMock.mock.restore());

    await assert.rejects(
      () => attendanceService.markAttendance({}, { classId: 'class-1', sessionDate: '2026-07-04', totalStudents: 10 }, { actorUserId: 'u1', actorRole: 'hod' }),
      attendanceService.AttendanceValidationError,
    );
    assert.equal(getClassMock.mock.callCount(), 0);
  });

  await t.test('markAttendance rejects missing actor identity without touching the DB', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass');
    t.after(() => getClassMock.mock.restore());

    await assert.rejects(
      () => attendanceService.markAttendance({}, { classId: 'class-1', sessionDate: '2026-07-04', hourIndex: 1, totalStudents: 10 }, {}),
      attendanceService.AttendanceValidationError,
    );
    assert.equal(getClassMock.mock.callCount(), 0);
  });

  await t.test('markAttendance maps a nonexistent classId to AttendanceClassNotFoundError', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass', async () => null);
    t.after(() => getClassMock.mock.restore());

    await assert.rejects(
      () => attendanceService.markAttendance(
        {},
        { classId: 'missing-class', sessionDate: '2026-07-04', hourIndex: 1, totalStudents: 10 },
        { actorUserId: 'u1', actorRole: 'hod' },
      ),
      attendanceService.AttendanceClassNotFoundError,
    );
  });

  await t.test('markAttendance rejects a class whose timetable is not Approved', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass', async () => ({ ...APPROVED_CLASS, timetable_status: 'Pending HOD' }));
    t.after(() => getClassMock.mock.restore());

    await assert.rejects(
      () => attendanceService.markAttendance(
        {},
        { classId: 'class-1', sessionDate: '2026-07-04', hourIndex: 1, totalStudents: 10 },
        { actorUserId: 'tutor-user', actorRole: 'staff' },
      ),
      attendanceService.AttendanceTimetableNotApprovedError,
    );
  });

  await t.test('markAttendance rejects an actor who is neither the tutor, an HOD, nor scheduled for the period', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass', async () => APPROVED_CLASS);
    mockTutor(t, 'tutor-user');
    const getPeriodMock = t.mock.method(academicService, 'getTimetablePeriodByDayAndHour', async () => null);
    t.after(() => {
      getClassMock.mock.restore();
      getPeriodMock.mock.restore();
    });

    await assert.rejects(
      () => attendanceService.markAttendance(
        {},
        { classId: 'class-1', sessionDate: '2026-07-04', hourIndex: 1, totalStudents: 10 },
        { actorUserId: 'some-other-staff', actorRole: 'staff' },
      ),
      attendanceService.AttendanceForbiddenError,
    );
  });

  await t.test('markAttendance rejects a class with no tutor assigned when actor is not HOD or scheduled', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass', async () => APPROVED_CLASS);
    mockTutor(t, null);
    const getPeriodMock = t.mock.method(academicService, 'getTimetablePeriodByDayAndHour', async () => null);
    t.after(() => {
      getClassMock.mock.restore();
      getPeriodMock.mock.restore();
    });

    await assert.rejects(
      () => attendanceService.markAttendance(
        {},
        { classId: 'class-1', sessionDate: '2026-07-04', hourIndex: 1, totalStudents: 10 },
        { actorUserId: 'some-staff', actorRole: 'staff' },
      ),
      attendanceService.AttendanceForbiddenError,
    );
  });

  await t.test('markAttendance rejects when a period exists but this class has no allocation for it', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass', async () => APPROVED_CLASS);
    mockTutor(t, 'tutor-user');
    const getPeriodMock = t.mock.method(academicService, 'getTimetablePeriodByDayAndHour', async () => ({ id: 'period-1' }));
    const getAllocMock = t.mock.method(academicService, 'getFacultyAllocationForClassAndPeriod', async () => null);
    const getSubMock = t.mock.method(academicService, 'getSubstituteAssignment', async () => null);
    t.after(() => {
      getClassMock.mock.restore();
      getPeriodMock.mock.restore();
      getAllocMock.mock.restore();
      getSubMock.mock.restore();
    });

    await assert.rejects(
      () => attendanceService.markAttendance(
        {},
        { classId: 'class-1', sessionDate: '2026-07-04', hourIndex: 1, totalStudents: 10 },
        { actorUserId: 'some-staff', actorRole: 'staff' },
      ),
      attendanceService.AttendanceForbiddenError,
    );
  });

  await t.test('markAttendance rejects when an allocation exists but for a different staff member', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass', async () => APPROVED_CLASS);
    mockTutor(t, 'tutor-user');
    const getPeriodMock = t.mock.method(academicService, 'getTimetablePeriodByDayAndHour', async () => ({ id: 'period-1' }));
    const getAllocMock = t.mock.method(academicService, 'getFacultyAllocationForClassAndPeriod', async () => ({ staff_user_id: 'someone-else' }));
    const getSubMock = t.mock.method(academicService, 'getSubstituteAssignment', async () => null);
    t.after(() => {
      getClassMock.mock.restore();
      getPeriodMock.mock.restore();
      getAllocMock.mock.restore();
      getSubMock.mock.restore();
    });

    await assert.rejects(
      () => attendanceService.markAttendance(
        {},
        { classId: 'class-1', sessionDate: '2026-07-04', hourIndex: 1, totalStudents: 10 },
        { actorUserId: 'some-staff', actorRole: 'staff' },
      ),
      attendanceService.AttendanceForbiddenError,
    );
  });

  await t.test('markAttendance allows the staff member genuinely scheduled for that period, even without tutor/HOD status', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass', async () => APPROVED_CLASS);
    mockTutor(t, 'some-other-tutor');
    const getPeriodMock = t.mock.method(academicService, 'getTimetablePeriodByDayAndHour', async (client, collegeId, dayOfWeek, hourIndex) => {
      assert.equal(collegeId, 'c1');
      assert.equal(dayOfWeek, 'Saturday'); // 2026-07-04 is a Saturday
      assert.equal(hourIndex, 1);
      return { id: 'period-1' };
    });
    const getAllocMock = t.mock.method(academicService, 'getFacultyAllocationForClassAndPeriod', async (client, classId, periodId) => {
      assert.equal(classId, 'class-1');
      assert.equal(periodId, 'period-1');
      return { staff_user_id: 'scheduled-staff' };
    });
    const findMock = t.mock.method(attendanceRepository, 'findByClassSessionAndHour', async () => null);
    const createMock = t.mock.method(attendanceRepository, 'create', async (client, fields) => ({ id: 'session-scheduled', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      getClassMock.mock.restore();
      getPeriodMock.mock.restore();
      getAllocMock.mock.restore();
      findMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    await assert.doesNotReject(() => attendanceService.markAttendance(
      {},
      { classId: 'class-1', sessionDate: '2026-07-04', hourIndex: 1, totalStudents: 10 },
      { actorUserId: 'scheduled-staff', actorRole: 'staff' },
    ));
  });

  await t.test('markAttendance allows the class tutor to create a new session', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass', async () => APPROVED_CLASS);
    mockTutor(t, 'tutor-user');
    const findMock = t.mock.method(attendanceRepository, 'findByClassSessionAndHour', async () => null);
    const createMock = t.mock.method(attendanceRepository, 'create', async (client, fields) => ({ id: 'session-1', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    // RS-ATT-008 (D6, Stage 6): markAttendance now checks each
    // newly-absent student's consecutive-absence streak — mocked here
    // to a single-session, non-triggering history (see the dedicated
    // "raiseAbsenceFlagIfWarranted" test block below for the real
    // streak/flag-raising coverage).
    const findRangeMock = t.mock.method(attendanceRepository, 'findByClassAndDateRange', async () => []);
    t.after(() => {
      getClassMock.mock.restore();
      findMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
      findRangeMock.mock.restore();
    });

    const session = await attendanceService.markAttendance(
      {},
      { classId: 'class-1', sessionDate: '2026-07-04', hourIndex: 1, absentStudentIds: ['s1', 's2'], totalStudents: 40 },
      { actorUserId: 'tutor-user', actorRole: 'class_tutor' },
    );

    assert.equal(session.id, 'session-1');
    assert.equal(createMock.mock.callCount(), 1);
    const passedFields = createMock.mock.calls[0].arguments[1];
    assert.equal(passedFields.collegeId, 'c1');
    assert.equal(passedFields.markedByUserId, 'tutor-user');
    assert.equal(typeof passedFields.absentStudentIds, 'string');
    assert.deepEqual(JSON.parse(passedFields.absentStudentIds), ['s1', 's2']);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'attendance_marked');
    assert.equal(auditMock.mock.calls[0].arguments[1].entity, 'attendance_sessions');
    assert.equal(auditMock.mock.calls[0].arguments[1].userId, 'tutor-user');
  });

  // RS-ATT-002/RS-CLS-009 (D3, Stage 5): ownership-based, never title-
  // based — an HOD with no ownership over this specific hour (not its
  // tutor, not the scheduled faculty, not an approved substitute) is
  // rejected the same as anyone else.
  await t.test('markAttendance rejects an HOD force-marking a class they do not tutor (D3)', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass', async () => APPROVED_CLASS);
    mockTutor(t, 'tutor-user');
    const getPeriodMock = t.mock.method(academicService, 'getTimetablePeriodByDayAndHour', async () => null);
    t.after(() => {
      getClassMock.mock.restore();
      getPeriodMock.mock.restore();
    });

    await assert.rejects(() => attendanceService.markAttendance(
      {},
      { classId: 'class-1', sessionDate: '2026-07-04', hourIndex: 1, totalStudents: 40 },
      { actorUserId: 'hod-user', actorRole: 'hod' },
    ), attendanceService.AttendanceForbiddenError);
  });

  // 4-login authorization architecture (2026-08-09) — the critical
  // regression case: tutor-user genuinely occupies class-1's L4 seat
  // (mockTutor resolves it) and has no scheduled-period/substitute
  // ownership of this specific hour either, but is using their personal
  // Staff login (actorRole: 'staff'). The tutor's blanket "any hour of
  // my class" reach requires actorRole === 'class_tutor' — Position
  // Occupancy alone must not grant it.
  await t.test('markAttendance rejects a personal Staff login\'s blanket tutor reach — even when that person currently occupies the class\'s L4 seat', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass', async () => APPROVED_CLASS);
    mockTutor(t, 'tutor-user');
    const getPeriodMock = t.mock.method(academicService, 'getTimetablePeriodByDayAndHour', async () => null);
    t.after(() => {
      getClassMock.mock.restore();
      getPeriodMock.mock.restore();
    });

    await assert.rejects(() => attendanceService.markAttendance(
      {},
      { classId: 'class-1', sessionDate: '2026-07-04', hourIndex: 1, totalStudents: 40 },
      { actorUserId: 'tutor-user', actorRole: 'staff' },
    ), attendanceService.AttendanceForbiddenError);
  });

  await t.test('markAttendance defaults absentStudentIds to an empty array when omitted', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass', async () => APPROVED_CLASS);
    mockTutor(t, 'tutor-user');
    const findMock = t.mock.method(attendanceRepository, 'findByClassSessionAndHour', async () => null);
    const createMock = t.mock.method(attendanceRepository, 'create', async (client, fields) => ({ id: 'session-3', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      getClassMock.mock.restore();
      findMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    await attendanceService.markAttendance(
      {},
      { classId: 'class-1', sessionDate: '2026-07-04', hourIndex: 1, totalStudents: 40 },
      { actorUserId: 'tutor-user', actorRole: 'class_tutor' },
    );

    const passedFields = createMock.mock.calls[0].arguments[1];
    assert.equal(passedFields.absentStudentIds, '[]');
  });

  await t.test('markAttendance re-marks an existing, unlocked session instead of creating a new one', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass', async () => APPROVED_CLASS);
    mockTutor(t, 'tutor-user');
    const findMock = t.mock.method(attendanceRepository, 'findByClassSessionAndHour', async () => ({ id: 'session-4', locked_at: null, version: 1 }));
    const updateMock = t.mock.method(attendanceRepository, 'updateWithVersionCheck', async (client, id, fields) => ({ id, ...fields }));
    const createMock = t.mock.method(attendanceRepository, 'create');
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    const findRangeMock = t.mock.method(attendanceRepository, 'findByClassAndDateRange', async () => []);
    t.after(() => {
      getClassMock.mock.restore();
      findMock.mock.restore();
      updateMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
      findRangeMock.mock.restore();
    });

    const session = await attendanceService.markAttendance(
      {},
      { classId: 'class-1', sessionDate: '2026-07-04', hourIndex: 1, absentStudentIds: ['s9'], totalStudents: 40 },
      { actorUserId: 'tutor-user', actorRole: 'class_tutor' },
    );

    assert.equal(session.id, 'session-4');
    assert.equal(createMock.mock.callCount(), 0);
    assert.equal(updateMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'attendance_remarked');
  });

  await t.test('markAttendance rejects modifying an already-locked session', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass', async () => APPROVED_CLASS);
    mockTutor(t, 'tutor-user');
    const findMock = t.mock.method(attendanceRepository, 'findByClassSessionAndHour', async () => ({ id: 'session-5', locked_at: '2026-07-04T10:00:00Z' }));
    const updateMock = t.mock.method(attendanceRepository, 'update');
    t.after(() => {
      getClassMock.mock.restore();
      findMock.mock.restore();
      updateMock.mock.restore();
    });

    await assert.rejects(
      () => attendanceService.markAttendance(
        {},
        { classId: 'class-1', sessionDate: '2026-07-04', hourIndex: 1, totalStudents: 40 },
        { actorUserId: 'tutor-user', actorRole: 'class_tutor' },
      ),
      attendanceService.AttendanceLockedError,
    );
    assert.equal(updateMock.mock.callCount(), 0);
  });

  await t.test('markAttendance maps a class_date_hour race to AttendanceSessionConflictError', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass', async () => APPROVED_CLASS);
    mockTutor(t, 'tutor-user');
    const findMock = t.mock.method(attendanceRepository, 'findByClassSessionAndHour', async () => null);
    const createMock = t.mock.method(attendanceRepository, 'create', async () => {
      const err = new Error('duplicate key value violates unique constraint "attendance_sessions_class_date_hour_key"');
      err.code = '23505';
      err.constraint = 'attendance_sessions_class_date_hour_key';
      throw err;
    });
    t.after(() => {
      getClassMock.mock.restore();
      findMock.mock.restore();
      createMock.mock.restore();
    });

    await assert.rejects(
      () => attendanceService.markAttendance(
        {},
        { classId: 'class-1', sessionDate: '2026-07-04', hourIndex: 1, totalStudents: 40 },
        { actorUserId: 'tutor-user', actorRole: 'class_tutor' },
      ),
      attendanceService.AttendanceSessionConflictError,
    );
  });

  await t.test('markAttendance lets a non-conflict repository error pass through unchanged', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass', async () => APPROVED_CLASS);
    mockTutor(t, 'tutor-user');
    const findMock = t.mock.method(attendanceRepository, 'findByClassSessionAndHour', async () => null);
    const boom = new Error('connection lost');
    const createMock = t.mock.method(attendanceRepository, 'create', async () => { throw boom; });
    t.after(() => {
      getClassMock.mock.restore();
      findMock.mock.restore();
      createMock.mock.restore();
    });

    await assert.rejects(
      () => attendanceService.markAttendance(
        {},
        { classId: 'class-1', sessionDate: '2026-07-04', hourIndex: 1, totalStudents: 40 },
        { actorUserId: 'tutor-user', actorRole: 'class_tutor' },
      ),
      (err) => err === boom,
    );
  });

  await t.test('getAttendanceSession is a thin passthrough to findById', async () => {
    const findMock = t.mock.method(attendanceRepository, 'findById', async (client, id) => ({ id }));
    t.after(() => findMock.mock.restore());

    const result = await attendanceService.getAttendanceSession({}, 'session-9');
    assert.equal(result.id, 'session-9');
  });

  await t.test('listAttendanceSessionsForClassAndDate is a thin passthrough to findByClassAndDate', async () => {
    const findMock = t.mock.method(attendanceRepository, 'findByClassAndDate', async (client, classId, date) => ([{ classId, date }]));
    t.after(() => findMock.mock.restore());

    const result = await attendanceService.listAttendanceSessionsForClassAndDate({}, 'class-1', '2026-07-04');
    assert.deepEqual(result, [{ classId: 'class-1', date: '2026-07-04' }]);
  });
});

test('AttendanceService.computeAttendancePercentageForStudents (Students List Attendance % column)', async (t) => {
  await t.test('returns an empty Map without touching the DB when given no students', async () => {
    const listMock = t.mock.method(attendanceRepository, 'list');
    t.after(() => listMock.mock.restore());

    const result = await attendanceService.computeAttendancePercentageForStudents({}, []);

    assert.equal(result.size, 0);
    assert.equal(listMock.mock.callCount(), 0);
  });

  await t.test('a student whose class has zero sessions gets null, not 0 or NaN', async () => {
    const listMock = t.mock.method(attendanceRepository, 'list', async () => []);
    t.after(() => listMock.mock.restore());

    const result = await attendanceService.computeAttendancePercentageForStudents({}, [{ id: 's1', classId: 'c1' }]);

    assert.equal(result.get('s1'), null);
  });

  await t.test('a student with no classId at all gets null, never crashes', async () => {
    const listMock = t.mock.method(attendanceRepository, 'list', async () => [
      { class_id: 'c1', absent_student_ids: [] },
    ]);
    t.after(() => listMock.mock.restore());

    const result = await attendanceService.computeAttendancePercentageForStudents({}, [{ id: 's1', classId: null }]);

    assert.equal(result.get('s1'), null);
  });

  await t.test('a student present in every session of their class is 100%', async () => {
    const listMock = t.mock.method(attendanceRepository, 'list', async () => [
      { class_id: 'c1', absent_student_ids: [] },
      { class_id: 'c1', absent_student_ids: ['s2'] },
    ]);
    t.after(() => listMock.mock.restore());

    const result = await attendanceService.computeAttendancePercentageForStudents({}, [{ id: 's1', classId: 'c1' }]);

    assert.equal(result.get('s1'), 100);
  });

  await t.test('a student absent from half their class sessions is 50%', async () => {
    const listMock = t.mock.method(attendanceRepository, 'list', async () => [
      { class_id: 'c1', absent_student_ids: ['s1'] },
      { class_id: 'c1', absent_student_ids: [] },
    ]);
    t.after(() => listMock.mock.restore());

    const result = await attendanceService.computeAttendancePercentageForStudents({}, [{ id: 's1', classId: 'c1' }]);

    assert.equal(result.get('s1'), 50);
  });

  await t.test('a session belonging to a different class never counts toward this student', async () => {
    const listMock = t.mock.method(attendanceRepository, 'list', async () => [
      { class_id: 'c1', absent_student_ids: [] },
      { class_id: 'other-class', absent_student_ids: ['s1'] },
    ]);
    t.after(() => listMock.mock.restore());

    const result = await attendanceService.computeAttendancePercentageForStudents({}, [{ id: 's1', classId: 'c1' }]);

    assert.equal(result.get('s1'), 100);
  });
});
