'use strict';

// Unit tests for academicService.requestSubstituteAssignment/
// approveSubstituteAssignment/rejectSubstituteAssignment/
// getSubstituteAssignment and the substitute leg of
// attendanceService.assertCanMark — no live Postgres needed:
// classRepository/substituteAssignmentRepository/
// substituteAssignmentRequestRepository/workflowService/
// workflowChainService/auditLogRepository are stubbed via node:test's
// built-in mock, same technique as every other *-service.test.js file
// in this suite. RS-CLS-007 (ADL-004) replaced the old direct-assign
// assignSubstitute with this request -> L3-approval flow — see
// staff-registration-service.test.js for the same request/approve/
// reject test shape against a different entityType.
// assertCanMark's tutor check moved off classes.tutor_user_id onto
// identityService.resolvePositionOccupant's {classId} overload in
// Phase 2 step 15 — mocked here rather than the class row carrying
// tutor_user_id.

const test = require('node:test');
const assert = require('node:assert/strict');
const classRepository = require('../src/repositories/classRepository');
const substituteAssignmentRepository = require('../src/repositories/substituteAssignmentRepository');
const substituteAssignmentRequestRepository = require('../src/repositories/substituteAssignmentRequestRepository');
const facultyAllocationRepository = require('../src/repositories/facultyAllocationRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const academicService = require('../src/services/academicService');
const attendanceRepository = require('../src/repositories/attendanceRepository');
const identityService = require('../src/services/identityService');
const attendanceService = require('../src/services/attendanceService');
const workflowService = require('../src/services/workflowService');
const workflowChainService = require('../src/services/workflowChainService');
const authRepository = require('../src/repositories/authRepository');
const notificationService = require('../src/services/notificationService');
const staffService = require('../src/services/staffService');

const CLASS_ROW = {
  id: 'class-1',
  college_id: 'c1',
  department_id: 'dept-1',
  class_name: 'CSE-A',
};

// RS-CLS-007 widened (ADL-031): every requestSubstituteAssignment call
// past the actor-authorization check now also resolves the candidate's
// eligibility — same-department + free-hour. Default mocks here make a
// candidate eligible; individual tests override to exercise a rejection.
function mockEligibleCandidate(t, overrides = {}) {
  const staffMock = t.mock.method(staffService, 'getStaffByUserId', async () => ({
    id: 'staff-u2',
    user_id: 'u2',
    department_id: 'dept-1',
    ...overrides.staff,
  }));
  const allocationsMock = t.mock.method(
    facultyAllocationRepository,
    'findByStaffUserId',
    async () => overrides.allocations ?? [],
  );
  const subMock = t.mock.method(
    substituteAssignmentRepository,
    'findByStaffPeriodAndDate',
    async () => overrides.existingSubstitution ?? null,
  );
  t.after(() => {
    staffMock.mock.restore();
    allocationsMock.mock.restore();
    subMock.mock.restore();
  });
  return { staffMock, allocationsMock, subMock };
}

test('academicService.requestSubstituteAssignment', async (t) => {
  await t.test('rejects missing required fields', async () => {
    await assert.rejects(
      () => academicService.requestSubstituteAssignment({}, { classId: 'class-1' }, { requestedByUserId: 'hod-1' }),
      academicService.SubstituteAssignmentValidationError,
    );
  });

  await t.test('rejects an unknown classId', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => null);
    t.after(() => findClassMock.mock.restore());
    await assert.rejects(
      () =>
        academicService.requestSubstituteAssignment(
          {},
          {
            classId: 'missing',
            timetablePeriodId: 'p1',
            assignmentDate: '2026-06-01',
            substituteStaffUserId: 'u2',
          },
          { requestedByUserId: 'hod-1' },
        ),
      academicService.ClassValidationError,
    );
  });

  await t.test('rejects an actor who is neither the absent staff, hod, nor tutor', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => CLASS_ROW);
    const resolveMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'someone-else');
    t.after(() => {
      findClassMock.mock.restore();
      resolveMock.mock.restore();
    });
    await assert.rejects(
      () =>
        academicService.requestSubstituteAssignment(
          {},
          {
            classId: 'class-1',
            timetablePeriodId: 'p1',
            assignmentDate: '2026-06-01',
            substituteStaffUserId: 'u2',
          },
          { requestedByUserId: 'unrelated-staff' },
        ),
      academicService.SubstituteAssignmentNotAuthorizedError,
    );
  });

  await t.test('rejects a candidate outside the class department', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => CLASS_ROW);
    const resolveMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'hod-1');
    mockEligibleCandidate(t, { staff: { department_id: 'dept-2' } });
    t.after(() => {
      findClassMock.mock.restore();
      resolveMock.mock.restore();
    });

    await assert.rejects(
      () =>
        academicService.requestSubstituteAssignment(
          {},
          {
            classId: 'class-1',
            timetablePeriodId: 'p1',
            assignmentDate: '2026-06-01',
            substituteStaffUserId: 'u2',
          },
          { requestedByUserId: 'hod-1' },
        ),
      academicService.SubstituteAssignmentCandidateNotInDepartmentError,
    );
  });

  await t.test('rejects a candidate with a regular class of their own that period', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => CLASS_ROW);
    const resolveMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'hod-1');
    mockEligibleCandidate(t, { allocations: [{ period_id: 'p1' }] });
    t.after(() => {
      findClassMock.mock.restore();
      resolveMock.mock.restore();
    });

    await assert.rejects(
      () =>
        academicService.requestSubstituteAssignment(
          {},
          {
            classId: 'class-1',
            timetablePeriodId: 'p1',
            assignmentDate: '2026-06-01',
            substituteStaffUserId: 'u2',
          },
          { requestedByUserId: 'hod-1' },
        ),
      academicService.SubstituteAssignmentCandidateNotFreeError,
    );
  });

  await t.test('rejects a candidate already covering another substitute duty that period/date', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => CLASS_ROW);
    const resolveMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'hod-1');
    mockEligibleCandidate(t, { existingSubstitution: { id: 'sub-existing' } });
    t.after(() => {
      findClassMock.mock.restore();
      resolveMock.mock.restore();
    });

    await assert.rejects(
      () =>
        academicService.requestSubstituteAssignment(
          {},
          {
            classId: 'class-1',
            timetablePeriodId: 'p1',
            assignmentDate: '2026-06-01',
            substituteStaffUserId: 'u2',
          },
          { requestedByUserId: 'hod-1' },
        ),
      academicService.SubstituteAssignmentCandidateNotFreeError,
    );
  });

  await t.test('rejects an unknown candidate', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => CLASS_ROW);
    const resolveMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'hod-1');
    const staffMock = t.mock.method(staffService, 'getStaffByUserId', async () => null);
    t.after(() => {
      findClassMock.mock.restore();
      resolveMock.mock.restore();
      staffMock.mock.restore();
    });

    await assert.rejects(
      () =>
        academicService.requestSubstituteAssignment(
          {},
          {
            classId: 'class-1',
            timetablePeriodId: 'p1',
            assignmentDate: '2026-06-01',
            substituteStaffUserId: 'u2',
          },
          { requestedByUserId: 'hod-1' },
        ),
      academicService.SubstituteAssignmentCandidateNotFoundError,
    );
  });

  await t.test(
    'the class hod may initiate, submits a workflow request, and notifies the (single-step) chain',
    async () => {
      const findClassMock = t.mock.method(classRepository, 'findById', async () => CLASS_ROW);
      const resolveMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'hod-1');
      mockEligibleCandidate(t);
      const createRequestMock = t.mock.method(
        substituteAssignmentRequestRepository,
        'create',
        async (client, fields) => ({ id: 'req-1', ...fields }),
      );
      const chainMock = t.mock.method(workflowChainService, 'resolveApproverChain', async () => [
        { step: 1, role: 'hod', user_id: 'hod-1' },
      ]);
      const submitMock = t.mock.method(workflowService, 'submitRequest', async (client, fields) => ({
        id: 'wf-1',
        status: 'Pending',
        ...fields,
      }));
      const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
      const getUserMock = t.mock.method(authRepository, 'getUserById', async () => ({
        id: 'hod-1',
        email: 'hod@example.com',
      }));
      const sendMock = t.mock.method(notificationService, 'sendViaChannel', async () => ({ status: 'sent' }));
      t.after(() => {
        findClassMock.mock.restore();
        resolveMock.mock.restore();
        createRequestMock.mock.restore();
        chainMock.mock.restore();
        submitMock.mock.restore();
        auditMock.mock.restore();
        getUserMock.mock.restore();
        sendMock.mock.restore();
      });

      const result = await academicService.requestSubstituteAssignment(
        {},
        {
          classId: 'class-1',
          timetablePeriodId: 'p1',
          assignmentDate: '2026-06-01',
          substituteStaffUserId: 'u2',
          reason: 'sick leave',
        },
        { requestedByUserId: 'hod-1' },
      );

      assert.equal(result.request.id, 'req-1');
      assert.equal(result.workflowRequest.id, 'wf-1');
      assert.equal(chainMock.mock.calls[0].arguments[1].entityType, 'substitute_assignment');
      assert.equal(submitMock.mock.calls[0].arguments[1].entityId, 'req-1');
      assert.equal(sendMock.mock.calls.length, 1);
      assert.equal(sendMock.mock.calls[0].arguments[1].to, 'hod@example.com');
    },
  );
});

