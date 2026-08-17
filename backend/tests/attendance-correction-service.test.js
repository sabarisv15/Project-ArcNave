'use strict';

// Unit tests for the attendance-correction workflow (lock + effective
// value) — no live Postgres needed: attendanceRepository/
// attendanceCorrectionRepository/academicService/workflowService/
// auditLogRepository are stubbed via node:test's built-in mock, same
// technique as every other *-service.test.js file in this suite. The
// approver-chain tutor lookup moved off classes.tutor_user_id onto
// identityService.resolvePositionOccupant's {classId} overload in
// Phase 2 step 15 — mocked here rather than the class row carrying
// tutor_user_id.

const test = require('node:test');
const assert = require('node:assert/strict');
const attendanceRepository = require('../src/repositories/attendanceRepository');
const attendanceCorrectionRepository = require('../src/repositories/attendanceCorrectionRepository');
const academicService = require('../src/services/academicService');
const workflowService = require('../src/services/workflowService');
const workflowChainService = require('../src/services/workflowChainService');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const identityService = require('../src/services/identityService');
const attendanceService = require('../src/services/attendanceService');

test('lockAttendanceSession', async (t) => {
  await t.test('rejects an unknown session', async () => {
    const findMock = t.mock.method(attendanceRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());
    await assert.rejects(
      () => attendanceService.lockAttendanceSession({}, 'missing'),
      attendanceService.AttendanceSessionNotFoundError,
    );
  });

  await t.test('is a no-op (returns the session as-is) if already locked', async () => {
    const findMock = t.mock.method(attendanceRepository, 'findById', async () => ({ id: 's1', locked_at: '2026-01-01T00:00:00Z' }));
    const updateMock = t.mock.method(attendanceRepository, 'update');
    t.after(() => {
      findMock.mock.restore();
      updateMock.mock.restore();
    });
    await attendanceService.lockAttendanceSession({}, 's1');
    assert.equal(updateMock.mock.callCount(), 0);
  });

  await t.test('sets locked_at and audit-logs it', async () => {
    const findMock = t.mock.method(attendanceRepository, 'findById', async () => ({ id: 's1', college_id: 'c1', locked_at: null }));
    const updateMock = t.mock.method(attendanceRepository, 'update', async (client, id, fields) => ({ id, locked_at: fields.lockedAt }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });
    const result = await attendanceService.lockAttendanceSession({}, 's1', { actorUserId: 'hod-1' });
    assert.ok(result.locked_at);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'attendance_locked');
  });
});

test('requestAttendanceCorrection', async (t) => {
  await t.test('rejects missing proposedTotalStudents', async () => {
    await assert.rejects(
      () => attendanceService.requestAttendanceCorrection({}, 's1', {}, { requestedByUserId: 'u1' }),
      attendanceService.AttendanceCorrectionValidationError,
    );
  });

  await t.test('rejects an unlocked session', async () => {
    const findMock = t.mock.method(attendanceRepository, 'findById', async () => ({ id: 's1', locked_at: null }));
    t.after(() => findMock.mock.restore());
    await assert.rejects(
      () => attendanceService.requestAttendanceCorrection({}, 's1', { proposedTotalStudents: 40 }, { requestedByUserId: 'u1' }),
      attendanceService.AttendanceNotLockedError,
    );
  });

  await t.test('submits a workflow request (Class Tutor as sole approver) and creates the correction row', async () => {
    const findMock = t.mock.method(attendanceRepository, 'findById', async () => ({ id: 's1', college_id: 'c1', class_id: 'class-1', locked_at: '2026-01-01T00:00:00Z' }));
    const getClassMock = t.mock.method(academicService, 'getClass', async () => ({ id: 'class-1' }));
    const resolveTutorMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'tutor-1');
    const submitMock = t.mock.method(workflowService, 'submitRequest', async (client, fields) => ({ id: 'wf-1', ...fields }));
    const createMock = t.mock.method(attendanceCorrectionRepository, 'create', async (client, fields) => ({ id: 'corr-1', ...fields }));
    t.after(() => {
      findMock.mock.restore();
      getClassMock.mock.restore();
      resolveTutorMock.mock.restore();
      submitMock.mock.restore();
      createMock.mock.restore();
    });

    const result = await attendanceService.requestAttendanceCorrection({}, 's1', {
      proposedAbsentStudentIds: ['stu-1'], proposedTotalStudents: 39, reason: 'wrong roll number',
    }, { requestedByUserId: 'faculty-1' });

    assert.equal(result.workflowRequest.id, 'wf-1');
    assert.deepEqual(submitMock.mock.calls[0].arguments[1].approverChain, [{ step: 1, role: 'tutor', user_id: 'tutor-1' }]);
    assert.equal(result.correction.id, 'corr-1');
  });
});

