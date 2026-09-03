'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const assessmentService = require('../services/assessmentService');
const workflowService = require('../services/workflowService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function mapAssessmentServiceError(err, res) {
  if (
    err instanceof assessmentService.AssessmentTypeValidationError ||
    err instanceof assessmentService.AssessmentMarkValidationError
  ) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.AssessmentTypeNameConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.AssessmentTypeNotAuthorizedError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.AssessmentMarkClassNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.AssessmentMarkNotAssignedFacultyError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.AssessmentMarkAlreadyRecordedError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.MarkCorrectionValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.MarkCorrectionNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.MarkCorrectionNoPendingRequestError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.MarkCorrectionInvalidEscalationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.MarkCorrectionNotAuthorizedError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.MarkCorrectionWrongBatchStateError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.AssessmentSubmissionValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.AssessmentSubmissionNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.AssessmentSubmissionInvalidTransitionError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.AssessmentBatchNotEditableError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.MarkReevaluationValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.MarkReevaluationNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.MarkReevaluationNotSubmittedError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.MarkReevaluationNoPendingRequestError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowService.WorkflowRequestConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowService.WorkflowRequestValidationError) {
    res.status(400).json({ detail: err.message });
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
  return false;
}

// P3 4.9 — contract schemas, same permissive discipline the other 7
// route files' own schema blocks established: never re-assert a
// requiredness check the service already owns and returns its OWN
// specific message for (e.g. `createAssessmentType`'s "collegeId and
// name are required", `recordMark`'s multi-field requiredness
// message, `updateMark`/`requestMarkCorrection`/
// `requestMarkReevaluation`'s own "marksObtained"/
// "proposedMarksObtained is required") — those fields stay untyped
// (`z.any()`) here. One genuine gap this file DOES have that the
// presence-only checks above don't cover: `assessment_types.max_marks`/
// `assessment_marks.marks_obtained` are NUMERIC columns with no
// type check anywhere in assessmentService — a non-numeric
// `max_marks`/`marks_obtained`/`proposed_marks_obtained` passes every
// existing check and then fails as a raw, unhandled Postgres
// "invalid input syntax for type numeric" 500. Typed as `z.number()`
// here — the actual fix, same class of gap as classes.js's
// `requirements` array fix. `:id`/`:correctionId`/`:reevaluationId`
// path params stay `z.string()` (no format assertion), same reasoning
// as every other file.
const assessmentTypeIdParams = z.object({ id: z.string() });
const classIdParams = z.object({ id: z.string() });
const correctionIdParams = z.object({ correctionId: z.string() });
const reevaluationIdParams = z.object({ reevaluationId: z.string() });

const createAssessmentTypeSchema = z.object({
  body: z.object({ name: z.any().optional(), max_marks: z.number().optional() }).optional(),
});
const listAssessmentTypesSchema = z.object({
  query: z.object({ limit: z.string().optional(), offset: z.string().optional() }).optional(),
});
const updateAssessmentTypeSchema = z.object({
  params: assessmentTypeIdParams,
  body: z.object({ name: z.any().optional(), max_marks: z.number().optional() }).optional(),
});
const recordMarkSchema = z.object({
  params: classIdParams,
  body: z
    .object({
      academic_year: z.any().optional(),
      subject: z.any().optional(),
      assessment_type_id: z.any().optional(),
      student_id: z.any().optional(),
      marks_obtained: z.number().optional(),
    })
    .optional(),
});
const updateMarkSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({ marks_obtained: z.number().optional() }).optional(),
});
const lockAssessmentSubmissionSchema = z.object({
  params: classIdParams,
  body: z
    .object({ academic_year: z.any().optional(), subject: z.any().optional(), assessment_type_id: z.any().optional() })
    .optional(),
});
const unlockAssessmentSubmissionSchema = lockAssessmentSubmissionSchema;
const submitAssessmentSubmissionSchema = lockAssessmentSubmissionSchema;
const assessmentSubmissionStatusSchema = z.object({
  params: classIdParams,
  query: z
    .object({ academic_year: z.string().optional(), subject: z.string().optional(), assessment_type_id: z.string().optional() })
    .optional(),
});
const listMarksForFiltersSchema = z.object({
  query: z
    .object({
      academic_year: z.string().optional(),
      department_id: z.string().optional(),
      class_id: z.string().optional(),
      subject: z.string().optional(),
      assessment_type_id: z.string().optional(),
    })
    .optional(),
});
const effectiveMarkSchema = z.object({ params: z.object({ id: z.string() }) });
const requestMarkCorrectionSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({ proposed_marks_obtained: z.number().optional(), reason: z.any().optional() }).optional(),
});
const listMarkCorrectionsSchema = z.object({ params: z.object({ id: z.string() }) });
const approveMarkCorrectionSchema = z.object({ params: correctionIdParams });
const rejectMarkCorrectionSchema = z.object({ params: correctionIdParams });
const escalateMarkCorrectionSchema = z.object({
  params: correctionIdParams,
  body: z.object({ escalate_to_role: z.any().optional(), remarks: z.any().optional() }).optional(),
});
const requestMarkReevaluationSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({ proposed_marks_obtained: z.number().optional(), reason: z.any().optional() }).optional(),
});
const listMarkReevaluationsSchema = z.object({ params: z.object({ id: z.string() }) });
const approveMarkReevaluationSchema = z.object({ params: reevaluationIdParams });
const rejectMarkReevaluationSchema = z.object({ params: reevaluationIdParams });
const removeMarkSchema = z.object({ params: z.object({ id: z.string() }) });