test('academicService.approveSubstituteAssignment', async (t) => {
  await t.test('creates the substitute_assignments row and audit-logs it', async () => {
    const REQUEST_ROW = {
      id: 'req-1',
      college_id: 'c1',
      class_id: 'class-1',
      timetable_period_id: 'p1',
      assignment_date: '2026-06-01',
      original_staff_user_id: null,
      substitute_staff_user_id: 'u2',
      reason: 'sick leave',
    };
    const findRequestMock = t.mock.method(substituteAssignmentRequestRepository, 'findById', async () => REQUEST_ROW);
    const findPendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({
      id: 'wf-1',
      status: 'Approved',
    }));
    const createMock = t.mock.method(substituteAssignmentRepository, 'create', async (client, fields) => ({
      id: 'sub-1',
      ...fields,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findRequestMock.mock.restore();
      findPendingMock.mock.restore();
      approveMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await academicService.approveSubstituteAssignment({}, 'req-1', { actorUserId: 'hod-1' });
    assert.equal(result.assignment.id, 'sub-1');
    assert.equal(result.workflowRequest.status, 'Approved');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'substitute_assigned');
    assert.equal(createMock.mock.calls[0].arguments[1].assigningAuthorityUserId, 'hod-1');
  });

  await t.test('rejects an unknown requestId', async () => {
    const findRequestMock = t.mock.method(substituteAssignmentRequestRepository, 'findById', async () => null);
    t.after(() => findRequestMock.mock.restore());
    await assert.rejects(
      () => academicService.approveSubstituteAssignment({}, 'missing', { actorUserId: 'hod-1' }),
      academicService.SubstituteAssignmentRequestNotFoundError,
    );
  });

  await t.test('maps a period-not-found constraint violation', async () => {
    const REQUEST_ROW = {
      id: 'req-1',
      college_id: 'c1',
      class_id: 'class-1',
      timetable_period_id: 'missing',
      assignment_date: '2026-06-01',
      substitute_staff_user_id: 'u2',
    };
    const findRequestMock = t.mock.method(substituteAssignmentRequestRepository, 'findById', async () => REQUEST_ROW);
    const findPendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({
      id: 'wf-1',
      status: 'Approved',
    }));
    const err = Object.assign(new Error('fk'), {
      code: '23503',
      constraint: 'substitute_assignments_timetable_period_id_fkey',
    });
    const createMock = t.mock.method(substituteAssignmentRepository, 'create', async () => {
      throw err;
    });
    t.after(() => {
      findRequestMock.mock.restore();
      findPendingMock.mock.restore();
      approveMock.mock.restore();
      createMock.mock.restore();
    });
    await assert.rejects(
      () => academicService.approveSubstituteAssignment({}, 'req-1', { actorUserId: 'hod-1' }),
      academicService.SubstituteAssignmentPeriodNotFoundError,
    );
  });

  await t.test('maps a duplicate (period, date) constraint violation', async () => {
    const REQUEST_ROW = {
      id: 'req-1',
      college_id: 'c1',
      class_id: 'class-1',
      timetable_period_id: 'p1',
      assignment_date: '2026-06-01',
      substitute_staff_user_id: 'u2',
    };
    const findRequestMock = t.mock.method(substituteAssignmentRequestRepository, 'findById', async () => REQUEST_ROW);
    const findPendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({
      id: 'wf-1',
      status: 'Approved',
    }));
    const err = Object.assign(new Error('dup'), {
      code: '23505',
      constraint: 'substitute_assignments_class_period_date_key',
    });
    const createMock = t.mock.method(substituteAssignmentRepository, 'create', async () => {
      throw err;
    });
    t.after(() => {
      findRequestMock.mock.restore();
      findPendingMock.mock.restore();
      approveMock.mock.restore();
      createMock.mock.restore();
    });
    await assert.rejects(
      () => academicService.approveSubstituteAssignment({}, 'req-1', { actorUserId: 'hod-1' }),
      academicService.SubstituteAssignmentConflictError,
    );
  });
});

