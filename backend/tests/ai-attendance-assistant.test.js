'use strict';

// Unit tests for the AI attendance assistant path — no live Postgres
// needed: timetablePeriodRepository/facultyAllocationRepository/
// substituteAssignmentRepository/studentService/attendanceRepository/
// auditLogRepository are stubbed via node:test's built-in mock, same
// technique as every other *-service.test.js file in this suite.
// assertCanMark's tutor check moved off classes.tutor_user_id onto
// identityService.resolvePositionOccupant's {classId} overload in
// Phase 2 step 15 — mocked here rather than the class row carrying
// tutor_user_id.

const test = require('node:test');
const assert = require('node:assert/strict');
const timetablePeriodRepository = require('../src/repositories/timetablePeriodRepository');
const facultyAllocationRepository = require('../src/repositories/facultyAllocationRepository');
const substituteAssignmentRepository = require('../src/repositories/substituteAssignmentRepository');
const academicService = require('../src/services/academicService');
const studentService = require('../src/services/studentService');
const classRepository = require('../src/repositories/classRepository');
const attendanceRepository = require('../src/repositories/attendanceRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const identityService = require('../src/services/identityService');
const attendanceService = require('../src/services/attendanceService');
const aiToolRegistry = require('../src/services/aiToolRegistry');

const NOW = new Date('2026-06-01T10:15:00.000Z'); // a Monday, per Date.UTC

test('academicService.resolveCurrentSessionForStaff', async (t) => {
  await t.test('returns null when no period is happening right now', async () => {
    const findPeriodMock = t.mock.method(timetablePeriodRepository, 'findCurrentByCollegeAndDay', async () => null);
    t.after(() => findPeriodMock.mock.restore());
    const result = await academicService.resolveCurrentSessionForStaff({}, 'c1', 'staff-1', { now: NOW });
    assert.equal(result, null);
    assert.equal(findPeriodMock.mock.calls[0].arguments[2], 'Monday');
  });

  await t.test('resolves via the staff member\'s own faculty_allocation row', async () => {
    const findPeriodMock = t.mock.method(timetablePeriodRepository, 'findCurrentByCollegeAndDay', async () => ({ id: 'period-1', hour_index: 3 }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByStaffUserId', async () => [
      { period_id: 'period-9', class_id: 'other-class' },
      { period_id: 'period-1', class_id: 'class-1' },
    ]);
    const findSubMock = t.mock.method(substituteAssignmentRepository, 'findByStaffPeriodAndDate');
    t.after(() => {
      findPeriodMock.mock.restore();
      findAllocMock.mock.restore();
      findSubMock.mock.restore();
    });

    const result = await academicService.resolveCurrentSessionForStaff({}, 'c1', 'staff-1', { now: NOW });
    assert.equal(result.classId, 'class-1');
    assert.equal(result.hourIndex, 3);
    assert.equal(result.sessionDate, '2026-06-01');
    assert.equal(findSubMock.mock.callCount(), 0);
  });

  await t.test('falls back to a substitute assignment when there is no own allocation', async () => {
    const findPeriodMock = t.mock.method(timetablePeriodRepository, 'findCurrentByCollegeAndDay', async () => ({ id: 'period-1', hour_index: 3 }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByStaffUserId', async () => []);
    const findSubMock = t.mock.method(substituteAssignmentRepository, 'findByStaffPeriodAndDate', async () => ({ class_id: 'class-2' }));
    t.after(() => {
      findPeriodMock.mock.restore();
      findAllocMock.mock.restore();
      findSubMock.mock.restore();
    });

    const result = await academicService.resolveCurrentSessionForStaff({}, 'c1', 'staff-1', { now: NOW });
    assert.equal(result.classId, 'class-2');
  });

  await t.test('returns null when neither an allocation nor a substitution matches', async () => {
    const findPeriodMock = t.mock.method(timetablePeriodRepository, 'findCurrentByCollegeAndDay', async () => ({ id: 'period-1', hour_index: 3 }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByStaffUserId', async () => []);
    const findSubMock = t.mock.method(substituteAssignmentRepository, 'findByStaffPeriodAndDate', async () => null);
    t.after(() => {
      findPeriodMock.mock.restore();
      findAllocMock.mock.restore();
      findSubMock.mock.restore();
    });

    const result = await academicService.resolveCurrentSessionForStaff({}, 'c1', 'staff-1', { now: NOW });
    assert.equal(result, null);
  });
});

test('attendanceService.markAttendanceByRollNumbers', async (t) => {
  await t.test('rejects a non-array absentRollNumbers', async () => {
    await assert.rejects(
      () => attendanceService.markAttendanceByRollNumbers({}, { absentRollNumbers: 'not-an-array' }, { actorUserId: 'u1', actorRole: 'staff', collegeId: 'c1' }),
      attendanceService.AttendanceValidationError,
    );
  });

  await t.test('throws AttendanceNoActiveSessionError when there is no current session', async () => {
    const resolveMock = t.mock.method(academicService, 'resolveCurrentSessionForStaff', async () => null);
    t.after(() => resolveMock.mock.restore());
    await assert.rejects(
      () => attendanceService.markAttendanceByRollNumbers({}, { absentRollNumbers: ['35'] }, { actorUserId: 'u1', actorRole: 'staff', collegeId: 'c1' }),
      attendanceService.AttendanceNoActiveSessionError,
    );
  });

  await t.test('maps roll numbers to student ids, marks the rest present, and reports unknown rolls', async () => {
    const resolveMock = t.mock.method(academicService, 'resolveCurrentSessionForStaff', async () => ({
      classId: 'class-1', hourIndex: 3, sessionDate: '2026-06-01',
    }));
    const rosterMock = t.mock.method(studentService, 'listStudentsForClass', async () => [
      { id: 'stu-35', roll_no: '35' },
      { id: 'stu-67', roll_no: '67' },
      { id: 'stu-99', roll_no: '99' },
    ]);
    const getClassMock = t.mock.method(academicService, 'getClass', async () => ({
      id: 'class-1', college_id: 'c1', timetable_status: 'Approved',
    }));
    const resolveTutorMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'tutor-1');
    const getPeriodMock = t.mock.method(academicService, 'getTimetablePeriodByDayAndHour', async () => null);
    const findSessionMock = t.mock.method(attendanceRepository, 'findByClassSessionAndHour', async () => null);
    const createMock = t.mock.method(attendanceRepository, 'create', async (client, fields) => ({ id: 'sess-1', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    // RS-ATT-008 (D6, Stage 6): markAttendance now checks each
    // newly-absent student's consecutive-absence streak.
    const findRangeMock = t.mock.method(attendanceRepository, 'findByClassAndDateRange', async () => []);
    t.after(() => {
      resolveMock.mock.restore();
      rosterMock.mock.restore();
      getClassMock.mock.restore();
      resolveTutorMock.mock.restore();
      getPeriodMock.mock.restore();
      findSessionMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
      findRangeMock.mock.restore();
    });

    const result = await attendanceService.markAttendanceByRollNumbers({}, {
      absentRollNumbers: ['35', '999'],
    }, { actorUserId: 'tutor-1', actorRole: 'class_tutor', collegeId: 'c1' });

    assert.deepEqual(result.unknownRollNumbers, ['999']);
    const passedAbsentIds = JSON.parse(createMock.mock.calls[0].arguments[1].absentStudentIds);
    assert.deepEqual(passedAbsentIds, ['stu-35']);
    assert.equal(createMock.mock.calls[0].arguments[1].totalStudents, 3);
  });
});

test('mark_attendance_nl is registered as an L1 tool', () => {
  const tool = aiToolRegistry.getTool('mark_attendance_nl');
  assert.ok(tool, 'mark_attendance_nl must be registered');
  assert.equal(tool.level, 'L1');
  assert.equal(tool.dataClassification, 'Internal');
  assert.deepEqual(tool.allowedRoles.sort(), ['class_tutor', 'hod', 'principal', 'staff']);
});
