'use strict';

// Business logic for Module 5's `fee_payments`/`fee_corrections` and
// scholarship eligibility — validation and audit logging on top of
// feePaymentRepository.js/feeCorrectionRepository.js/
// scholarshipDecisionRepository.js, none of which does either
// (CLAUDE.md rule 1). Never calls one repository from another, and
// never composes a different service's repository directly (CLAUDE.md
// rule 4).
//
// RS-FIN-001 (D4, Stage 4): "ARCNAVE tracks no fee amount and no fee
// schedule. The fee-structure concept does not exist." The
// fee_structures table, its route, and every function here that used
// to manage it (createFeeStructure/updateFeeStructure/
// removeFeeStructure/submitFeeStructureApproval/approveFeeStructure/
// rejectFeeStructure/listFeeStructures*) are REMOVED, not deprecated
// — see 1758900000000's own migration comment and
// docs/bka/30-decisions/ledger.md's ADL-013.
//
// RS-FIN-002 (D5): "First-time marking of a student's fee line Paid or
// Not Paid is a direct write by the class's own L4, with a required
// receipt document attached as the evidence of record." markFeePayment
// now: (a) verifies actorUserId is the real, verified tutor of the
// target student's own class — the same per-row ownership check
// recordScholarshipDecision already establishes below, not a
// role-only gate; (b) requires receiptDocumentId, not merely accepts
// it — "the attached receipt is what makes this safe, not
// convenience"; (c) refuses (FeePaymentAlreadyMarkedError) if a row
// already exists for this student rather than silently upserting —
// RS-FIN-003: "any LATER change... is a correction." A fee status is
// therefore a single Paid/Not-Paid flag per student
// (fee_payments_student_id_key), never per fee-line, since there is no
// fee-line concept left to key it against.
//
// RS-FIN-003/RS-DAT-002 (structural pattern P1): requestFeeCorrection/
// approveFeeCorrection/rejectFeeCorrection are new — modeled directly
// on attendanceService.js's requestAttendanceCorrection/
// approveAttendanceCorrection/rejectAttendanceCorrection (see that
// file's own header comment; applies here verbatim). The original
// fee_payments row is never touched by a correction — approval only
// ever sets fee_corrections.applied_at; getEffectiveFeePayment layers
// the latest applied correction on top at read time, the same
// "original retained, effective value computed" shape
// getEffectiveAttendanceSession already established. L3 (hod) approves
// by default — one level above the L4 owner — but the chain is
// resolved via workflowChainService.resolveApproverChain
// (entityType 'fee_correction'), not a hardcoded inline array: an
// institution can now configure it like every other chain.