test('approveAttendanceCorrection / rejectAttendanceCorrection', async (t) => {
  // 4-login authorization architecture (2026-08-09) — the critical
  // regression case: rejected before workflowService is ever consulted
  // (workflowService itself takes no role, by design — see its own
  // file comment — so this login-identity gate lives here).
  await t.test('approveAttendanceCorrection rejects a personal Staff login, even one belonging to the real resolved tutor', async () => {
    const findCorrectionMock = t.mock.method(attendanceCorrectionRepository, 'findById');
    const getRequestMock = t.mock.method(workflowService, 'getRequest');
    t.after(() => {
      findCorrectionMock.mock.restore();
      getRequestMock.mock.restore();
    });
    await assert.rejects(
      () => attendanceService.approveAttendanceCorrection({}, 'corr-1', { actorUserId: 'tutor-1', actorRole: 'staff' }),
      attendanceService.AttendanceCorrectionNotAuthorizedError,
    );
    assert.equal(findCorrectionMock.mock.callCount(), 0);
  });

  function mockPending(t) {
    const findCorrectionMock = t.mock.method(attendanceCorrectionRepository, 'findById', async () => ({ id: 'corr-1', college_id: 'c1', workflow_request_id: 'wf-1' }));
    const getRequestMock = t.mock.method(workflowService, 'getRequest', async () => ({ id: 'wf-1', status: 'Pending' }));
    return { findCorrectionMock, getRequestMock };
  }

  await t.test('approveAttendanceCorrection marks the correction applied and audit-logs it', async () => {
    const { findCorrectionMock, getRequestMock } = mockPending(t);
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({ id: 'wf-1', status: 'Approved' }));
    const markAppliedMock = t.mock.method(attendanceCorrectionRepository, 'markApplied', async (client, id) => ({ id, applied_at: '2026-01-02T00:00:00Z' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findCorrectionMock.mock.restore();
      getRequestMock.mock.restore();
      approveMock.mock.restore();
      markAppliedMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await attendanceService.approveAttendanceCorrection({}, 'corr-1', { actorUserId: 'tutor-1', actorRole: 'class_tutor' });
    assert.ok(result.applied_at);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'attendance_correction_approved');
  });

  await t.test('rejectAttendanceCorrection does not mark the correction applied', async () => {
    const { findCorrectionMock, getRequestMock } = mockPending(t);
    const rejectMock = t.mock.method(workflowService, 'rejectRequest', async () => ({ id: 'wf-1', status: 'Rejected' }));
    const markAppliedMock = t.mock.method(attendanceCorrectionRepository, 'markApplied');
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findCorrectionMock.mock.restore();
      getRequestMock.mock.restore();
      rejectMock.mock.restore();
      markAppliedMock.mock.restore();
      auditMock.mock.restore();
    });

    await attendanceService.rejectAttendanceCorrection({}, 'corr-1', { actorUserId: 'tutor-1', actorRole: 'class_tutor' });
    assert.equal(markAppliedMock.mock.callCount(), 0);
  });

  await t.test('throws AttendanceCorrectionNoPendingRequestError when the workflow request is already resolved', async () => {
    const findCorrectionMock = t.mock.method(attendanceCorrectionRepository, 'findById', async () => ({ id: 'corr-1', workflow_request_id: 'wf-1' }));
    const getRequestMock = t.mock.method(workflowService, 'getRequest', async () => ({ id: 'wf-1', status: 'Approved' }));
    t.after(() => {
      findCorrectionMock.mock.restore();
      getRequestMock.mock.restore();
    });
    await assert.rejects(
      () => attendanceService.approveAttendanceCorrection({}, 'corr-1', { actorUserId: 'tutor-1', actorRole: 'class_tutor' }),
      attendanceService.AttendanceCorrectionNoPendingRequestError,
    );
  });
});

