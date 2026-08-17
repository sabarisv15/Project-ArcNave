'use strict';

// Unit tests for FinanceService's pure business-logic paths — no live
// Postgres needed: feePaymentRepository/feeCorrectionRepository/
// classRepository/identityService/workflowChainService/workflowService/
// auditLogRepository are stubbed via node:test's built-in mock, same
// technique as every other *-service.test.js file in this suite.
//
// RS-FIN-001 (D4, Stage 4): fee_structures and every function that
// used to manage it are REMOVED — see financeService.js's own header
// comment. This file's old fee_structures test block is gone with it,
// not ported.
//
// What's deliberately NOT here: an actual fee_payments_student_id_key/
// fee_payments_student_id_fkey/fee_payments_receipt_document_id_fkey
// violation reaching its domain error end-to-end through a real
// Postgres constraint — trusts the migration's own constraint
// definitions, same restraint every other *-service.test.js file in
// this suite already applies.

const test = require('node:test');
const assert = require('node:assert/strict');
const feePaymentRepository = require('../src/repositories/feePaymentRepository');
const feeCorrectionRepository = require('../src/repositories/feeCorrectionRepository');
const classRepository = require('../src/repositories/classRepository');
const identityService = require('../src/services/identityService');
const workflowChainService = require('../src/services/workflowChainService');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const workflowService = require('../src/services/workflowService');
const studentService = require('../src/services/studentService');
const configurationService = require('../src/services/configurationService');
const financeService = require('../src/services/financeService');

// Shared by markFeePayment/requestFeeCorrection tests: mocks the
// student->class->tutor resolution chain financeService.loadStudentClass/
// assertIsClassTutor use internally.
function mockTutorChain(t, {
  student = { id: 's1', college_id: 'c1', class_id: 'class-1' },
  cls = { id: 'class-1', college_id: 'c1', department_id: 'dept-1' },
  tutorUserId = 'tutor-1',
} = {}) {
  const getStudentMock = t.mock.method(studentService, 'getStudent', async () => student);
  const findClassMock = t.mock.method(classRepository, 'findById', async () => cls);
  const resolveTutorMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => tutorUserId);
  t.after(() => {
    getStudentMock.mock.restore();
    findClassMock.mock.restore();
    resolveTutorMock.mock.restore();
  });
  return { getStudentMock, findClassMock, resolveTutorMock };
}