const feePaymentRepository = require('../repositories/feePaymentRepository');
const feeCorrectionRepository = require('../repositories/feeCorrectionRepository');
const scholarshipDecisionRepository = require('../repositories/scholarshipDecisionRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const workflowService = require('./workflowService');
const workflowChainService = require('./workflowChainService');
const studentService = require('./studentService');
const classRepository = require('../repositories/classRepository');
const configurationService = require('./configurationService');
const identityService = require('./identityService');

// Missing collegeId, studentId, actorUserId, status, or
// receiptDocumentId — fee_payments' own NOT NULL columns, plus the
// actor identity markFeePayment cannot proceed without (same
// reasoning attendanceService.markAttendance's own actor-identity
// guard gives), plus the required-receipt rule RS-FIN-002 states
// explicitly. status is required, not defaulted: "mark paid/not-paid"
// is the entire point of this action, so a caller that omits it has a
// bug worth surfacing, not a silent 'not_paid' fallback.
class FeePaymentValidationError extends Error {}

// Known real fee_payments.status values — 'paid' or 'not_paid', per
// RS-FIN-004: "exactly two fee statuses exist... no amount."
class FeePaymentStatusError extends Error {}

// fee_payments_student_id_fkey violated (Postgres 23503) — the given
// studentId doesn't exist. Also thrown when markFeePayment/
// requestFeeCorrection is asked to act on a studentId/feePaymentId
// that visibility scoping already rejected.
class FeePaymentStudentNotFoundError extends Error {}

// fee_payments_receipt_document_id_fkey violated (Postgres 23503) —
// the given receiptDocumentId doesn't exist.
class FeePaymentDocumentNotFoundError extends Error {}

// markFeePayment called by an actor who is not the real, verified
// tutor of the target student's own class — RS-FIN-002: "L4, own
// class only." Same per-row ownership check
// ScholarshipDecisionNotTutorError already establishes for the
// identical actor/target relationship.
class FeePaymentNotAuthorizedError extends Error {}

// markFeePayment called for a student who already has a fee_payments
// row — RS-FIN-003: "any later change to a fee status already marked
// once is a correction." The caller must use requestFeeCorrection
// instead of a second direct write.
class FeePaymentAlreadyMarkedError extends Error {}

// fee_payments_student_id_key (the partial unique index) violated
// (Postgres 23505) on a raw INSERT race — markFeePayment's own
// find-then-create flow avoids hitting this in the normal case, so
// this only fires if two concurrent callers mark the same student at
// the same instant. Same shape as attendanceService.AttendanceSessionConflictError.
class FeePaymentConflictError extends Error {}

// requestFeeCorrection's own required inputs (proposedStatus) missing,
// or proposedStatus not a known fee_payments.status value.
class FeeCorrectionValidationError extends Error {}

// requestFeeCorrection given a feePaymentId with no matching row.
class FeeCorrectionNotFoundError extends Error {}

// approveFeeCorrection/rejectFeeCorrection given a correctionId with
// no matching row, or one with no live Pending workflow_requests row
// governing it.
class FeeCorrectionNoPendingRequestError extends Error {}

// checkScholarshipEligibility given a studentId with no matching row.
class ScholarshipStudentNotFoundError extends Error {}

// checkScholarshipEligibility's tenant has never configured
// ConfigurationService category 'finance''s scholarshipIncomeThreshold
// key (BusinessRules.md Finance: "exact threshold is per-tenant
// config, not hardcoded"). Distinct from a normal "not eligible"
// result: a missing threshold means the question can't be answered
// yet, an administrative gap this tenant needs to fix, not a real
// eligibility outcome.
class ScholarshipThresholdNotConfiguredError extends Error {}

// Missing schemeName, or eligible not a boolean —
// recordScholarshipDecision's own required inputs.
class ScholarshipDecisionValidationError extends Error {}

// recordScholarshipDecision called by a user who is not the student's
// current class's tutor — BusinessRules.md Scholarship: "the Class
// Tutor reviews students and marks each one Eligible or Not Eligible."
// Same per-row identity check studentService.createStudent's own
// StudentNotClassTutorError already establishes for a Tutor-scoped
// action, not a role-only check.
class ScholarshipDecisionNotTutorError extends Error {}

const VALID_FEE_PAYMENT_STATUSES = ['paid', 'not_paid'];

function assertValidFeePaymentStatus(status) {
  if (!VALID_FEE_PAYMENT_STATUSES.includes(status)) {
    throw new FeePaymentStatusError(`status ${JSON.stringify(status)} is not a known value`);
  }
}

// Shared by markFeePayment/requestFeeCorrection: resolves the class
// (and therefore department/college) a student belongs to. Returns
// null if the student has no class assigned — callers treat that as
// "no owner to verify against," never a guess.
async function loadStudentClass(client, studentId) {
  const student = await studentService.getStudent(client, studentId);
  if (student === null) {
    return { student: null, cls: null };
  }
  const cls = student.class_id ? await classRepository.findById(client, student.class_id) : null;
  return { student, cls };
}

// RS-FIN-002's own ownership check — mirrors recordScholarshipDecision's
// identical tutor-of-own-class verification below (Phase 2 step 14's
// swap onto identityService.resolvePositionOccupant, same "resolve the
// real assignment, never trust a role string" discipline).
//
// 4-login authorization architecture (2026-08-09): actorRole must be
// 'class_tutor' — the CURRENT LOGIN's identity, only ever true for an
// authenticated L4 Position Account session. Position Occupancy alone
// (resolvePositionOccupant matching actorUserId) is informational and
// must never substitute for this. This is the exact pattern
// finance_record_payment's AI tool already established correctly
// (classificationOverrideRoles: ['class_tutor'], never widened to
// plain 'staff') — now enforced at the service layer too.
async function assertIsClassTutor(client, cls, actorUserId, actorRole) {
  if (actorRole !== 'class_tutor') {
    return false;
  }
  const tutorUserId = cls ? await identityService.resolvePositionOccupant(client, { collegeId: cls.college_id, classId: cls.id }) : null;
  return cls !== null && tutorUserId === actorUserId;
}

// BusinessRules.md Finance / RS-FIN-002: first-time marking only — a
// direct, receipt-backed write by the class's own L4, no approval
// gate. Refuses outright (FeePaymentAlreadyMarkedError) if the student
// already has a row; any later change is requestFeeCorrection's job,
// never a second call here.
async function markFeePayment(client, { collegeId, studentId, status, receiptDocumentId }, { actorUserId, actorRole } = {}) {
  if (!collegeId || !studentId || !actorUserId || !status || !receiptDocumentId) {
    throw new FeePaymentValidationError('collegeId, studentId, actorUserId, status, and receiptDocumentId are required');
  }
  assertValidFeePaymentStatus(status);

  const { student, cls } = await loadStudentClass(client, studentId);
  if (student === null) {
    throw new FeePaymentStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }
  if (!(await assertIsClassTutor(client, cls, actorUserId, actorRole))) {
    throw new FeePaymentNotAuthorizedError(
      `user ${JSON.stringify(actorUserId)} is not the class tutor for student ${JSON.stringify(studentId)}`,
    );
  }

  const existing = await feePaymentRepository.findByStudentId(client, studentId);
  if (existing !== null) {
    throw new FeePaymentAlreadyMarkedError(
      `student ${JSON.stringify(studentId)} already has a fee status on record — submit a correction instead of marking again`,
    );
  }

  let payment;
  try {
    payment = await feePaymentRepository.create(client, {
      collegeId, studentId, status, markedByUserId: actorUserId, receiptDocumentId,
    });
  } catch (err) {
    if (err.code === '23503' && err.constraint === 'fee_payments_student_id_fkey') {
      throw new FeePaymentStudentNotFoundError(`studentId ${JSON.stringify(studentId)} does not exist`);
    }
    if (err.code === '23503' && err.constraint === 'fee_payments_receipt_document_id_fkey') {
      throw new FeePaymentDocumentNotFoundError(`receiptDocumentId ${JSON.stringify(receiptDocumentId)} does not exist`);
    }
    if (err.code === '23505' && err.constraint === 'fee_payments_student_id_key') {
      throw new FeePaymentConflictError(
        `fee status for student ${JSON.stringify(studentId)} was just marked by someone else`,
      );
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'fee_payment_marked',
    entity: 'fee_payments',
    entityId: payment.id,
    metadata: null,
  });

  return payment;
}

// null means no fee payment exists with this id — not an error. The
// route turns that into 404, same as every other getX in this
// codebase.
async function getFeePayment(client, id) {
  return feePaymentRepository.findById(client, id);
}

// The natural "this student's fee status" lookup a student profile
// screen needs. actorUserId/actorRole are optional for the same reason
// studentService.getStudent's are: a future internal caller that
// already resolved its own authorization can omit them and get the
// unscoped read — but routes/finance.js's own route always supplies
// them (the same tutor/hod/principal boundary every other place
// student data is reachable already uses, not reimplemented here).
async function getFeePaymentForStudent(client, studentId, { actorUserId, actorRole } = {}) {
  if (actorRole !== undefined) {
    const student = await studentService.getStudent(client, studentId, { actorUserId, actorRole });
    if (student === null) {
      throw new FeePaymentStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
    }
  }
  return feePaymentRepository.findByStudentId(client, studentId);
}

// RS-DAT-002's "effective value" half for fee status: the original
// fee_payments row (getFeePayment above) is untouched and always
// available for audit; this is the latest-effective-value half — the
// original's own status, overridden by the latest APPLIED correction's
// proposed status, if one exists. Mirrors
// attendanceService.getEffectiveAttendanceSession exactly.
async function getEffectiveFeePaymentForStudent(client, studentId, { actorUserId, actorRole } = {}) {
  const payment = await getFeePaymentForStudent(client, studentId, { actorUserId, actorRole });
  if (payment === null) {
    return null;
  }

  const latestApplied = await feeCorrectionRepository.findLatestApplied(client, payment.id);
  if (latestApplied === null) {
    return { ...payment, effective: false };
  }

  return {
    ...payment,
    status: latestApplied.proposed_status,
    effective: true,
    effective_correction_id: latestApplied.id,
  };
}

// Soft-delete only: feePaymentRepository has no hard-delete function
// at all.
async function removeFeePayment(client, id, { userId } = {}) {
  const payment = await feePaymentRepository.softDelete(client, id);
  if (payment === null) {
    return null;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: payment.college_id,
    userId,
    action: 'fee_payment_removed',
    entity: 'fee_payments',
    entityId: id,
    metadata: null,
  });

  return payment;
}

