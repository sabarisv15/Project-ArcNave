'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const academicYearService = require('../services/academicYearService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

const ACADEMIC_YEAR_BODY_FIELDS = [
  ['year_label', 'yearLabel'],
  ['start_date', 'startDate'],
  ['end_date', 'endDate'],
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

function mapAcademicYearServiceError(err, res) {
  if (err instanceof academicYearService.AcademicYearValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicYearService.AcademicYearLabelConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicYearService.AcademicYearActiveConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicYearService.AcademicYearNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicYearService.AcademicYearTransitionError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  return false;
}

// P4 route-validation pass — same permissive discipline
// students.js/attendance.js's own schema blocks established: the
// service (academicYearService) is the real validator, this layer
// only rejects a wrong-typed wire shape.
const academicYearIdParams = z.object({ id: z.string() });
const createAcademicYearSchema = z.object({
  body: z
    .object({
      year_label: z.string().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
    })
    .optional(),
});
const listAcademicYearsSchema = z.object({
  query: z.object({ limit: z.string().optional(), offset: z.string().optional() }).optional(),
});
const getAcademicYearSchema = z.object({ params: academicYearIdParams });
const activateAcademicYearSchema = z.object({ params: academicYearIdParams });
const completeAcademicYearSchema = z.object({ params: academicYearIdParams });

function createAcademicYearsRouter() {
  const router = express.Router();

  router.post(
    '/academic-years',
    requirePermission('academic_years.create'),
    validate(createAcademicYearSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const academicYear = await academicYearService.createAcademicYear(
          req.dbClient,
          { collegeId: req.collegeId, ...bodyToFields(req.body || {}, ACADEMIC_YEAR_BODY_FIELDS) },
          { actorUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.status(201).json(academicYear);
      } catch (err) {
        if (mapAcademicYearServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/academic-years',
    requireAuth,
    validate(listAcademicYearsSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { limit: rawLimit, offset: rawOffset } = req.query;
      const academicYears = await academicYearService.listAcademicYears(req.dbClient, {
        limit: rawLimit === undefined ? undefined : Number(rawLimit),
        offset: rawOffset === undefined ? undefined : Number(rawOffset),
      });
      res.json(academicYears);
    }),
  );

  router.get(
    '/academic-years/active',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const academicYear = await academicYearService.getActiveAcademicYear(req.dbClient, req.collegeId);
      if (academicYear === null) {
        res.status(404).json({ detail: 'No active academic year for this college' });
        return;
      }
      res.json(academicYear);
    }),
  );

  router.get(
    '/academic-years/:id',
    requireAuth,
    validate(getAcademicYearSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const academicYear = await academicYearService.getAcademicYear(req.dbClient, req.params.id);
      if (academicYear === null) {
        res.status(404).json({ detail: `No academic year found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.json(academicYear);
    }),
  );

  router.post(
    '/academic-years/:id/activate',
    requirePermission('academic_years.activate'),
    validate(activateAcademicYearSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const academicYear = await academicYearService.activateAcademicYear(req.dbClient, req.params.id, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
        });
        res.json(academicYear);
      } catch (err) {
        if (mapAcademicYearServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/academic-years/:id/complete',
    requirePermission('academic_years.complete'),
    validate(completeAcademicYearSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const academicYear = await academicYearService.completeAcademicYear(req.dbClient, req.params.id, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
        });
        res.json(academicYear);
      } catch (err) {
        if (mapAcademicYearServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  return router;
}

module.exports = createAcademicYearsRouter;
module.exports.schemas = {
  '/academic-years': { post: createAcademicYearSchema, get: listAcademicYearsSchema },
  '/academic-years/{id}': { get: getAcademicYearSchema },
  '/academic-years/{id}/activate': { post: activateAcademicYearSchema },
  '/academic-years/{id}/complete': { post: completeAcademicYearSchema },
};
