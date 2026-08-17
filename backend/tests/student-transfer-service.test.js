'use strict';

// Unit tests for StudentService's transfer functions — no live
// Postgres needed: studentRepository/studentTransferRequestRepository/
// staffService/workflowService/auditLogRepository are stubbed via
// node:test's built-in mock, same technique as every other
// *-service.test.js file in this suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const studentRepository = require('../src/repositories/studentRepository');
const studentTransferRequestRepository = require('../src/repositories/studentTransferRequestRepository');
const staffService = require('../src/services/staffService');
const workflowService = require('../src/services/workflowService');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const studentService = require('../src/services/studentService');

test('requestInternalTransfer', async (t) => {
  await t.test('rejects missing destinationClassId', async () => {
    await assert.rejects(
      () => studentService.requestInternalTransfer({}, 's1', {}, { requestedByUserId: 'u1' }),
      studentService.StudentTransferValidationError,
    );
  });

  await t.test('rejects an unknown student', async () => {
    const findMock = t.mock.method(studentRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());
    await assert.rejects(
      () => studentService.requestInternalTransfer({}, 'missing', { destinationClassId: 'class-2' }, { requestedByUserId: 'u1' }),
      studentService.StudentTransferStudentNotFoundError,
    );
  });

  await t.test('submits a workflow request (Principal approver) and creates the transfer row', async () => {
    const findMock = t.mock.method(studentRepository, 'findById', async () => ({
      id: 's1', college_id: 'c1', permanent_student_id: 'perm-1',
    }));
    const findPrincipalMock = t.mock.method(staffService, 'findPrincipal', async () => ({ user_id: 'principal-1' }));
    const submitMock = t.mock.method(workflowService, 'submitRequest', async (client, fields) => ({ id: 'wf-1', ...fields }));
    const createMock = t.mock.method(studentTransferRequestRepository, 'create', async (client, fields) => ({ id: 'transfer-1', ...fields }));
    t.after(() => {
      findMock.mock.restore();
      findPrincipalMock.mock.restore();
      submitMock.mock.restore();
      createMock.mock.restore();
    });

    const result = await studentService.requestInternalTransfer({}, 's1', { destinationClassId: 'class-2', reason: 'family relocation' }, { requestedByUserId: 'tutor-1' });
    assert.equal(result.workflowRequest.id, 'wf-1');
    assert.deepEqual(submitMock.mock.calls[0].arguments[1].approverChain, [{ step: 1, role: 'principal', user_id: 'principal-1' }]);
    assert.equal(createMock.mock.calls[0].arguments[1].transferType, 'internal');
    assert.equal(createMock.mock.calls[0].arguments[1].permanentStudentId, 'perm-1');
  });
});

test('requestInterCollegeTransfer', async (t) => {
  await t.test('rejects missing destinationCollegeId', async () => {
    await assert.rejects(
      () => studentService.requestInterCollegeTransfer({}, 's1', {}, { requestedByUserId: 'u1' }),
      studentService.StudentTransferValidationError,
    );
  });

  await t.test('creates a transfer row with no destinationClassId, carrying the permanent_student_id', async () => {
    const findMock = t.mock.method(studentRepository, 'findById', async () => ({
      id: 's1', college_id: 'c1', permanent_student_id: 'perm-1',
    }));
    const findPrincipalMock = t.mock.method(staffService, 'findPrincipal', async () => ({ user_id: 'principal-1' }));
    const submitMock = t.mock.method(workflowService, 'submitRequest', async (client, fields) => ({ id: 'wf-2', ...fields }));
    const createMock = t.mock.method(studentTransferRequestRepository, 'create', async (client, fields) => ({ id: 'transfer-2', ...fields }));
    t.after(() => {
      findMock.mock.restore();
      findPrincipalMock.mock.restore();
      submitMock.mock.restore();
      createMock.mock.restore();
    });

    const result = await studentService.requestInterCollegeTransfer({}, 's1', { destinationCollegeId: 'other-college' }, { requestedByUserId: 'tutor-1' });
    assert.equal(result.transferRequest.transferType, 'inter_college');
    assert.equal(createMock.mock.calls[0].arguments[1].destinationCollegeId, 'other-college');
    assert.equal(createMock.mock.calls[0].arguments[1].permanentStudentId, 'perm-1');
  });
});