function createAssessmentsRouter() {
  const router = express.Router();

  // BusinessRules.md Assessment marks: "assessment types are
  // institution-wide, configurable, editable by authorized
  // administrators" — requirePermission mapped to ['principal'], same
  // conservative default other institution-configuration actions in
  // this codebase use (nothing names a narrower authorized-administrator
  // role than Principal).
  router.post(
    '/assessment-types',
    requirePermission('assessment_types.create'),
    validate(createAssessmentTypeSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { name, max_marks: maxMarks } = req.body || {};
      try {
        const assessmentType = await assessmentService.createAssessmentType(
          req.dbClient,
          { collegeId: req.collegeId, name, maxMarks },
          {
            actorUserId: identityService.resolveActorUserId(req.capabilities),
            actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
          },
        );
        res.status(201).json(assessmentType);
      } catch (err) {
        if (mapAssessmentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/assessment-types',
    requireAuth,
    validate(listAssessmentTypesSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { limit: rawLimit, offset: rawOffset } = req.query;
      const assessmentTypes = await assessmentService.listAssessmentTypes(req.dbClient, {
        limit: rawLimit === undefined ? undefined : Number(rawLimit),
        offset: rawOffset === undefined ? undefined : Number(rawOffset),
      });
      res.json(assessmentTypes);
    }),
  );

  router.put(
    '/assessment-types/:id',
    requirePermission('assessment_types.update'),
    validate(updateAssessmentTypeSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { name, max_marks: maxMarks } = req.body || {};
      try {
        const assessmentType = await assessmentService.updateAssessmentType(
          req.dbClient,
          req.params.id,
          { name, maxMarks },
          {
            actorUserId: identityService.resolveActorUserId(req.capabilities),
            actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
          },
        );
        if (assessmentType === null) {
          res.status(404).json({ detail: `No assessment type found with id ${JSON.stringify(req.params.id)}` });
          return;
        }
        res.json(assessmentType);
      } catch (err) {
        if (mapAssessmentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // requireAuth, not requirePermission: BusinessRules.md names the
  // assigned Subject Faculty as the actor —
  // assessmentService.recordMark's own faculty_allocation check
  // (AssessmentMarkNotAssignedFacultyError) is the real gate, same
  // "the service is the gate" reasoning every other assigned-Faculty
  // action in this codebase uses.
  router.post(
    '/classes/:id/assessment-marks',
    requireAuth,
    validate(recordMarkSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const {
        academic_year: academicYear,
        subject,
        assessment_type_id: assessmentTypeId,
        student_id: studentId,
        marks_obtained: marksObtained,
      } = req.body || {};
      try {
        const mark = await assessmentService.recordMark(
          req.dbClient,
          {
            academicYear,
            classId: req.params.id,
            subject,
            assessmentTypeId,
            studentId,
            marksObtained,
          },
          { actorUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.status(201).json(mark);
      } catch (err) {
        if (mapAssessmentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // requireAuth, not requirePermission: same "service is the gate"
  // reasoning as the record route above — updateMark's own
  // faculty-assignment + batch-draft checks are the real gate.
  router.put(
    '/assessment-marks/:id',
    requireAuth,
    validate(updateMarkSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { marks_obtained: marksObtained } = req.body || {};
      try {
        const mark = await assessmentService.updateMark(
          req.dbClient,
          req.params.id,
          { marksObtained },
          { actorUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        if (mark === null) {
          res.status(404).json({ detail: `No assessment mark found with id ${JSON.stringify(req.params.id)}` });
          return;
        }
        res.json(mark);
      } catch (err) {
        if (mapAssessmentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // Lock/submit workflow — one batch per (academic_year, class_id,
  // subject, assessment_type_id), all body-scoped since a class may run
  // several subjects/assessment types at once.
  router.post(
    '/classes/:id/assessment-submissions/lock',
    requireAuth,
    validate(lockAssessmentSubmissionSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { academic_year: academicYear, subject, assessment_type_id: assessmentTypeId } = req.body || {};
      try {
        const batch = await assessmentService.lockAssessmentSubmission(
          req.dbClient,
          { academicYear, classId: req.params.id, subject, assessmentTypeId },
          { actorUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.json(batch);
      } catch (err) {
        if (mapAssessmentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/classes/:id/assessment-submissions/unlock',
    requireAuth,
    validate(unlockAssessmentSubmissionSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { academic_year: academicYear, subject, assessment_type_id: assessmentTypeId } = req.body || {};
      try {
        const batch = await assessmentService.unlockAssessmentSubmission(
          req.dbClient,
          { academicYear, classId: req.params.id, subject, assessmentTypeId },
          { actorUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.json(batch);
      } catch (err) {
        if (mapAssessmentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/classes/:id/assessment-submissions/submit',
    requireAuth,
    validate(submitAssessmentSubmissionSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { academic_year: academicYear, subject, assessment_type_id: assessmentTypeId } = req.body || {};
      try {
        const batch = await assessmentService.submitAssessmentSubmission(
          req.dbClient,
          { academicYear, classId: req.params.id, subject, assessmentTypeId },
          { actorUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.json(batch);
      } catch (err) {
        if (mapAssessmentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/classes/:id/assessment-submissions/status',
    requireAuth,
    validate(assessmentSubmissionStatusSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { academic_year: academicYear, subject, assessment_type_id: assessmentTypeId } = req.query;
      const batch = await assessmentService.getAssessmentSubmissionStatus(req.dbClient, {
        academicYear,
        classId: req.params.id,
        subject,
        assessmentTypeId,
      });
      res.json(batch);
    }),
  );

  // BusinessRules.md's own filter set: Academic Year, Department,
  // Class, Subject, Assessment — all optional, all combinable.
  router.get(
    '/assessment-marks',
    requireAuth,
    validate(listMarksForFiltersSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const {
        academic_year: academicYear,
        department_id: departmentId,
        class_id: classId,
        subject,
        assessment_type_id: assessmentTypeId,
      } = req.query;
      const marks = await assessmentService.listMarksForFilters(req.dbClient, {
        academicYear,
        departmentId,
        classId,
        subject,
        assessmentTypeId,
      });
      res.json(marks);
    }),
  );

  router.get(
    '/assessment-marks/:id/effective',
    requireAuth,
    validate(effectiveMarkSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const mark = await assessmentService.getEffectiveMark(req.dbClient, req.params.id);
      if (mark === null) {
        res.status(404).json({ detail: `No assessment mark found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.json(mark);
    }),
  );

  // requireAuth, not requirePermission: RS-ASM-003 names the actor
  // ("Subject Faculty submits a correction") — same "service is the
  // gate" reasoning routes/attendance.js's own corrections routes
  // already use. The approval step (class tutor only, via
  // workflowService's own step-matching) is the real gate on the
  // outcome.
  router.post(
    '/assessment-marks/:id/corrections',
    requireAuth,
    validate(requestMarkCorrectionSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { proposed_marks_obtained: proposedMarksObtained, reason } = req.body || {};
      try {
        const result = await assessmentService.requestMarkCorrection(
          req.dbClient,
          req.params.id,
          { proposedMarksObtained, reason },
          { requestedByUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.status(201).json(result);
      } catch (err) {
        if (mapAssessmentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/assessment-marks/:id/corrections',
    requireAuth,
    validate(listMarkCorrectionsSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const corrections = await assessmentService.listMarkCorrectionsForMark(req.dbClient, req.params.id);
      res.json(corrections);
    }),
  );

  router.post(
    '/assessment-marks/corrections/:correctionId/approve',
    requireAuth,
    validate(approveMarkCorrectionSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const correction = await assessmentService.approveMarkCorrection(req.dbClient, req.params.correctionId, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
        });
        res.json(correction);
      } catch (err) {
        if (mapAssessmentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/assessment-marks/corrections/:correctionId/reject',
    requireAuth,
    validate(rejectMarkCorrectionSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const correction = await assessmentService.rejectMarkCorrection(req.dbClient, req.params.correctionId, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
        });
        res.json(correction);
      } catch (err) {
        if (mapAssessmentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/assessment-marks/corrections/:correctionId/escalate',
    requireAuth,
    validate(escalateMarkCorrectionSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { escalate_to_role: escalateToRole, remarks } = req.body || {};
      try {
        const correction = await assessmentService.escalateMarkCorrection(req.dbClient, req.params.correctionId, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
          escalateToRole,
          remarks,
        });
        res.json(correction);
      } catch (err) {
        if (mapAssessmentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // RS-ASM-003 extension: same "service is the gate" reasoning as the
  // corrections routes — requestMarkReevaluation's own
  // batch-must-be-submitted check is the real gate, and the approval
  // step (HOD, via workflowService's own step-matching) is the real
  // gate on the outcome.
  router.post(
    '/assessment-marks/:id/reevaluations',
    requireAuth,
    validate(requestMarkReevaluationSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { proposed_marks_obtained: proposedMarksObtained, reason } = req.body || {};
      try {
        const result = await assessmentService.requestMarkReevaluation(
          req.dbClient,
          req.params.id,
          { proposedMarksObtained, reason },
          { requestedByUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.status(201).json(result);
      } catch (err) {
        if (mapAssessmentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/assessment-marks/:id/reevaluations',
    requireAuth,
    validate(listMarkReevaluationsSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const reevaluations = await assessmentService.listMarkReevaluationsForMark(req.dbClient, req.params.id);
      res.json(reevaluations);
    }),
  );

  router.post(
    '/assessment-marks/reevaluations/:reevaluationId/approve',
    requireAuth,
    validate(approveMarkReevaluationSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const reevaluation = await assessmentService.approveMarkReevaluation(req.dbClient, req.params.reevaluationId, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
        });
        res.json(reevaluation);
      } catch (err) {
        if (mapAssessmentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/assessment-marks/reevaluations/:reevaluationId/reject',
    requireAuth,
    validate(rejectMarkReevaluationSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const reevaluation = await assessmentService.rejectMarkReevaluation(req.dbClient, req.params.reevaluationId, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
        });
        res.json(reevaluation);
      } catch (err) {
        if (mapAssessmentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.delete(
    '/assessment-marks/:id',
    requireAuth,
    validate(removeMarkSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const mark = await assessmentService.removeMark(req.dbClient, req.params.id, {
        actorUserId: identityService.resolveActorUserId(req.capabilities),
      });
      if (mark === null) {
        res.status(404).json({ detail: `No assessment mark found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.status(204).end();
    }),
  );

  return router;
}

module.exports = createAssessmentsRouter;
// P3 4.9 — same "attached to the factory function" convention as
// routes/auth.js's own `.schemas`, read by routes/openapi.js.
module.exports.schemas = {
  '/assessment-types': { post: createAssessmentTypeSchema, get: listAssessmentTypesSchema },
  '/assessment-types/{id}': { put: updateAssessmentTypeSchema },
  '/classes/{id}/assessment-marks': { post: recordMarkSchema },
  '/assessment-marks/{id}': { put: updateMarkSchema, delete: removeMarkSchema },
  '/classes/{id}/assessment-submissions/lock': { post: lockAssessmentSubmissionSchema },
  '/classes/{id}/assessment-submissions/unlock': { post: unlockAssessmentSubmissionSchema },
  '/classes/{id}/assessment-submissions/submit': { post: submitAssessmentSubmissionSchema },
  '/classes/{id}/assessment-submissions/status': { get: assessmentSubmissionStatusSchema },
  '/assessment-marks': { get: listMarksForFiltersSchema },
  '/assessment-marks/{id}/effective': { get: effectiveMarkSchema },
  '/assessment-marks/{id}/corrections': { post: requestMarkCorrectionSchema, get: listMarkCorrectionsSchema },
  '/assessment-marks/corrections/{correctionId}/approve': { post: approveMarkCorrectionSchema },
  '/assessment-marks/corrections/{correctionId}/reject': { post: rejectMarkCorrectionSchema },
  '/assessment-marks/corrections/{correctionId}/escalate': { post: escalateMarkCorrectionSchema },
  '/assessment-marks/{id}/reevaluations': { post: requestMarkReevaluationSchema, get: listMarkReevaluationsSchema },
  '/assessment-marks/reevaluations/{reevaluationId}/approve': { post: approveMarkReevaluationSchema },
  '/assessment-marks/reevaluations/{reevaluationId}/reject': { post: rejectMarkReevaluationSchema },
};
