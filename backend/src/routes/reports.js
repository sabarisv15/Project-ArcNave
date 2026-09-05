'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/rbac');
const reportService = require('../services/reportService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function mapReportServiceError(err, res) {
  if (err instanceof reportService.ReportValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof reportService.ReportFormatError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  return false;
}

const studentExportReportSchema = z.object({
  body: z
    .object({
      format: z.string().optional(),
      columns: z.any().optional(),
      student_ids: z.any().optional(),
    })
    .optional(),
});
const attendanceReportSchema = z.object({
  body: z.object({ format: z.string().optional() }).optional(),
});
const financeReportSchema = z.object({
  body: z.object({ format: z.string().optional() }).optional(),
});
const assessmentMarksReportSchema = z.object({
  body: z
    .object({
      format: z.string().optional(),
      academic_year: z.string().optional(),
      department_id: z.string().optional(),
      class_id: z.string().optional(),
      subject: z.string().optional(),
      assessment_type_id: z.string().optional(),
    })
    .optional(),
});

function createReportsRouter() {
  const router = express.Router();

  // RBAC is the same deliberately conservative placeholder
  // students.js/staff.js/finance.js/documents.js all use, not a final
  // decision — BusinessRules.md names no specific actor for report
  // generation either. requirePermission('reports.generate') gates the only
  // endpoint this slice has.

  // 201, not 200: this always inserts a new generated_reports row
  // (reportService.generateStudentExportReport never updates one),
  // regardless of whether the row's own `status` comes back
  // 'completed' or 'failed' — a real resource was created either way,
  // same reasoning createFeeStructure's 201 uses. The response body's
  // `status` field is how a caller learns the business outcome, not
  // the HTTP status code.
  // RS-CLS-005: "any timetable-linked staff member" may export, not
  // principal-only — its own permission key, separate from
  // reports.generate's principal-only default the other three /reports/*
  // routes below keep unchanged.
  router.post(
    '/reports/student-export',
    requirePermission('reports.student_export'),
    validate(studentExportReportSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const body = req.body || {};
        const report = await reportService.generateStudentExportReport(
          req.dbClient,
          {
            collegeId: req.collegeId,
            format: body.format,
            columns: body.columns,
            studentIds: body.student_ids,
          },
          {
            actorUserId: identityService.resolveActorUserId(req.capabilities),
            actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
          },
        );
        res.status(201).json(report);
      } catch (err) {
        if (mapReportServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/reports/attendance',
    requirePermission('reports.generate'),
    validate(attendanceReportSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const report = await reportService.generateAttendanceReport(
          req.dbClient,
          { collegeId: req.collegeId, format: (req.body || {}).format },
          { actorUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.status(201).json(report);
      } catch (err) {
        if (mapReportServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/reports/finance',
    requirePermission('reports.generate'),
    validate(financeReportSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const report = await reportService.generateFinanceReport(
          req.dbClient,
          { collegeId: req.collegeId, format: (req.body || {}).format },
          { actorUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.status(201).json(report);
      } catch (err) {
        if (mapReportServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/reports/assessment-marks',
    requirePermission('reports.generate'),
    validate(assessmentMarksReportSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const body = req.body || {};
      try {
        const report = await reportService.generateAssessmentMarksReport(
          req.dbClient,
          {
            collegeId: req.collegeId,
            format: body.format,
            filters: {
              academicYear: body.academic_year,
              departmentId: body.department_id,
              classId: body.class_id,
              subject: body.subject,
              assessmentTypeId: body.assessment_type_id,
            },
          },
          { actorUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.status(201).json(report);
      } catch (err) {
        if (mapReportServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  return router;
}

module.exports = createReportsRouter;
module.exports.schemas = {
  '/reports/student-export': { post: studentExportReportSchema },
  '/reports/attendance': { post: attendanceReportSchema },
  '/reports/finance': { post: financeReportSchema },
  '/reports/assessment-marks': { post: assessmentMarksReportSchema },
};