test('getEffectiveAttendanceSession', async (t) => {
  await t.test('returns the original session, marked not-effective, when no correction has been applied', async () => {
    const findSessionMock = t.mock.method(attendanceRepository, 'findById', async () => ({ id: 's1', absent_student_ids: '["a"]', total_students: 40 }));
    const findLatestMock = t.mock.method(attendanceCorrectionRepository, 'findLatestApplied', async () => null);
    t.after(() => {
      findSessionMock.mock.restore();
      findLatestMock.mock.restore();
    });
    const result = await attendanceService.getEffectiveAttendanceSession({}, 's1');
    assert.equal(result.effective, false);
    assert.equal(result.total_students, 40);
  });

  await t.test('overlays the latest applied correction onto the original session', async () => {
    const findSessionMock = t.mock.method(attendanceRepository, 'findById', async () => ({ id: 's1', absent_student_ids: '["a"]', total_students: 40 }));
    const findLatestMock = t.mock.method(attendanceCorrectionRepository, 'findLatestApplied', async () => ({
      id: 'corr-1', proposed_absent_student_ids: '["a","b"]', proposed_total_students: 39,
    }));
    t.after(() => {
      findSessionMock.mock.restore();
      findLatestMock.mock.restore();
    });
    const result = await attendanceService.getEffectiveAttendanceSession({}, 's1');
    assert.equal(result.effective, true);
    assert.equal(result.total_students, 39);
    assert.equal(result.effective_correction_id, 'corr-1');
  });
});

// RS-ATT-004 (D9, Stage 5, ADL-009): L4's discretionary escalation
// option — mirrors assessment-service.test.js's identical
// escalateMarkCorrection coverage.
test('escalateAttendanceCorrection', async (t) => {
  await t.test('rejects an unknown escalateToRole', async () => {
    await assert.rejects(
      () => attendanceService.escalateAttendanceCorrection({}, 'correction-1', { actorUserId: 'tutor-1', actorRole: 'class_tutor', escalateToRole: 'staff' }),
      attendanceService.AttendanceCorrectionInvalidEscalationError,
    );
  });

  await t.test("resolves the target role from the session's own class/department and calls workflowService.escalateRequest", async () => {
    const findCorrectionMock = t.mock.method(attendanceCorrectionRepository, 'findById', async () => ({
      id: 'correction-1', college_id: 'c1', attendance_session_id: 'session-1', workflow_request_id: 'wf-1',
    }));
    const getRequestMock = t.mock.method(workflowService, 'getRequest', async () => ({ id: 'wf-1', status: 'Pending' }));
    const findSessionMock = t.mock.method(attendanceRepository, 'findById', async () => ({ id: 'session-1', class_id: 'class-1' }));
    const getClassMock = t.mock.method(academicService, 'getClass', async () => ({ id: 'class-1', college_id: 'c1', department_id: 'dept-1' }));
    const resolveRoleMock = t.mock.method(workflowChainService, 'resolveRoleUserId', async () => 'hod-1');
    const escalateMock = t.mock.method(workflowService, 'escalateRequest', async () => ({ id: 'wf-1', current_step: 2 }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findCorrectionMock.mock.restore();
      getRequestMock.mock.restore();
      findSessionMock.mock.restore();
      getClassMock.mock.restore();
      resolveRoleMock.mock.restore();
      escalateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await attendanceService.escalateAttendanceCorrection({}, 'correction-1', {
      actorUserId: 'tutor-1', actorRole: 'class_tutor', escalateToRole: 'hod',
    });
    assert.equal(result.current_step, 2);
    assert.equal(resolveRoleMock.mock.calls[0].arguments[1], 'hod');
    assert.deepEqual(resolveRoleMock.mock.calls[0].arguments[2], { collegeId: 'c1', departmentId: 'dept-1' });
    assert.equal(escalateMock.mock.calls[0].arguments[2].escalateToUserId, 'hod-1');
  });
});
