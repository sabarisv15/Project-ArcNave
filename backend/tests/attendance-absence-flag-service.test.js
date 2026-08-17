'use strict';

// Unit tests for RS-ATT-008's absence-flag mechanism (D6, Stage 6,
// ADL-011) — no live Postgres needed: attendanceRepository/
// attendanceAbsenceFlagRepository/academicService/identityService/
// auditLogRepository are stubbed via node:test's built-in mock, same
// technique as every other *-service.test.js file in this suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const attendanceRepository = require('../src/repositories/attendanceRepository');
const attendanceAbsenceFlagRepository = require('../src/repositories/attendanceAbsenceFlagRepository');
const academicService = require('../src/services/academicService');
const identityService = require('../src/services/identityService');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const visibilityService = require('../src/services/visibilityService');
const authRepository = require('../src/repositories/authRepository');
const notificationService = require('../src/services/notificationService');
const attendanceService = require('../src/services/attendanceService');

const APPROVED_CLASS = {
  id: 'class-1', college_id: 'c1', department_id: 'dept-1', timetable_status: 'Approved',
};

function daySession(date, absentIds) {
  return { session_date: date, absent_student_ids: absentIds };
}

test('markAttendance raises an absence flag on the 6th consecutive full-day absence (RS-ATT-008)', async (t) => {
  await t.test('does not raise a flag at exactly 5 consecutive full-day absences', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass', async () => APPROVED_CLASS);
    const resolveTutorMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'tutor-user');
    const findMock = t.mock.method(attendanceRepository, 'findByClassSessionAndHour', async () => null);
    const createMock = t.mock.method(attendanceRepository, 'create', async (client, fields) => ({ id: 'session-new', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    // 5 prior full-day absences (days 1-5) for stu-1, plus the new
    // session being marked (day 6) — findByClassAndDateRange returns
    // the PRIOR history only (the just-marked session hasn't been
    // persisted through this mock's create()), so the compute function
    // sees exactly 5 full-day absences, not 6.
    const findRangeMock = t.mock.method(attendanceRepository, 'findByClassAndDateRange', async () => [
      daySession('2026-07-01', ['stu-1']),
      daySession('2026-07-02', ['stu-1']),
      daySession('2026-07-03', ['stu-1']),
      daySession('2026-07-04', ['stu-1']),
      daySession('2026-07-05', ['stu-1']),
    ]);
    const createFlagMock = t.mock.method(attendanceAbsenceFlagRepository, 'create');
    t.after(() => {
      getClassMock.mock.restore();
      resolveTutorMock.mock.restore();
      findMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
      findRangeMock.mock.restore();
      createFlagMock.mock.restore();
    });

    await attendanceService.markAttendance(
      {},
      { classId: 'class-1', sessionDate: '2026-07-06', hourIndex: 1, absentStudentIds: ['stu-1'], totalStudents: 40 },
      { actorUserId: 'tutor-user', actorRole: 'class_tutor' },
    );

    assert.equal(createFlagMock.mock.callCount(), 0);
  });

  await t.test('raises exactly one flag on the 6th consecutive full-day absence, and skips if one is already outstanding', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass', async () => APPROVED_CLASS);
    const resolveTutorMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'tutor-user');
    const findMock = t.mock.method(attendanceRepository, 'findByClassSessionAndHour', async () => null);
    const createMock = t.mock.method(attendanceRepository, 'create', async (client, fields) => ({ id: 'session-new', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    // Two sessions on the same day (both must be absent for the day to
    // count as a full-day absence) plus 5 single-session prior days —
    // 6 consecutive full working days, all fully absent.
    const findRangeMock = t.mock.method(attendanceRepository, 'findByClassAndDateRange', async () => [
      daySession('2026-07-01', ['stu-1']),
      daySession('2026-07-02', ['stu-1']),
      daySession('2026-07-03', ['stu-1']),
      daySession('2026-07-04', ['stu-1']),
      daySession('2026-07-05', ['stu-1']),
      daySession('2026-07-06', ['stu-1']),
    ]);
    const findOutstandingMock = t.mock.method(attendanceAbsenceFlagRepository, 'findOutstandingForStudent', async () => null);
    const createFlagMock = t.mock.method(attendanceAbsenceFlagRepository, 'create', async (client, fields) => ({ id: 'flag-1', ...fields }));
    // RS-ATT-008 / RS-NTF-005: raising the flag also notifies the HOD —
    // resolvePositionOccupant is already mocked above (shared with the
    // tutor resolution), so getUserById/sendViaChannel need their own
    // stubs to avoid hitting a real (unmocked) DB client.
    const getUserMock = t.mock.method(authRepository, 'getUserById', async () => ({ id: 'tutor-user', email: 'hod@example.com' }));
    const sendMock = t.mock.method(notificationService, 'sendViaChannel', async () => ({ status: 'sent' }));
    t.after(() => {
      getClassMock.mock.restore();
      resolveTutorMock.mock.restore();
      findMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
      findRangeMock.mock.restore();
      findOutstandingMock.mock.restore();
      createFlagMock.mock.restore();
      getUserMock.mock.restore();
      sendMock.mock.restore();
    });

    await attendanceService.markAttendance(
      {},
      { classId: 'class-1', sessionDate: '2026-07-07', hourIndex: 1, absentStudentIds: ['stu-1'], totalStudents: 40 },
      { actorUserId: 'tutor-user', actorRole: 'class_tutor' },
    );

    assert.equal(createFlagMock.mock.callCount(), 1);
    assert.equal(createFlagMock.mock.calls[0].arguments[1].consecutiveAbsentDays, 6);
    assert.equal(auditMock.mock.calls.some((c) => c.arguments[1].action === 'attendance_absence_flag_raised'), true);
    assert.equal(sendMock.mock.callCount(), 1);
  });

  await t.test('a concurrent double-raise (23505 on the partial unique index) is swallowed quietly, not thrown', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass', async () => APPROVED_CLASS);
    const resolveTutorMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'tutor-user');
    const findMock = t.mock.method(attendanceRepository, 'findByClassSessionAndHour', async () => null);
    const createMock = t.mock.method(attendanceRepository, 'create', async (client, fields) => ({ id: 'session-new', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    const findRangeMock = t.mock.method(attendanceRepository, 'findByClassAndDateRange', async () => [
      daySession('2026-07-01', ['stu-1']),
      daySession('2026-07-02', ['stu-1']),
      daySession('2026-07-03', ['stu-1']),
      daySession('2026-07-04', ['stu-1']),
      daySession('2026-07-05', ['stu-1']),
      daySession('2026-07-06', ['stu-1']),
    ]);
    // findOutstandingForStudent still sees nothing (the race: another
    // concurrent call's own findOutstandingForStudent also saw
    // nothing, and its create() has already committed by the time this
    // one runs) — the partial unique index is what actually catches it.
    const findOutstandingMock = t.mock.method(attendanceAbsenceFlagRepository, 'findOutstandingForStudent', async () => null);
    const createFlagMock = t.mock.method(attendanceAbsenceFlagRepository, 'create', async () => {
      const err = new Error('duplicate key value violates unique constraint "attendance_absence_flags_student_outstanding_key"');
      err.code = '23505';
      err.constraint = 'attendance_absence_flags_student_outstanding_key';
      throw err;
    });
    t.after(() => {
      getClassMock.mock.restore();
      resolveTutorMock.mock.restore();
      findMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
      findRangeMock.mock.restore();
      findOutstandingMock.mock.restore();
      createFlagMock.mock.restore();
    });

    await assert.doesNotReject(() => attendanceService.markAttendance(
      {},
      { classId: 'class-1', sessionDate: '2026-07-07', hourIndex: 1, absentStudentIds: ['stu-1'], totalStudents: 40 },
      { actorUserId: 'tutor-user', actorRole: 'class_tutor' },
    ));
  });

  await t.test('does not raise a second flag while one is already outstanding for the student', async () => {
    const getClassMock = t.mock.method(academicService, 'getClass', async () => APPROVED_CLASS);
    const resolveTutorMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'tutor-user');
    const findMock = t.mock.method(attendanceRepository, 'findByClassSessionAndHour', async () => null);
    const createMock = t.mock.method(attendanceRepository, 'create', async (client, fields) => ({ id: 'session-new', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    const findRangeMock = t.mock.method(attendanceRepository, 'findByClassAndDateRange', async () => [
      daySession('2026-07-01', ['stu-1']),
      daySession('2026-07-02', ['stu-1']),
      daySession('2026-07-03', ['stu-1']),
      daySession('2026-07-04', ['stu-1']),
      daySession('2026-07-05', ['stu-1']),
      daySession('2026-07-06', ['stu-1']),
    ]);
    const findOutstandingMock = t.mock.method(attendanceAbsenceFlagRepository, 'findOutstandingForStudent', async () => ({ id: 'flag-existing' }));
    const createFlagMock = t.mock.method(attendanceAbsenceFlagRepository, 'create');
    t.after(() => {
      getClassMock.mock.restore();
      resolveTutorMock.mock.restore();
      findMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
      findRangeMock.mock.restore();
      findOutstandingMock.mock.restore();
      createFlagMock.mock.restore();
    });

    await attendanceService.markAttendance(
      {},
      { classId: 'class-1', sessionDate: '2026-07-07', hourIndex: 1, absentStudentIds: ['stu-1'], totalStudents: 40 },
      { actorUserId: 'tutor-user', actorRole: 'class_tutor' },
    );

    assert.equal(createFlagMock.mock.callCount(), 0);
  });
});

test('closeAbsenceFlag', async (t) => {
  await t.test('rejects an unknown flag', async () => {
    const findMock = t.mock.method(attendanceAbsenceFlagRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());
    await assert.rejects(
      () => attendanceService.closeAbsenceFlag({}, 'missing', { actorUserId: 'hod-1', actorRole: 'hod' }),
      attendanceService.AttendanceAbsenceFlagNotFoundError,
    );
  });

  await t.test('rejects an already-closed flag', async () => {
    const findMock = t.mock.method(attendanceAbsenceFlagRepository, 'findById', async () => ({ id: 'flag-1', closed_at: '2026-01-01T00:00:00Z' }));
    t.after(() => findMock.mock.restore());
    await assert.rejects(
      () => attendanceService.closeAbsenceFlag({}, 'flag-1', { actorUserId: 'hod-1', actorRole: 'hod' }),
      attendanceService.AttendanceAbsenceFlagAlreadyClosedError,
    );
  });

  await t.test('rejects an hod who is not the flag\'s own department hod', async () => {
    const findMock = t.mock.method(attendanceAbsenceFlagRepository, 'findById', async () => ({
      id: 'flag-1', college_id: 'c1', class_id: 'class-1', closed_at: null,
    }));
    const getClassMock = t.mock.method(academicService, 'getClass', async () => APPROVED_CLASS);
    const resolveHodMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'real-hod');
    t.after(() => {
      findMock.mock.restore();
      getClassMock.mock.restore();
      resolveHodMock.mock.restore();
    });

    await assert.rejects(
      () => attendanceService.closeAbsenceFlag({}, 'flag-1', { actorUserId: 'other-hod', actorRole: 'hod' }),
      attendanceService.AttendanceAbsenceFlagNotAuthorizedError,
    );
  });

  await t.test('the flag\'s own department hod may close it', async () => {
    const findMock = t.mock.method(attendanceAbsenceFlagRepository, 'findById', async () => ({
      id: 'flag-1', college_id: 'c1', class_id: 'class-1', closed_at: null,
    }));
    const getClassMock = t.mock.method(academicService, 'getClass', async () => APPROVED_CLASS);
    const resolveHodMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'hod-1');
    const closeMock = t.mock.method(attendanceAbsenceFlagRepository, 'close', async (client, id, fields) => ({ id, closed_at: '2026-07-10T00:00:00Z', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      getClassMock.mock.restore();
      resolveHodMock.mock.restore();
      closeMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await attendanceService.closeAbsenceFlag({}, 'flag-1', { actorUserId: 'hod-1', actorRole: 'hod', remarks: 'contacted parent' });
    assert.ok(result.closed_at);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'attendance_absence_flag_closed');
  });

  await t.test('principal may close any flag without a department check', async () => {
    const findMock = t.mock.method(attendanceAbsenceFlagRepository, 'findById', async () => ({
      id: 'flag-1', college_id: 'c1', class_id: 'class-1', closed_at: null,
    }));
    const getClassMock = t.mock.method(academicService, 'getClass');
    const closeMock = t.mock.method(attendanceAbsenceFlagRepository, 'close', async (client, id, fields) => ({ id, closed_at: '2026-07-10T00:00:00Z', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      getClassMock.mock.restore();
      closeMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await attendanceService.closeAbsenceFlag({}, 'flag-1', { actorUserId: 'principal-1', actorRole: 'principal' });
    assert.ok(result.closed_at);
    assert.equal(getClassMock.mock.callCount(), 0);
  });
});

test('listOutstandingAbsenceFlagsForActor', async (t) => {
  await t.test('passes the actor\'s visible classIds straight through', async () => {
    const visibleMock = t.mock.method(visibilityService, 'getVisibleClassIds', async () => ['class-1']);
    const listMock = t.mock.method(attendanceAbsenceFlagRepository, 'listOutstanding', async (client, { classIds }) => {
      assert.deepEqual(classIds, ['class-1']);
      return [{ id: 'flag-1' }];
    });
    t.after(() => {
      visibleMock.mock.restore();
      listMock.mock.restore();
    });

    const result = await attendanceService.listOutstandingAbsenceFlagsForActor({}, { actorUserId: 'hod-1', actorRole: 'hod', collegeId: 'c1' });
    assert.equal(result.length, 1);
  });

  await t.test('an unrestricted actor (principal, null classIds) is never filtered', async () => {
    const visibleMock = t.mock.method(visibilityService, 'getVisibleClassIds', async () => null);
    const listMock = t.mock.method(attendanceAbsenceFlagRepository, 'listOutstanding', async (client, { classIds }) => {
      assert.equal(classIds, undefined);
      return [];
    });
    t.after(() => {
      visibleMock.mock.restore();
      listMock.mock.restore();
    });

    await attendanceService.listOutstandingAbsenceFlagsForActor({}, { actorUserId: 'principal-1', actorRole: 'principal', collegeId: 'c1' });
  });
});
