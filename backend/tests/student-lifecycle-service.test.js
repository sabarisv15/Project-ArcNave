'use strict';

// Unit tests for StudentService's lifecycle + semester-progression
// functions — no live Postgres needed: studentRepository/
// studentLifecycleEventRepository/staffService/workflowService/
// configurationService/auditLogRepository are stubbed via node:test's
// built-in mock, same technique as every other *-service.test.js file
// in this suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const studentRepository = require('../src/repositories/studentRepository');
const studentLifecycleEventRepository = require('../src/repositories/studentLifecycleEventRepository');
const staffService = require('../src/services/staffService');
const workflowService = require('../src/services/workflowService');
const workflowChainService = require('../src/services/workflowChainService');
const configurationService = require('../src/services/configurationService');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const authRepository = require('../src/repositories/authRepository');
const notificationService = require('../src/services/notificationService');
const studentService = require('../src/services/studentService');

test('updateStudentLifecycleStatus (direct, low-severity path)', async (t) => {
  await t.test('rejects a missing reason', async () => {
    await assert.rejects(
      () => studentService.updateStudentLifecycleStatus({}, 's1', { newStatus: 'Suspended' }),
      studentService.StudentLifecycleValidationError,
    );
  });

  await t.test('rejects an unrecognized status', async () => {
    await assert.rejects(
      () => studentService.updateStudentLifecycleStatus({}, 's1', { newStatus: 'Vacationing', reason: 'x' }),
      studentService.StudentLifecycleValidationError,
    );
  });

  await t.test('rejects an approval-required status outright', async () => {
    await assert.rejects(
      () => studentService.updateStudentLifecycleStatus({}, 's1', { newStatus: 'Dismissed', reason: 'misconduct' }),
      studentService.StudentLifecycleApprovalRequiredError,
    );
  });

  // RS-STU-007 (D6, Stage 6, ADL-012): the gate previously omitted
  // `Suspended` — it now requires approval the same as the other three
  // high-severity states.
  await t.test('rejects Suspended outright — RS-STU-007 (D6) now gates it, not a direct write', async () => {
    await assert.rejects(
      () =>
        studentService.updateStudentLifecycleStatus({}, 's1', { newStatus: 'Suspended', reason: 'pending inquiry' }),
      studentService.StudentLifecycleApprovalRequiredError,
    );
  });

  await t.test('records a lifecycle event and updates the status directly', async () => {
    const findMock = t.mock.method(studentRepository, 'findById', async () => ({
      id: 's1',
      college_id: 'c1',
      lifecycle_status: 'Applied',
    }));
    const createEventMock = t.mock.method(studentLifecycleEventRepository, 'create', async (client, fields) => fields);
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    t.after(() => {
      findMock.mock.restore();
      createEventMock.mock.restore();
      updateMock.mock.restore();
    });

    const result = await studentService.updateStudentLifecycleStatus(
      {},
      's1',
      { newStatus: 'Admitted', reason: 'application approved' },
      { actorUserId: 'tutor-1' },
    );
    assert.equal(createEventMock.mock.calls[0].arguments[1].previousStatus, 'Applied');
    assert.equal(createEventMock.mock.calls[0].arguments[1].newStatus, 'Admitted');
    assert.equal(result.lifecycleStatus, 'Admitted');
  });
});