async function listFeePayments(client, { limit, offset } = {}) {
  return feePaymentRepository.list(client, { limit, offset });
}

// RS-FIN-003: "Any later change to a fee status already marked once is
// a correction, and L3 approves it... scoped to L3's own department's
// students." Chain resolved via workflowChainService.resolveApproverChain
// (entityType 'fee_correction', default ['hod']) — an institution can
// now configure this chain like every other one, instead of the
// hardcoded `[{ role: 'hod', ... }]` array this function used to build
// itself.
async function requestFeeCorrection(client, feePaymentId, { proposedStatus, reason } = {}, { requestedByUserId, origin = 'human' } = {}) {
  if (!proposedStatus) {
    throw new FeeCorrectionValidationError('proposedStatus is required');
  }
  assertValidFeePaymentStatus(proposedStatus);
  if (!requestedByUserId) {
    throw new FeeCorrectionValidationError('requestedByUserId is required');
  }

  const payment = await feePaymentRepository.findById(client, feePaymentId);
  if (payment === null) {
    throw new FeeCorrectionNotFoundError(`fee payment ${JSON.stringify(feePaymentId)} does not exist`);
  }

  const { cls } = await loadStudentClass(client, payment.student_id);
  if (cls === null) {
    throw new FeeCorrectionValidationError(
      `student ${JSON.stringify(payment.student_id)} has no class/department to resolve an hod approver from`,
    );
  }
  const approverChain = await workflowChainService.resolveApproverChain(client, {
    collegeId: cls.college_id, entityType: 'fee_correction', classId: cls.id, departmentId: cls.department_id,
  });

  const workflowRequest = await workflowService.submitRequest(client, {
    collegeId: payment.college_id,
    entityType: 'fee_correction',
    entityId: feePaymentId,
    requestedByUserId,
    origin,
    approverChain,
  });

  const correction = await feeCorrectionRepository.create(client, {
    collegeId: payment.college_id,
    feePaymentId,
    requestedByUserId,
    proposedStatus,
    reason,
    workflowRequestId: workflowRequest.id,
  });

  return { workflowRequest, correction };
}