test('academicService.rejectSubstituteAssignment', async (t) => {
  await t.test('rejects the workflow request without creating an assignment', async () => {
    const findRequestMock = t.mock.method(substituteAssignmentRequestRepository, 'findById', async () => ({
      id: 'req-1',
    }));
    const findPendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
    const rejectMock = t.mock.method(workflowService, 'rejectRequest', async () => ({
      id: 'wf-1',
      status: 'Rejected',
    }));
    const createMock = t.mock.method(substituteAssignmentRepository, 'create', async () => {
      throw new Error('must not be called');
    });
    t.after(() => {
      findRequestMock.mock.restore();
      findPendingMock.mock.restore();
      rejectMock.mock.restore();
      createMock.mock.restore();
    });

    const result = await academicService.rejectSubstituteAssignment({}, 'req-1', { actorUserId: 'hod-1' });
    assert.equal(result.workflowRequest.status, 'Rejected');
    assert.equal(createMock.mock.calls.length, 0);
  });
});

test('attendanceService.assertCanMark recognizes an authorized substitute', async (t) => {
  const CLASS_MARK_ROW = {
    id: 'class-1',
    college_id: 'c1',
    timetable_status: 'Approved',
  };

  await t.test('a substitute assigned for this exact (period, date) may mark attendance', async () => {
    const resolveTutorMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'tutor-1');
    const periodMock = t.mock.method(academicService, 'getTimetablePeriodByDayAndHour', async () => ({
      id: 'period-1',
    }));
    const allocationMock = t.mock.method(academicService, 'getFacultyAllocationForClassAndPeriod', async () => null);
    const subMock = t.mock.method(academicService, 'getSubstituteAssignment', async () => ({
      substitute_staff_user_id: 'sub-teacher-1',
    }));
    const findSessionMock = t.mock.method(attendanceRepository, 'findByClassSessionAndHour', async () => null);
    const createMock = t.mock.method(attendanceRepository, 'create', async (client, fields) => ({
      id: 'sess-1',
      ...fields,
    }));
    const auditMock = t.mock.method(
      require('../src/repositories/auditLogRepository'),
      'createAuditLogEntry',
      async () => {},
    );
    t.after(() => {
      resolveTutorMock.mock.restore();
      periodMock.mock.restore();
      allocationMock.mock.restore();
      subMock.mock.restore();
      findSessionMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
    });
    const getClassMock = t.mock.method(academicService, 'getClass', async () => CLASS_MARK_ROW);
    t.after(() => getClassMock.mock.restore());

    const session = await attendanceService.markAttendance(
      {},
      {
        classId: 'class-1',
        sessionDate: '2026-06-01',
        hourIndex: 2,
        absentStudentIds: [],
        totalStudents: 40,
      },
      { actorUserId: 'sub-teacher-1', actorRole: 'staff' },
    );
    assert.equal(session.id, 'sess-1');
  });

  await t.test('a different staff member (not tutor/hod/scheduled/substitute) is rejected', async () => {
    const resolveTutorMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'tutor-1');
    const periodMock = t.mock.method(academicService, 'getTimetablePeriodByDayAndHour', async () => ({
      id: 'period-1',
    }));
    const allocationMock = t.mock.method(academicService, 'getFacultyAllocationForClassAndPeriod', async () => null);
    const subMock = t.mock.method(academicService, 'getSubstituteAssignment', async () => ({
      substitute_staff_user_id: 'sub-teacher-1',
    }));
    const getClassMock = t.mock.method(academicService, 'getClass', async () => CLASS_MARK_ROW);
    t.after(() => {
      resolveTutorMock.mock.restore();
      periodMock.mock.restore();
      allocationMock.mock.restore();
      subMock.mock.restore();
      getClassMock.mock.restore();
    });

    await assert.rejects(
      () =>
        attendanceService.markAttendance(
          {},
          {
            classId: 'class-1',
            sessionDate: '2026-06-01',
            hourIndex: 2,
            absentStudentIds: [],
            totalStudents: 40,
          },
          { actorUserId: 'unrelated-staff', actorRole: 'staff' },
        ),
      attendanceService.AttendanceForbiddenError,
    );
  });
});