test('requestLifecycleStatusChange / approve / reject (high-severity path)', async (t) => {
  await t.test('rejects a low-severity status (must use the direct path instead)', async () => {
    await assert.rejects(
      () =>
        studentService.requestLifecycleStatusChange(
          {},
          's1',
          { newStatus: 'Active', reason: 'x' },
          { requestedByUserId: 'u1' },
        ),
      studentService.StudentLifecycleValidationError,
    );
  });

  // RS-STU-007/RS-WFL-003 (D6, Stage 6, ADL-012): routed through
  // workflowChainService.resolveApproverChain now, not a hardcoded
  // Principal-only chain built inline — resolveApproverChain's own
  // floor enforcement (WorkflowChainFloorViolationError) is what
  // actually guarantees the L3 floor, unit-tested separately in
  // workflow-chain-service.test.js.
  await t.test('submits a workflow request via workflowChainService and sets pending fields', async () => {
    const findMock = t.mock.method(studentRepository, 'findById', async () => ({
      id: 's1',
      college_id: 'c1',
      lifecycle_status: 'Active',
      class_id: null,
    }));
    const resolveChainMock = t.mock.method(workflowChainService, 'resolveApproverChain', async () => [
      { step: 1, role: 'principal', user_id: 'principal-1' },
    ]);
    const submitMock = t.mock.method(workflowService, 'submitRequest', async (client, fields) => ({
      id: 'wf-1',
      ...fields,
    }));
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    // RS-STU-007 / RS-NTF-005: submitting also notifies the chain's
    // first approver — stub out the two calls that reach for a real DB.
    const getUserMock = t.mock.method(authRepository, 'getUserById', async () => ({
      id: 'principal-1',
      email: 'principal@example.com',
    }));
    const sendMock = t.mock.method(notificationService, 'sendViaChannel', async () => ({ status: 'sent' }));
    t.after(() => {
      findMock.mock.restore();
      resolveChainMock.mock.restore();
      submitMock.mock.restore();
      updateMock.mock.restore();
      getUserMock.mock.restore();
      sendMock.mock.restore();
    });

    const result = await studentService.requestLifecycleStatusChange(
      {},
      's1',
      { newStatus: 'Dismissed', reason: 'misconduct' },
      { requestedByUserId: 'tutor-1' },
    );
    assert.equal(result.workflowRequest.id, 'wf-1');
    assert.equal(resolveChainMock.mock.calls[0].arguments[1].entityType, 'student_lifecycle_change');
    assert.deepEqual(submitMock.mock.calls[0].arguments[1].approverChain, [
      { step: 1, role: 'principal', user_id: 'principal-1' },
    ]);
    assert.equal(updateMock.mock.calls[0].arguments[2].pendingLifecycleStatus, 'Dismissed');
  });

  // RS-STU-007's own "Suspended" is now approval-required — the
  // exact D6 fix, unit-tested directly rather than just implied by the
  // updateStudentLifecycleStatus-side rejection test above.
  await t.test('accepts Suspended as an approval-required status', async () => {
    const findMock = t.mock.method(studentRepository, 'findById', async () => ({
      id: 's1',
      college_id: 'c1',
      lifecycle_status: 'Active',
      class_id: null,
    }));
    const resolveChainMock = t.mock.method(workflowChainService, 'resolveApproverChain', async () => [
      { step: 1, role: 'principal', user_id: 'principal-1' },
    ]);
    const submitMock = t.mock.method(workflowService, 'submitRequest', async (client, fields) => ({
      id: 'wf-2',
      ...fields,
    }));
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const getUserMock = t.mock.method(authRepository, 'getUserById', async () => ({
      id: 'principal-1',
      email: 'principal@example.com',
    }));
    const sendMock = t.mock.method(notificationService, 'sendViaChannel', async () => ({ status: 'sent' }));
    t.after(() => {
      findMock.mock.restore();
      resolveChainMock.mock.restore();
      submitMock.mock.restore();
      updateMock.mock.restore();
      getUserMock.mock.restore();
      sendMock.mock.restore();
    });

    const result = await studentService.requestLifecycleStatusChange(
      {},
      's1',
      { newStatus: 'Suspended', reason: 'pending inquiry' },
      { requestedByUserId: 'tutor-1' },
    );
    assert.equal(result.workflowRequest.id, 'wf-2');
  });

  function mockPending(t, student) {
    const findMock = t.mock.method(studentRepository, 'findById', async () => student);
    const findPendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
    return { findMock, findPendingMock };
  }

  await t.test('approving a Dismissed request writes one lifecycle event and sets the final status', async () => {
    const { findMock, findPendingMock } = mockPending(t, {
      id: 's1',
      college_id: 'c1',
      lifecycle_status: 'Active',
      pending_lifecycle_status: 'Dismissed',
      pending_lifecycle_reason: 'misconduct',
    });
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({}));
    const createEventMock = t.mock.method(studentLifecycleEventRepository, 'create', async (client, fields) => fields);
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    t.after(() => {
      findMock.mock.restore();
      findPendingMock.mock.restore();
      approveMock.mock.restore();
      createEventMock.mock.restore();
      updateMock.mock.restore();
    });

    const result = await studentService.approveLifecycleStatusChange({}, 's1', { actorUserId: 'principal-1' });
    assert.equal(createEventMock.mock.callCount(), 1);
    assert.equal(result.lifecycleStatus, 'Dismissed');
    assert.equal(result.pendingLifecycleStatus, null);
  });

  await t.test('approving a Graduated request cascades to Alumni with two lifecycle events', async () => {
    const { findMock, findPendingMock } = mockPending(t, {
      id: 's1',
      college_id: 'c1',
      lifecycle_status: 'Active',
      pending_lifecycle_status: 'Graduated',
      pending_lifecycle_reason: 'completed programme',
    });
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({}));
    const createEventMock = t.mock.method(studentLifecycleEventRepository, 'create', async (client, fields) => fields);
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    t.after(() => {
      findMock.mock.restore();
      findPendingMock.mock.restore();
      approveMock.mock.restore();
      createEventMock.mock.restore();
      updateMock.mock.restore();
    });

    const result = await studentService.approveLifecycleStatusChange({}, 's1', { actorUserId: 'principal-1' });
    assert.equal(createEventMock.mock.callCount(), 2);
    assert.equal(createEventMock.mock.calls[1].arguments[1].newStatus, 'Alumni');
    assert.equal(result.lifecycleStatus, 'Alumni');
  });

  await t.test('rejecting clears pending fields without writing a lifecycle event', async () => {
    const { findMock, findPendingMock } = mockPending(t, {
      id: 's1',
      college_id: 'c1',
      lifecycle_status: 'Active',
      pending_lifecycle_status: 'Dismissed',
    });
    const rejectMock = t.mock.method(workflowService, 'rejectRequest', async () => ({}));
    const createEventMock = t.mock.method(studentLifecycleEventRepository, 'create');
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    t.after(() => {
      findMock.mock.restore();
      findPendingMock.mock.restore();
      rejectMock.mock.restore();
      createEventMock.mock.restore();
      auditMock.mock.restore();
      updateMock.mock.restore();
    });

    const result = await studentService.rejectLifecycleStatusChange({}, 's1', { actorUserId: 'principal-1' });
    assert.equal(createEventMock.mock.callCount(), 0);
    assert.equal(result.pendingLifecycleStatus, null);
  });
});