async function loadPendingFeeCorrectionApproval(client, correctionId) {
  const correction = await feeCorrectionRepository.findById(client, correctionId);
  if (correction === null) {
    throw new FeeCorrectionNotFoundError(`fee correction ${JSON.stringify(correctionId)} does not exist`);
  }
  if (correction.workflow_request_id === null) {
    throw new FeeCorrectionNoPendingRequestError(`fee correction ${JSON.stringify(correctionId)} has no workflow request`);
  }
  const pending = await workflowService.getRequest(client, correction.workflow_request_id);
  if (pending === null || pending.status !== 'Pending') {
    throw new FeeCorrectionNoPendingRequestError(`fee correction ${JSON.stringify(correctionId)} has no pending approval request`);
  }
  return { correction, pending };
}

// RS-DAT-002: "the approved correction becomes the new effective
// value... all dependent calculations recompute from it." The
// original fee_payments row is deliberately NEVER updated here — only
// fee_corrections.applied_at is set; getEffectiveFeePaymentForStudent
// is what "recomputes from it."
async function approveFeeCorrection(client, correctionId, { actorUserId, remarks } = {}) {
  const { correction, pending } = await loadPendingFeeCorrectionApproval(client, correctionId);
  await workflowService.approveRequest(client, pending.id, { actorUserId, remarks });

  const applied = await feeCorrectionRepository.markApplied(client, correctionId);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: correction.college_id,
    userId: actorUserId,
    action: 'fee_correction_approved',
    entity: 'fee_corrections',
    entityId: correctionId,
    metadata: null,
  });

  return applied;
}