test('FinanceService.markFeePayment (RS-FIN-002)', async (t) => {
  await t.test('rejects missing collegeId/studentId/actorUserId/status/receiptDocumentId without touching the DB', async () => {
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentId');
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => financeService.markFeePayment({}, { studentId: 'student-1' }, {}),
      financeService.FeePaymentValidationError,
    );
    assert.equal(findMock.mock.callCount(), 0);
  });

  await t.test('rejects an unknown status without touching the DB', async () => {
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentId');
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => financeService.markFeePayment(
        {},
        {
          collegeId: 'c1', studentId: 'student-1', status: 'partially_paid', receiptDocumentId: 'doc-1',
        },
        { actorUserId: 'staff-1' },
      ),
      financeService.FeePaymentStatusError,
    );
    assert.equal(findMock.mock.callCount(), 0);
  });

  await t.test('throws FeePaymentStudentNotFoundError for a nonexistent student', async () => {
    const getStudentMock = t.mock.method(studentService, 'getStudent', async () => null);
    t.after(() => getStudentMock.mock.restore());

    await assert.rejects(
      () => financeService.markFeePayment(
        {},
        {
          collegeId: 'c1', studentId: 'missing-student', status: 'paid', receiptDocumentId: 'doc-1',
        },
        { actorUserId: 'staff-1' },
      ),
      financeService.FeePaymentStudentNotFoundError,
    );
  });

  // 4-login authorization architecture (2026-08-09) — the critical
  // regression case: tutor-1 IS the real, verified tutor of s1's class
  // (mockTutorChain's default), but this request uses tutor-1's
  // personal Staff login (actorRole: 'staff'), not the L4 Position
  // Account login. Must be rejected exactly like a stranger — this is
  // the exact reference pattern (financeService.assertIsClassTutor)
  // the rest of the codebase's L4-only checks now follow.
  await t.test('rejects a personal Staff login even when that person is the real, verified tutor of the student\'s own class', async () => {
    mockTutorChain(t);

    await assert.rejects(
      () => financeService.markFeePayment(
        {},
        {
          collegeId: 'c1', studentId: 's1', status: 'paid', receiptDocumentId: 'doc-1',
        },
        { actorUserId: 'tutor-1', actorRole: 'staff' },
      ),
      financeService.FeePaymentNotAuthorizedError,
    );
  });

  await t.test('rejects an actor who is not the real, verified tutor of the student\'s own class', async () => {
    mockTutorChain(t, { tutorUserId: 'someone-else' });

    await assert.rejects(
      () => financeService.markFeePayment(
        {},
        {
          collegeId: 'c1', studentId: 's1', status: 'paid', receiptDocumentId: 'doc-1',
        },
        { actorUserId: 'tutor-1', actorRole: 'class_tutor' },
      ),
      financeService.FeePaymentNotAuthorizedError,
    );
  });

  await t.test('rejects a student with no class assigned — no tutor to verify against', async () => {
    mockTutorChain(t, { student: { id: 's1', college_id: 'c1', class_id: null }, cls: null });

    await assert.rejects(
      () => financeService.markFeePayment(
        {},
        {
          collegeId: 'c1', studentId: 's1', status: 'paid', receiptDocumentId: 'doc-1',
        },
        { actorUserId: 'tutor-1', actorRole: 'class_tutor' },
      ),
      financeService.FeePaymentNotAuthorizedError,
    );
  });

  await t.test('refuses (FeePaymentAlreadyMarkedError) when the student already has a fee status on record', async () => {
    mockTutorChain(t);
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentId', async () => ({ id: 'payment-1', status: 'not_paid' }));
    const createMock = t.mock.method(feePaymentRepository, 'create');
    t.after(() => {
      findMock.mock.restore();
      createMock.mock.restore();
    });

    await assert.rejects(
      () => financeService.markFeePayment(
        {},
        {
          collegeId: 'c1', studentId: 's1', status: 'paid', receiptDocumentId: 'doc-1',
        },
        { actorUserId: 'tutor-1', actorRole: 'class_tutor' },
      ),
      financeService.FeePaymentAlreadyMarkedError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('creates a fee payment for a real, unmarked student and audit-logs it', async () => {
    mockTutorChain(t);
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentId', async () => null);
    const createMock = t.mock.method(feePaymentRepository, 'create', async (client, fields) => ({ id: 'payment-1', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const payment = await financeService.markFeePayment(
      {},
      {
        collegeId: 'c1', studentId: 's1', status: 'paid', receiptDocumentId: 'doc-1',
      },
      { actorUserId: 'tutor-1', actorRole: 'class_tutor' },
    );

    assert.equal(payment.id, 'payment-1');
    const passedFields = createMock.mock.calls[0].arguments[1];
    assert.equal(passedFields.markedByUserId, 'tutor-1');
    assert.equal(passedFields.status, 'paid');
    assert.equal(passedFields.receiptDocumentId, 'doc-1');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'fee_payment_marked');
    assert.equal(auditMock.mock.calls[0].arguments[1].entity, 'fee_payments');
  });

  await t.test('maps a fee_payments_receipt_document_id_fkey violation to FeePaymentDocumentNotFoundError', async () => {
    mockTutorChain(t);
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentId', async () => null);
    const createMock = t.mock.method(feePaymentRepository, 'create', async () => {
      const err = new Error('violates foreign key constraint "fee_payments_receipt_document_id_fkey"');
      err.code = '23503';
      err.constraint = 'fee_payments_receipt_document_id_fkey';
      throw err;
    });
    t.after(() => {
      findMock.mock.restore();
      createMock.mock.restore();
    });

    await assert.rejects(
      () => financeService.markFeePayment(
        {},
        {
          collegeId: 'c1', studentId: 's1', status: 'paid', receiptDocumentId: 'missing-doc',
        },
        { actorUserId: 'tutor-1', actorRole: 'class_tutor' },
      ),
      financeService.FeePaymentDocumentNotFoundError,
    );
  });

  await t.test('maps a fee_payments_student_id_key race to FeePaymentConflictError', async () => {
    mockTutorChain(t);
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentId', async () => null);
    const createMock = t.mock.method(feePaymentRepository, 'create', async () => {
      const err = new Error('duplicate key value violates unique constraint "fee_payments_student_id_key"');
      err.code = '23505';
      err.constraint = 'fee_payments_student_id_key';
      throw err;
    });
    t.after(() => {
      findMock.mock.restore();
      createMock.mock.restore();
    });

    await assert.rejects(
      () => financeService.markFeePayment(
        {},
        {
          collegeId: 'c1', studentId: 's1', status: 'paid', receiptDocumentId: 'doc-1',
        },
        { actorUserId: 'tutor-1', actorRole: 'class_tutor' },
      ),
      financeService.FeePaymentConflictError,
    );
  });
});

test('FinanceService fee_payments reads/removal', async (t) => {
  await t.test('getFeePayment is a thin passthrough to findById', async () => {
    const findMock = t.mock.method(feePaymentRepository, 'findById', async (client, id) => ({ id }));
    t.after(() => findMock.mock.restore());

    const result = await financeService.getFeePayment({}, 'payment-9');
    assert.equal(result.id, 'payment-9');
  });

  await t.test('getFeePaymentForStudent with no actor context (internal system call) is a thin passthrough to findByStudentId', async () => {
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentId', async (client, studentId) => ({ studentId }));
    t.after(() => findMock.mock.restore());

    const result = await financeService.getFeePaymentForStudent({}, 'student-1');
    assert.deepEqual(result, { studentId: 'student-1' });
  });

  await t.test('getFeePaymentForStudent with an actor scopes via studentService.getStudent first', async () => {
    const getStudentMock = t.mock.method(studentService, 'getStudent', async () => ({ id: 'student-1' }));
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentId', async (client, studentId) => ({ studentId }));
    t.after(() => {
      getStudentMock.mock.restore();
      findMock.mock.restore();
    });

    const result = await financeService.getFeePaymentForStudent({}, 'student-1', { actorUserId: 'tutor-u1', actorRole: 'staff' });
    assert.deepEqual(result, { studentId: 'student-1' });
    assert.equal(getStudentMock.mock.calls[0].arguments[1], 'student-1');
  });

  await t.test('getFeePaymentForStudent throws FeePaymentStudentNotFoundError when the actor-scoped lookup finds nothing', async () => {
    const getStudentMock = t.mock.method(studentService, 'getStudent', async () => null);
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentId');
    t.after(() => {
      getStudentMock.mock.restore();
      findMock.mock.restore();
    });

    await assert.rejects(
      () => financeService.getFeePaymentForStudent({}, 'missing-student', { actorUserId: 'tutor-u1', actorRole: 'staff' }),
      financeService.FeePaymentStudentNotFoundError,
    );
    assert.equal(findMock.mock.callCount(), 0);
  });

  await t.test('getEffectiveFeePaymentForStudent returns null when the student has no fee payment at all', async () => {
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentId', async () => null);
    t.after(() => findMock.mock.restore());

    const result = await financeService.getEffectiveFeePaymentForStudent({}, 'student-1');
    assert.equal(result, null);
  });

  await t.test('getEffectiveFeePaymentForStudent reports the original status, effective:false, when no correction has been applied', async () => {
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentId', async () => ({ id: 'payment-1', status: 'not_paid' }));
    const findLatestMock = t.mock.method(feeCorrectionRepository, 'findLatestApplied', async () => null);
    t.after(() => {
      findMock.mock.restore();
      findLatestMock.mock.restore();
    });

    const result = await financeService.getEffectiveFeePaymentForStudent({}, 'student-1');
    assert.equal(result.status, 'not_paid');
    assert.equal(result.effective, false);
  });

  await t.test('getEffectiveFeePaymentForStudent layers the latest APPLIED correction on top, never mutating the original', async () => {
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentId', async () => ({ id: 'payment-1', status: 'not_paid' }));
    const findLatestMock = t.mock.method(feeCorrectionRepository, 'findLatestApplied', async () => ({ id: 'corr-1', proposed_status: 'paid' }));
    t.after(() => {
      findMock.mock.restore();
      findLatestMock.mock.restore();
    });

    const result = await financeService.getEffectiveFeePaymentForStudent({}, 'student-1');
    assert.equal(result.status, 'paid');
    assert.equal(result.effective, true);
    assert.equal(result.effective_correction_id, 'corr-1');
  });

  await t.test('removeFeePayment on a nonexistent (or already soft-deleted) id is a no-op, no audit entry', async () => {
    const softDeleteMock = t.mock.method(feePaymentRepository, 'softDelete', async () => null);
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      softDeleteMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await financeService.removeFeePayment({}, 'missing-id', { userId: 'u1' });

    assert.equal(result, null);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('removeFeePayment on an existing id soft-deletes (never a hard DELETE) and writes an audit entry', async () => {
    const softDeleteMock = t.mock.method(feePaymentRepository, 'softDelete', async (client, id) => ({ id, college_id: 'c1', deleted_at: '2026-07-04T00:00:00Z' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      softDeleteMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await financeService.removeFeePayment({}, 'payment-1', { userId: 'u1' });

    assert.equal(result.deleted_at, '2026-07-04T00:00:00Z');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'fee_payment_removed');
    assert.equal('remove' in feePaymentRepository, false);
  });

  await t.test('listFeePayments is a thin passthrough to list', async () => {
    const listMock = t.mock.method(feePaymentRepository, 'list', async (client, opts) => ([{ opts }]));
    t.after(() => listMock.mock.restore());

    const result = await financeService.listFeePayments({}, { limit: 10, offset: 0 });
    assert.deepEqual(result, [{ opts: { limit: 10, offset: 0 } }]);
  });
});

// RS-FIN-003/RS-DAT-002 (structural pattern P1): requestFeeCorrection
// resolves its approver chain via
// workflowChainService.resolveApproverChain (entityType
// 'fee_correction') instead of a hardcoded inline array — mocked the
// same way workflow-chain-service.test.js proves resolveApproverChain
// itself works; here it's just a black-box stub since this file's
// concern is requestFeeCorrection's own behavior, not the resolver's.
test('FinanceService fee corrections (RS-FIN-003)', async (t) => {
  await t.test('requestFeeCorrection rejects a missing proposedStatus', async () => {
    await assert.rejects(
      () => financeService.requestFeeCorrection({}, 'payment-1', {}, { requestedByUserId: 'u1' }),
      financeService.FeeCorrectionValidationError,
    );
  });

  await t.test('requestFeeCorrection rejects an unknown proposedStatus', async () => {
    await assert.rejects(
      () => financeService.requestFeeCorrection({}, 'payment-1', { proposedStatus: 'partial' }, { requestedByUserId: 'u1' }),
      financeService.FeePaymentStatusError,
    );
  });

  await t.test('requestFeeCorrection rejects a missing requestedByUserId', async () => {
    await assert.rejects(
      () => financeService.requestFeeCorrection({}, 'payment-1', { proposedStatus: 'paid' }, {}),
      financeService.FeeCorrectionValidationError,
    );
  });

  await t.test('requestFeeCorrection throws FeeCorrectionNotFoundError for a nonexistent fee payment', async () => {
    const findMock = t.mock.method(feePaymentRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => financeService.requestFeeCorrection({}, 'missing-payment', { proposedStatus: 'paid' }, { requestedByUserId: 'u1' }),
      financeService.FeeCorrectionNotFoundError,
    );
  });

  await t.test('requestFeeCorrection resolves the real hod and submits a single-step chain, then creates the correction row', async () => {
    const findPaymentMock = t.mock.method(feePaymentRepository, 'findById', async () => ({ id: 'payment-1', college_id: 'c1', student_id: 's1' }));
    const getStudentMock = t.mock.method(studentService, 'getStudent', async () => ({ id: 's1', college_id: 'c1', class_id: 'class-1' }));
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1', department_id: 'dept-1' }));
    const resolveChainMock = t.mock.method(workflowChainService, 'resolveApproverChain', async () => ([{ step: 1, role: 'hod', user_id: 'hod-1' }]));
    const submitMock = t.mock.method(workflowService, 'submitRequest', async (client, fields) => ({ id: 'wf-1', ...fields }));
    const createCorrectionMock = t.mock.method(feeCorrectionRepository, 'create', async (client, fields) => ({ id: 'corr-1', ...fields }));
    t.after(() => {
      findPaymentMock.mock.restore();
      getStudentMock.mock.restore();
      findClassMock.mock.restore();
      resolveChainMock.mock.restore();
      submitMock.mock.restore();
      createCorrectionMock.mock.restore();
    });

    const result = await financeService.requestFeeCorrection(
      {},
      'payment-1',
      { proposedStatus: 'paid', reason: 'receipt found' },
      { requestedByUserId: 'requester-1' },
    );

    assert.equal(result.workflowRequest.id, 'wf-1');
    assert.equal(result.correction.id, 'corr-1');
    const resolvedFor = resolveChainMock.mock.calls[0].arguments[1];
    assert.equal(resolvedFor.entityType, 'fee_correction');
    assert.equal(resolvedFor.collegeId, 'c1');
    assert.equal(resolvedFor.departmentId, 'dept-1');
    const submitted = submitMock.mock.calls[0].arguments[1];
    assert.equal(submitted.entityType, 'fee_correction');
    assert.equal(submitted.entityId, 'payment-1');
    assert.deepEqual(submitted.approverChain, [{ step: 1, role: 'hod', user_id: 'hod-1' }]);
    assert.equal(createCorrectionMock.mock.calls[0].arguments[1].proposedStatus, 'paid');
  });

  // Proves the fix: fee_correction is now resolved through
  // workflowChainService.resolveApproverChain instead of a hardcoded
  // inline array, so an institution-configured chain actually changes
  // who approves — same "resolveApproverChain drives the real
  // approverChain" proof workflow-chain-service.test.js already
  // establishes for record_restoration/substitute_assignment, just
  // exercised here through requestFeeCorrection's own call site.
  await t.test('requestFeeCorrection is institution-configurable: an overridden chain changes the approver', async () => {
    const findPaymentMock = t.mock.method(feePaymentRepository, 'findById', async () => ({ id: 'payment-1', college_id: 'c1', student_id: 's1' }));
    const getStudentMock = t.mock.method(studentService, 'getStudent', async () => ({ id: 's1', college_id: 'c1', class_id: 'class-1' }));
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1', department_id: 'dept-1' }));
    const resolveChainMock = t.mock.method(
      workflowChainService,
      'resolveApproverChain',
      async () => ([{ step: 1, role: 'hod', user_id: 'hod-1' }, { step: 2, role: 'principal', user_id: 'principal-1' }]),
    );
    const submitMock = t.mock.method(workflowService, 'submitRequest', async (client, fields) => ({ id: 'wf-2', ...fields }));
    const createCorrectionMock = t.mock.method(feeCorrectionRepository, 'create', async (client, fields) => ({ id: 'corr-2', ...fields }));
    t.after(() => {
      findPaymentMock.mock.restore();
      getStudentMock.mock.restore();
      findClassMock.mock.restore();
      resolveChainMock.mock.restore();
      submitMock.mock.restore();
      createCorrectionMock.mock.restore();
    });

    await financeService.requestFeeCorrection(
      {},
      'payment-1',
      { proposedStatus: 'paid' },
      { requestedByUserId: 'requester-1' },
    );

    const submitted = submitMock.mock.calls[0].arguments[1];
    assert.deepEqual(submitted.approverChain, [
      { step: 1, role: 'hod', user_id: 'hod-1' },
      { step: 2, role: 'principal', user_id: 'principal-1' },
    ]);
  });

  await t.test('approveFeeCorrection calls workflowService.approveRequest then marks the correction applied — never touches the original fee_payments row', async () => {
    const findCorrectionMock = t.mock.method(feeCorrectionRepository, 'findById', async () => ({ id: 'corr-1', college_id: 'c1', workflow_request_id: 'wf-1' }));
    const getRequestMock = t.mock.method(workflowService, 'getRequest', async () => ({ id: 'wf-1', status: 'Pending' }));
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({ id: 'wf-1', status: 'Approved' }));
    const markAppliedMock = t.mock.method(feeCorrectionRepository, 'markApplied', async (client, id) => ({ id, applied_at: '2026-07-25T00:00:00Z' }));
    const updatePaymentMock = t.mock.method(feePaymentRepository, 'update');
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findCorrectionMock.mock.restore();
      getRequestMock.mock.restore();
      approveMock.mock.restore();
      markAppliedMock.mock.restore();
      updatePaymentMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await financeService.approveFeeCorrection({}, 'corr-1', { actorUserId: 'hod-1' });

    assert.ok(result.applied_at);
    assert.equal(updatePaymentMock.mock.callCount(), 0);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'fee_correction_approved');
  });

  await t.test('approveFeeCorrection throws FeeCorrectionNoPendingRequestError when nothing is pending', async () => {
    const findCorrectionMock = t.mock.method(feeCorrectionRepository, 'findById', async () => ({ id: 'corr-1', college_id: 'c1', workflow_request_id: null }));
    t.after(() => findCorrectionMock.mock.restore());

    await assert.rejects(
      () => financeService.approveFeeCorrection({}, 'corr-1', { actorUserId: 'hod-1' }),
      financeService.FeeCorrectionNoPendingRequestError,
    );
  });

  await t.test('rejectFeeCorrection calls workflowService.rejectRequest and never marks the correction applied', async () => {
    const findCorrectionMock = t.mock.method(feeCorrectionRepository, 'findById', async () => ({ id: 'corr-1', college_id: 'c1', workflow_request_id: 'wf-1' }));
    const getRequestMock = t.mock.method(workflowService, 'getRequest', async () => ({ id: 'wf-1', status: 'Pending' }));
    const rejectMock = t.mock.method(workflowService, 'rejectRequest', async () => ({ id: 'wf-1', status: 'Rejected' }));
    const markAppliedMock = t.mock.method(feeCorrectionRepository, 'markApplied');
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findCorrectionMock.mock.restore();
      getRequestMock.mock.restore();
      rejectMock.mock.restore();
      markAppliedMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await financeService.rejectFeeCorrection({}, 'corr-1', { actorUserId: 'hod-1', remarks: 'no' });

    assert.equal(result.id, 'corr-1');
    assert.equal(markAppliedMock.mock.callCount(), 0);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'fee_correction_rejected');
  });

  await t.test('listFeeCorrectionsForPayment is a thin passthrough to listForFeePayment', async () => {
    const listMock = t.mock.method(feeCorrectionRepository, 'listForFeePayment', async (client, feePaymentId) => ([{ feePaymentId }]));
    t.after(() => listMock.mock.restore());

    const result = await financeService.listFeeCorrectionsForPayment({}, 'payment-1');
    assert.deepEqual(result, [{ feePaymentId: 'payment-1' }]);
  });
});

// BusinessRules.md Finance: "Students below a configured income
// threshold become scholarship eligible (exact threshold is per-tenant
// config, not hardcoded)." studentService/configurationService mocked
// the same way staffService already is above — never
// studentRepository/configurationRepository directly (CLAUDE.md rule 1).
test('FinanceService.checkScholarshipEligibility (no DB)', async (t) => {
  await t.test('throws ScholarshipStudentNotFoundError for a nonexistent student', async () => {
    const getStudentMock = t.mock.method(studentService, 'getStudent', async () => null);
    t.after(() => getStudentMock.mock.restore());

    await assert.rejects(
      () => financeService.checkScholarshipEligibility({}, 'c1', 'missing-student'),
      financeService.ScholarshipStudentNotFoundError,
    );
  });

  await t.test('reports ineligible with reason no_income_on_file when annual_income is null, never reads the threshold config', async () => {
    const getStudentMock = t.mock.method(studentService, 'getStudent', async () => ({ id: 's1', annual_income: null }));
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration');
    t.after(() => {
      getStudentMock.mock.restore();
      getConfigMock.mock.restore();
    });

    const result = await financeService.checkScholarshipEligibility({}, 'c1', 's1');

    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'no_income_on_file');
    assert.equal(getConfigMock.mock.callCount(), 0);
  });

  await t.test('throws ScholarshipThresholdNotConfiguredError when the tenant has no finance.scholarshipIncomeThreshold set', async () => {
    const getStudentMock = t.mock.method(studentService, 'getStudent', async () => ({ id: 's1', annual_income: 50000 }));
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    t.after(() => {
      getStudentMock.mock.restore();
      getConfigMock.mock.restore();
    });

    await assert.rejects(
      () => financeService.checkScholarshipEligibility({}, 'c1', 's1'),
      financeService.ScholarshipThresholdNotConfiguredError,
    );
  });

  await t.test('reports eligible when annual_income is below the configured threshold', async () => {
    const getStudentMock = t.mock.method(studentService, 'getStudent', async () => ({ id: 's1', annual_income: 40000 }));
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => ({
      configuration: { scholarshipIncomeThreshold: 100000 },
    }));
    t.after(() => {
      getStudentMock.mock.restore();
      getConfigMock.mock.restore();
    });

    const result = await financeService.checkScholarshipEligibility({}, 'c1', 's1');

    assert.equal(result.eligible, true);
    assert.equal(result.reason, 'below_threshold');
    assert.equal(result.annualIncome, 40000);
    assert.equal(result.threshold, 100000);
  });

  await t.test('reports ineligible when annual_income is at or above the configured threshold', async () => {
    const getStudentMock = t.mock.method(studentService, 'getStudent', async () => ({ id: 's1', annual_income: 150000 }));
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => ({
      configuration: { scholarshipIncomeThreshold: 100000 },
    }));
    t.after(() => {
      getStudentMock.mock.restore();
      getConfigMock.mock.restore();
    });

    const result = await financeService.checkScholarshipEligibility({}, 'c1', 's1');

    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'at_or_above_threshold');
  });
});