test('promoteSemesterForClass', async (t) => {
  await t.test('returns empty result for a class with no students', async () => {
    const findRosterMock = t.mock.method(studentRepository, 'findByClassId', async () => []);
    t.after(() => findRosterMock.mock.restore());
    const result = await studentService.promoteSemesterForClass({}, 'class-1');
    assert.deepEqual(result, { promoted: [], exceptions: [] });
  });

  await t.test('skips Discontinued/Debarred/Dismissed students, promotes everyone else', async () => {
    const findRosterMock = t.mock.method(studentRepository, 'findByClassId', async () => [
      { id: 's1', college_id: 'c1', lifecycle_status: 'Active', current_semester: 2 },
      { id: 's2', college_id: 'c1', lifecycle_status: 'Discontinued', current_semester: 2 },
      { id: 's3', college_id: 'c1', lifecycle_status: 'Dismissed', current_semester: 3 },
    ]);
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findRosterMock.mock.restore();
      getConfigMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await studentService.promoteSemesterForClass({}, 'class-1', { actorUserId: 'principal-1' });
    assert.equal(result.promoted.length, 1);
    assert.equal(result.promoted[0].currentSemester, 3);
    assert.equal(result.exceptions.length, 2);
  });

  await t.test('Suspended students are blocked by default (no institution config)', async () => {
    const findRosterMock = t.mock.method(studentRepository, 'findByClassId', async () => [
      { id: 's1', college_id: 'c1', lifecycle_status: 'Suspended', current_semester: 1 },
    ]);
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    const updateMock = t.mock.method(studentRepository, 'update');
    t.after(() => {
      findRosterMock.mock.restore();
      getConfigMock.mock.restore();
      updateMock.mock.restore();
    });

    const result = await studentService.promoteSemesterForClass({}, 'class-1');
    assert.equal(result.exceptions.length, 1);
    assert.equal(updateMock.mock.callCount(), 0);
  });

  await t.test('Suspended students are promoted when the institution opts in', async () => {
    const findRosterMock = t.mock.method(studentRepository, 'findByClassId', async () => [
      { id: 's1', college_id: 'c1', lifecycle_status: 'Suspended', current_semester: 1 },
    ]);
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => ({
      configuration: { promoteSuspendedStudents: true },
    }));
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findRosterMock.mock.restore();
      getConfigMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await studentService.promoteSemesterForClass({}, 'class-1');
    assert.equal(result.promoted.length, 1);
    assert.equal(result.exceptions.length, 0);
  });

  await t.test('a student with no current_semester on file starts at 1', async () => {
    const findRosterMock = t.mock.method(studentRepository, 'findByClassId', async () => [
      { id: 's1', college_id: 'c1', lifecycle_status: 'Active', current_semester: null },
    ]);
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findRosterMock.mock.restore();
      getConfigMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await studentService.promoteSemesterForClass({}, 'class-1');
    assert.equal(result.promoted[0].currentSemester, 1);
  });
});