test('approveStudentTransfer / rejectStudentTransfer', async (t) => {
  function mockPending(t, transferRequest) {
    const findTransferMock = t.mock.method(studentTransferRequestRepository, 'findById', async () => transferRequest);
    const getRequestMock = t.mock.method(workflowService, 'getRequest', async () => ({ id: 'wf-1', status: 'Pending' }));
    return { findTransferMock, getRequestMock };
  }

  await t.test('approving an internal transfer updates the student\'s class_id', async () => {
    const { findTransferMock, getRequestMock } = mockPending(t, {
      id: 'transfer-1', student_id: 's1', college_id: 'c1', transfer_type: 'internal', destination_class_id: 'class-2', workflow_request_id: 'wf-1',
    });
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({ status: 'Approved' }));
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const markAppliedMock = t.mock.method(studentTransferRequestRepository, 'markApplied', async (client, id) => ({ id, applied_at: '2026-01-01T00:00:00Z' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findTransferMock.mock.restore();
      getRequestMock.mock.restore();
      approveMock.mock.restore();
      updateMock.mock.restore();
      markAppliedMock.mock.restore();
      auditMock.mock.restore();
    });

    await studentService.approveStudentTransfer({}, 's1', 'transfer-1', { actorUserId: 'principal-1' });
    assert.equal(updateMock.mock.calls[0].arguments[1], 's1');
    assert.equal(updateMock.mock.calls[0].arguments[2].classId, 'class-2');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'student_internal_transfer_approved');
  });

  await t.test('approving an inter_college transfer never touches the student row', async () => {
    const { findTransferMock, getRequestMock } = mockPending(t, {
      id: 'transfer-2', student_id: 's1', college_id: 'c1', transfer_type: 'inter_college', destination_college_id: 'other-college', workflow_request_id: 'wf-2',
    });
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({ status: 'Approved' }));
    const updateMock = t.mock.method(studentRepository, 'update');
    const markAppliedMock = t.mock.method(studentTransferRequestRepository, 'markApplied', async (client, id) => ({ id, applied_at: '2026-01-01T00:00:00Z' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findTransferMock.mock.restore();
      getRequestMock.mock.restore();
      approveMock.mock.restore();
      updateMock.mock.restore();
      markAppliedMock.mock.restore();
      auditMock.mock.restore();
    });

    await studentService.approveStudentTransfer({}, 's1', 'transfer-2', { actorUserId: 'principal-1' });
    assert.equal(updateMock.mock.callCount(), 0);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'student_inter_college_transfer_approved');
  });

  await t.test('a transfer request belonging to a different student is not found', async () => {
    const findTransferMock = t.mock.method(studentTransferRequestRepository, 'findById', async () => ({ id: 'transfer-1', student_id: 'someone-else' }));
    t.after(() => findTransferMock.mock.restore());
    await assert.rejects(
      () => studentService.approveStudentTransfer({}, 's1', 'transfer-1'),
      studentService.StudentTransferNotFoundError,
    );
  });

  await t.test('rejectStudentTransfer does not update the student row', async () => {
    const { findTransferMock, getRequestMock } = mockPending(t, {
      id: 'transfer-1', student_id: 's1', college_id: 'c1', transfer_type: 'internal', destination_class_id: 'class-2', workflow_request_id: 'wf-1',
    });
    const rejectMock = t.mock.method(workflowService, 'rejectRequest', async () => ({ status: 'Rejected' }));
    const updateMock = t.mock.method(studentRepository, 'update');
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findTransferMock.mock.restore();
      getRequestMock.mock.restore();
      rejectMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    await studentService.rejectStudentTransfer({}, 's1', 'transfer-1', { actorUserId: 'principal-1' });
    assert.equal(updateMock.mock.callCount(), 0);
  });
});
