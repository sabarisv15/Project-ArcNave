'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/rbac');
const financeService = require('../services/financeService');
const staffService = require('../services/staffService');
const studentService = require('../services/studentService');
const workflowService = require('../services/workflowService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// Mounted at /finance/... (not flat like /classes, /attendance,
// /staff, /students) — same deliberate deviation from this codebase's
// dominant flat-router convention the first Finance slice established.
//
// RS-FIN-001 (D4, Stage 4): fee_structures and every route that used
// to manage it (create/update/submit-approval/list) are REMOVED, not
// deprecated — see financeService.js's own header comment and
// docs/bka/30-decisions/ledger.md's ADL-013.
const FEE_PAYMENT_BODY_FIELDS = [
  ['student_id', 'studentId'],
  ['status', 'status'],
  ['receipt_document_id', 'receiptDocumentId'],
];

function bodyToFields(body, fieldMap) {
  const fields = {};
  for (const [snakeKey, camelKey] of fieldMap) {
    if (body[snakeKey] !== undefined) {
      fields[camelKey] = body[snakeKey];
    }
  }
  return fields;
}

// Response bodies are NOT translated back to camelCase — same choice
// classes.js/attendance.js/staff.js/students.js all made.

function mapFinanceServiceError(err, res) {
  if (err instanceof financeService.FeePaymentValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.FeePaymentStatusError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.FeePaymentStudentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.FeePaymentDocumentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.FeePaymentNotAuthorizedError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.FeePaymentAlreadyMarkedError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.FeePaymentConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.FeeCorrectionValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.FeeCorrectionNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.FeeCorrectionNoPendingRequestError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.ScholarshipStudentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.ScholarshipThresholdNotConfiguredError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.ScholarshipDecisionValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.ScholarshipDecisionNotTutorError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  // requestFeeCorrection's own error surface, per its own comment:
  // resolves the department's real hod via staffService.findHodForDepartment
  // (throws if none exists yet) then calls workflowService.submitRequest
  // — none of these are financeService's own error classes, but this
  // route is the one place they can actually surface.
  if (err instanceof staffService.StaffHodNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowService.WorkflowRequestConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowService.WorkflowRequestUserNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowService.WorkflowRequestValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowService.WorkflowRequestNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowService.WorkflowRequestAlreadyResolvedError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowService.WorkflowRequestStepMismatchError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowService.WorkflowRequestSelfApprovalError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  // The shared student read-access scope check (studentService.
  // assertCanViewStudent, via getStudent) surfaces this for every
  // per-student Finance route below — same mapping routes/students.js
  // already uses for it.
  if (err instanceof studentService.StudentNotAuthorizedError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  return false;
}

const feePaymentIdParams = z.object({ id: z.string() });
const correctionIdParams = z.object({ correctionId: z.string() });
const studentIdParams = z.object({ id: z.string() });
const markFeePaymentSchema = z.object({
  body: z
    .object({
      student_id: z.string().optional(),
      status: z.string().optional(),
      receipt_document_id: z.string().optional(),
    })
    .optional(),
});
const getFeePaymentSchema = z.object({
  query: z.object({ student_id: z.string().optional() }).optional(),
});
const requestFeeCorrectionSchema = z.object({
  params: feePaymentIdParams,
  body: z.object({ proposed_status: z.string().optional(), reason: z.string().optional() }).optional(),
});
const listFeeCorrectionsSchema = z.object({ params: feePaymentIdParams });
const approveFeeCorrectionSchema = z.object({ params: correctionIdParams });
const rejectFeeCorrectionSchema = z.object({ params: correctionIdParams });
const scholarshipEligibilitySchema = z.object({ params: studentIdParams });
const recordScholarshipDecisionSchema = z.object({
  params: studentIdParams,
  body: z
    .object({
      scheme_name: z.string().optional(),
      eligible: z.any().optional(),
      reason: z.string().optional(),
      supporting_document_id: z.string().optional(),
    })
    .optional(),
});
const listScholarshipDecisionsSchema = z.object({ params: studentIdParams });

function createFinanceRouter() {
  const router = express.Router();

  // requireAuth, not requirePermission: RS-FIN-002 names a real,
  // per-row actor ("L4, own class only"), which a role-only
  // requirePermission gate can't express — same "the service is the
  // gate, not requireRole" reasoning attendance.js's own router
  // comment gives for AttendanceForbiddenError.
  // financeService.markFeePayment itself verifies actorUserId is the
  // real, verified tutor of the target student's own class.
  router.post(
    '/finance/fee-payments',
    requireAuth,
    validate(markFeePaymentSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const payment = await financeService.markFeePayment(
          req.dbClient,
          { collegeId: req.collegeId, ...bodyToFields(req.body || {}, FEE_PAYMENT_BODY_FIELDS) },
          {
            actorUserId: identityService.resolveActorUserId(req.capabilities),
            actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
          },
        );
        res.status(201).json(payment);
      } catch (err) {
        if (mapFinanceServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // student_id is required — this is specifically the "this student's
  // fee status" lookup, not a general/unscoped list (there is at most
  // one fee_payments row per student now — see financeService.js's own
  // header comment). requireAuth only gates "must be logged in" — the
  // real scope (tutor/faculty-allocated teacher of the student's own
  // class, hod of their department, principal of their college) is
  // financeService/studentService's job.
  router.get(
    '/finance/fee-payments',
    requireAuth,
    validate(getFeePaymentSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { student_id: studentId } = req.query;
      if (!studentId) {
        res.status(400).json({ detail: 'student_id query parameter is required' });
        return;
      }
      try {
        const payment = await financeService.getEffectiveFeePaymentForStudent(req.dbClient, studentId, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
        });
        if (payment === null) {
          res.status(404).json({ detail: `No fee payment found for student ${JSON.stringify(studentId)}` });
          return;
        }
        res.json(payment);
      } catch (err) {
        if (mapFinanceServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // RS-FIN-003: "any later change to a fee status already marked once
  // is a correction, and L3 approves it." requireAuth, not
  // requirePermission — same reasoning as POST /finance/fee-payments
  // above; financeService.requestFeeCorrection resolves the real
  // approver itself, this route names no actor.
  router.post(
    '/finance/fee-payments/:id/corrections',
    requireAuth,
    validate(requestFeeCorrectionSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { proposed_status: proposedStatus, reason } = req.body || {};
      try {
        const result = await financeService.requestFeeCorrection(
          req.dbClient,
          req.params.id,
          { proposedStatus, reason },
          { requestedByUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.status(201).json({
          workflow_request_id: result.workflowRequest.id,
          correction_id: result.correction.id,
          proposed_status: result.correction.proposed_status,
        });
      } catch (err) {
        if (mapFinanceServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/finance/fee-payments/:id/corrections',
    requireAuth,
    validate(listFeeCorrectionsSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const corrections = await financeService.listFeeCorrectionsForPayment(req.dbClient, req.params.id);
      res.json(corrections);
    }),
  );

  // requireAuth, not requirePermission: the real gate is
  // workflowService's own step-matching + self-approval checks inside
  // approveFeeCorrection/rejectFeeCorrection, same "the service is the
  // gate" reasoning every other correction-approval route in this
  // codebase uses (attendance.js's POST /attendance/corrections/:id/approve).
  router.post(
    '/finance/fee-corrections/:correctionId/approve',
    requireAuth,
    validate(approveFeeCorrectionSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const correction = await financeService.approveFeeCorrection(req.dbClient, req.params.correctionId, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
        });
        res.json(correction);
      } catch (err) {
        if (mapFinanceServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/finance/fee-corrections/:correctionId/reject',
    requireAuth,
    validate(rejectFeeCorrectionSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const correction = await financeService.rejectFeeCorrection(req.dbClient, req.params.correctionId, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
        });
        res.json(correction);
      } catch (err) {
        if (mapFinanceServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // BusinessRules.md Finance: scholarship eligibility from a student's
  // annual_income against this tenant's configured threshold.
  // requireAuth — the real scope (same tutor/faculty-allocated
  // teacher/hod/principal boundary as every other student-data read)
  // is enforced inside checkScholarshipEligibility via studentService,
  // not this route. Advisory only — see financeService.
  // checkScholarshipEligibility's own comment. Never the eligibility
  // outcome; recordScholarshipDecision below is.
  router.get(
    '/finance/students/:id/scholarship-eligibility',
    requireAuth,
    validate(scholarshipEligibilitySchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const result = await financeService.checkScholarshipEligibility(req.dbClient, req.collegeId, req.params.id, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
        });
        res.json(result);
      } catch (err) {
        if (mapFinanceServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // requireAuth, not requirePermission: BusinessRules.md names the
  // Class Tutor as the actor — financeService.recordScholarshipDecision's
  // own tutor_user_id check (ScholarshipDecisionNotTutorError) is the
  // real gate, same "the service is the gate" reasoning every other
  // Tutor-scoped action in this codebase uses.
  router.post(
    '/finance/students/:id/scholarship-decisions',
    requireAuth,
    validate(recordScholarshipDecisionSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const {
        scheme_name: schemeName,
        eligible,
        reason,
        supporting_document_id: supportingDocumentId,
      } = req.body || {};
      try {
        const decision = await financeService.recordScholarshipDecision(
          req.dbClient,
          req.params.id,
          { schemeName, eligible, reason, supportingDocumentId },
          {
            actorUserId: identityService.resolveActorUserId(req.capabilities),
            actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
          },
        );
        res.status(201).json(decision);
      } catch (err) {
        if (mapFinanceServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/finance/students/:id/scholarship-decisions',
    requireAuth,
    validate(listScholarshipDecisionsSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const decisions = await financeService.listScholarshipDecisionsForStudent(req.dbClient, req.params.id);
      res.json(decisions);
    }),
  );

  return router;
}

module.exports = createFinanceRouter;
module.exports.schemas = {
  '/finance/fee-payments': { post: markFeePaymentSchema, get: getFeePaymentSchema },
  '/finance/fee-payments/{id}/corrections': { post: requestFeeCorrectionSchema, get: listFeeCorrectionsSchema },
  '/finance/fee-corrections/{correctionId}/approve': { post: approveFeeCorrectionSchema },
  '/finance/fee-corrections/{correctionId}/reject': { post: rejectFeeCorrectionSchema },
  '/finance/students/{id}/scholarship-eligibility': { get: scholarshipEligibilitySchema },
  '/finance/students/{id}/scholarship-decisions': {
    post: recordScholarshipDecisionSchema,
    get: listScholarshipDecisionsSchema,
  },
};