test('attendanceService.listSubstituteAssignmentsWithMarkingStatus', async (t) => {
  await t.test('flags an unmarked assignment older than 24 hours as overdue', async () => {
    const oldTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const listMock = t.mock.method(academicService, 'listSubstituteAssignmentsForClass', async () => [
      { id: 'sub-1', timetable_period_id: 'p1', assignment_date: '2026-06-01', created_at: oldTimestamp },
    ]);
    const periodMock = t.mock.method(academicService, 'getTimetablePeriodsByIds', async () => [
      { id: 'p1', hour_index: 2 },
    ]);
    const sessionMock = t.mock.method(attendanceRepository, 'findByClassAndDateRange', async () => []);
    t.after(() => {
      listMock.mock.restore();
      periodMock.mock.restore();
      sessionMock.mock.restore();
    });

    const [result] = await attendanceService.listSubstituteAssignmentsWithMarkingStatus({}, 'class-1');
    assert.equal(result.marked, false);
    assert.equal(result.markingOverdue, true);
  });

  await t.test('does not flag a marked assignment as overdue', async () => {
    const oldTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const listMock = t.mock.method(academicService, 'listSubstituteAssignmentsForClass', async () => [
      { id: 'sub-1', timetable_period_id: 'p1', assignment_date: '2026-06-01', created_at: oldTimestamp },
    ]);
    const periodMock = t.mock.method(academicService, 'getTimetablePeriodsByIds', async () => [
      { id: 'p1', hour_index: 2 },
    ]);
    const sessionMock = t.mock.method(attendanceRepository, 'findByClassAndDateRange', async () => [
      { id: 'sess-1', session_date: '2026-06-01', hour_index: 2 },
    ]);
    t.after(() => {
      listMock.mock.restore();
      periodMock.mock.restore();
      sessionMock.mock.restore();
    });

    const [result] = await attendanceService.listSubstituteAssignmentsWithMarkingStatus({}, 'class-1');
    assert.equal(result.marked, true);
    assert.equal(result.markingOverdue, false);
  });

  await t.test(
    'resolves periods and sessions for multiple assignments in one batched call each, not one per assignment',
    async () => {
      const listMock = t.mock.method(academicService, 'listSubstituteAssignmentsForClass', async () => [
        { id: 'sub-1', timetable_period_id: 'p1', assignment_date: '2026-06-01', created_at: new Date().toISOString() },
        { id: 'sub-2', timetable_period_id: 'p2', assignment_date: '2026-06-03', created_at: new Date().toISOString() },
      ]);
      const periodMock = t.mock.method(academicService, 'getTimetablePeriodsByIds', async () => [
        { id: 'p1', hour_index: 2 },
        { id: 'p2', hour_index: 4 },
      ]);
      const sessionMock = t.mock.method(attendanceRepository, 'findByClassAndDateRange', async () => [
        { id: 'sess-1', session_date: '2026-06-01', hour_index: 2 },
      ]);
      t.after(() => {
        listMock.mock.restore();
        periodMock.mock.restore();
        sessionMock.mock.restore();
      });

      const results = await attendanceService.listSubstituteAssignmentsWithMarkingStatus({}, 'class-1');

      assert.equal(periodMock.mock.callCount(), 1);
      assert.deepEqual(periodMock.mock.calls[0].arguments[1], ['p1', 'p2']);
      assert.equal(sessionMock.mock.callCount(), 1);
      assert.deepEqual(sessionMock.mock.calls[0].arguments[2], { startDate: '2026-06-01', endDate: '2026-06-03' });

      assert.equal(results[0].marked, true);
      assert.equal(results[1].marked, false);
    },
  );

  await t.test('an empty assignment list resolves no periods and no sessions', async () => {
    const listMock = t.mock.method(academicService, 'listSubstituteAssignmentsForClass', async () => []);
    const periodMock = t.mock.method(academicService, 'getTimetablePeriodsByIds', async () => {
      throw new Error('must not be called');
    });
    const sessionMock = t.mock.method(attendanceRepository, 'findByClassAndDateRange', async () => {
      throw new Error('must not be called');
    });
    t.after(() => {
      listMock.mock.restore();
      periodMock.mock.restore();
      sessionMock.mock.restore();
    });

    const results = await attendanceService.listSubstituteAssignmentsWithMarkingStatus({}, 'class-1');
    assert.deepEqual(results, []);
  });
});