async function rejectFeeCorrection(client, correctionId, { actorUserId, remarks } = {}) {
  const { correction, pending } = await loadPendingFeeCorrectionApproval(client, correctionId);
  await workflowService.rejectRequest(client, pending.id, { actorUserId, remarks });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: correction.college_id,
    userId: actorUserId,
    action: 'fee_correction_rejected',
    entity: 'fee_corrections',
    entityId: correctionId,
    metadata: null,
  });

  return correction;
}

async function listFeeCorrectionsForPayment(client, feePaymentId) {
  return feeCorrectionRepository.listForFeePayment(client, feePaymentId);
}

// BusinessRules.md Finance — Scholarship eligibility (superseded): this
// income-threshold check is retained ONLY as one advisory input a
// Class Tutor may consult — never the eligibility outcome itself. It
// is not called from anywhere that records or acts on eligibility;
// recordScholarshipDecision below (the Tutor's real, audited decision)
// is the actual outcome BusinessRules.md now describes. Reads the
// student's own annual_income through StudentService, never
// studentRepository directly (CLAUDE.md rule 1/Architecture.md 2.5 —
// FinanceService owns scholarship eligibility, but a student record is
// StudentService's table), and the threshold through
// ConfigurationService category 'finance', key
// scholarshipIncomeThreshold — never a hardcoded number. A student
// with no annual_income on file is reported ineligible with a distinct
// reason rather than throwing: "we don't know this student's income"
// is a normal, expected state (income collection is optional), not an
// error the caller needs to handle specially.
async function checkScholarshipEligibility(client, collegeId, studentId, { actorUserId, actorRole } = {}) {
  const student = await studentService.getStudent(client, studentId, { actorUserId, actorRole });
  if (student === null) {
    throw new ScholarshipStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }

  if (student.annual_income === null || student.annual_income === undefined) {
    return {
      eligible: false, reason: 'no_income_on_file', annualIncome: null, threshold: null,
    };
  }

  const config = await configurationService.getConfiguration(client, { collegeId, category: 'finance' });
  const threshold = config ? config.configuration.scholarshipIncomeThreshold : undefined;
  if (threshold === undefined || threshold === null) {
    throw new ScholarshipThresholdNotConfiguredError(
      `college ${JSON.stringify(collegeId)} has no finance.scholarshipIncomeThreshold configured`,
    );
  }

  const annualIncome = Number(student.annual_income);
  const eligible = annualIncome < Number(threshold);
  return {
    eligible,
    reason: eligible ? 'below_threshold' : 'at_or_above_threshold',
    annualIncome,
    threshold: Number(threshold),
  };
}