// RS-FIN-001/004 (D4, Stage 4): no fee-structure/amount concept left —
// a plain student_id -> status lookup, never a per-category breakdown.
test('FinanceService.computeFeeStatusForStudents (Students List Fee Status column)', async (t) => {
  await t.test('returns an empty Map without touching the DB when given no students', async () => {
    const listPaymentsMock = t.mock.method(feePaymentRepository, 'list');
    t.after(() => listPaymentsMock.mock.restore());

    const result = await financeService.computeFeeStatusForStudents({}, []);

    assert.equal(result.size, 0);
    assert.equal(listPaymentsMock.mock.callCount(), 0);
  });

  await t.test('a student with no fee_payments row is "unmarked"', async () => {
    const listPaymentsMock = t.mock.method(feePaymentRepository, 'list', async () => []);
    t.after(() => listPaymentsMock.mock.restore());

    const result = await financeService.computeFeeStatusForStudents({}, [{ id: 's1' }]);

    assert.equal(result.get('s1'), 'unmarked');
  });

  await t.test('a student with a paid row is "paid"', async () => {
    const listPaymentsMock = t.mock.method(feePaymentRepository, 'list', async () => [
      { student_id: 's1', status: 'paid' },
    ]);
    t.after(() => listPaymentsMock.mock.restore());

    const result = await financeService.computeFeeStatusForStudents({}, [{ id: 's1' }]);

    assert.equal(result.get('s1'), 'paid');
  });

  await t.test('a student with a not_paid row is "not_paid"', async () => {
    const listPaymentsMock = t.mock.method(feePaymentRepository, 'list', async () => [
      { student_id: 's1', status: 'not_paid' },
    ]);
    t.after(() => listPaymentsMock.mock.restore());

    const result = await financeService.computeFeeStatusForStudents({}, [{ id: 's1' }]);

    assert.equal(result.get('s1'), 'not_paid');
  });
});