// BusinessRules.md Scholarship: "the Class Tutor reviews students and
// marks each one Eligible or Not Eligible according to the
// institution's own policy... every eligibility decision is audited."
// This is that decision — the real outcome, unlike
// checkScholarshipEligibility above (advisory only). No hardcoded
// criteria enforced here either: eligible is whatever the Tutor
// decided, for whatever reason they recorded, per institution policy
// this codebase doesn't (and per BusinessRules.md, shouldn't) encode.
async function recordScholarshipDecision(client, studentId, {
  schemeName, eligible, reason, supportingDocumentId,
}, { actorUserId, actorRole } = {}) {
  if (!schemeName) {
    throw new ScholarshipDecisionValidationError('schemeName is required');
  }
  if (typeof eligible !== 'boolean') {
    throw new ScholarshipDecisionValidationError('eligible must be a boolean');
  }

  const { student, cls } = await loadStudentClass(client, studentId);
  if (student === null) {
    throw new ScholarshipStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }
  if (!(await assertIsClassTutor(client, cls, actorUserId, actorRole))) {
    throw new ScholarshipDecisionNotTutorError(
      `user ${JSON.stringify(actorUserId)} is not the class tutor for student ${JSON.stringify(studentId)}`,
    );
  }

  const decision = await scholarshipDecisionRepository.create(client, {
    collegeId: student.college_id,
    studentId,
    schemeName,
    eligible,
    reason,
    supportingDocumentId,
    decidedByUserId: actorUserId,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: student.college_id,
    userId: actorUserId,
    action: 'scholarship_decision_recorded',
    entity: 'scholarship_decisions',
    entityId: decision.id,
    metadata: { schemeName, eligible },
  });

  return decision;
}

async function listScholarshipDecisionsForStudent(client, studentId) {
  return scholarshipDecisionRepository.listForStudent(client, studentId);
}

// finance_status_summary (AI tool, principal-only per RS-FIN-006 — fee
// data is Restricted). RS-FIN-004: "there is no amount to summarise" —
// this reports counts only, never a collected/outstanding total, since
// there is no amount anywhere left in this schema to sum.
async function getFeeStatusSummary(client) {
  const payments = await feePaymentRepository.list(client, { limit: 5000 });

  let paidCount = 0;
  let notPaidCount = 0;
  for (const payment of payments) {
    if (payment.status === 'paid') paidCount += 1;
    else notPaidCount += 1;
  }

  return {
    paymentsRecordedCount: payments.length,
    paidCount,
    notPaidCount,
  };
}

// Small, additive, read-only summary for the Students List page's Fee
// Status column — the per-student counterpart to getFeeStatusSummary
// above. NOT called from studentService (circular require — this file
// already depends upward on studentService); callers (routes/students.js)
// pass plain {id} refs instead. Three possible values now, matching
// RS-FIN-002's own lifecycle ("unmarked -> marked -> (corrected)") and
// RS-FIN-004 ("exactly two fee statuses... no Partial"): 'unmarked' (no
// row yet), 'paid', 'not_paid' — never a per-category breakdown, since
// there is no category concept left.
async function computeFeeStatusForStudents(client, students) {
  if (students.length === 0) {
    return new Map();
  }

  const payments = await feePaymentRepository.list(client, { limit: 5000 });
  const paymentByStudentId = new Map(payments.map((p) => [p.student_id, p]));

  const result = new Map();
  for (const student of students) {
    const payment = paymentByStudentId.get(student.id);
    result.set(student.id, payment ? payment.status : 'unmarked');
  }
  return result;
}

module.exports = {
  FeePaymentValidationError,
  FeePaymentStatusError,
  FeePaymentStudentNotFoundError,
  FeePaymentDocumentNotFoundError,
  FeePaymentNotAuthorizedError,
  FeePaymentAlreadyMarkedError,
  FeePaymentConflictError,
  FeeCorrectionValidationError,
  FeeCorrectionNotFoundError,
  FeeCorrectionNoPendingRequestError,
  ScholarshipStudentNotFoundError,
  ScholarshipThresholdNotConfiguredError,
  ScholarshipDecisionValidationError,
  ScholarshipDecisionNotTutorError,
  markFeePayment,
  getFeePayment,
  getFeePaymentForStudent,
  getEffectiveFeePaymentForStudent,
  removeFeePayment,
  listFeePayments,
  requestFeeCorrection,
  approveFeeCorrection,
  rejectFeeCorrection,
  listFeeCorrectionsForPayment,
  checkScholarshipEligibility,
  recordScholarshipDecision,
  listScholarshipDecisionsForStudent,
  getFeeStatusSummary,
  computeFeeStatusForStudents,
};
