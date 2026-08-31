'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const curriculumService = require('../services/curriculumService');
const workflowService = require('../services/workflowService');
const staffService = require('../services/staffService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

const REGULATION_BODY_FIELDS = [
  ['name', 'name'],
  ['description', 'description'],
];
const SUBJECT_BODY_FIELDS = [
  ['subject_code', 'subjectCode'],
  ['subject_name', 'subjectName'],
  ['semester', 'semester'],
  ['credits', 'credits'],
  ['lecture_hours', 'lectureHours'],
  ['tutorial_hours', 'tutorialHours'],
  ['practical_hours', 'practicalHours'],
  ['subject_type', 'subjectType'],
  ['prerequisites', 'prerequisites'],
  ['source_document_id', 'sourceDocumentId'],
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

function mapCurriculumServiceError(err, res) {
  if (
    err instanceof curriculumService.RegulationValidationError ||
    err instanceof curriculumService.SubjectValidationError ||
    err instanceof curriculumService.CurriculumMigrationValidationError
  ) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (
    err instanceof curriculumService.RegulationNameConflictError ||
    err instanceof curriculumService.SubjectCodeConflictError
  ) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (
    err instanceof curriculumService.SubjectRegulationNotFoundError ||
    err instanceof curriculumService.CurriculumMigrationStudentNotFoundError ||
    err instanceof curriculumService.CurriculumMigrationRegulationNotFoundError
  ) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof curriculumService.CurriculumMigrationNoPendingRequestError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffPrincipalNotFoundError) {
    res.status(404).json({ detail: err.message });
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
  return false;
}

function createCurriculumRouter() {
  const router = express.Router();

  router.post(
    '/regulations',
    requirePermission('regulations.create'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const regulation = await curriculumService.createRegulation(
          req.dbClient,
          { collegeId: req.collegeId, ...bodyToFields(req.body || {}, REGULATION_BODY_FIELDS) },
          { actorUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.status(201).json(regulation);
      } catch (err) {
        if (mapCurriculumServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/regulations',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { limit: rawLimit, offset: rawOffset } = req.query;
      const regulations = await curriculumService.listRegulations(req.dbClient, {
        limit: rawLimit === undefined ? undefined : Number(rawLimit),
        offset: rawOffset === undefined ? undefined : Number(rawOffset),
      });
      res.json(regulations);
    }),
  );

  router.get(
    '/regulations/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const regulation = await curriculumService.getRegulation(req.dbClient, req.params.id);
      if (regulation === null) {
        res.status(404).json({ detail: `No regulation found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.json(regulation);
    }),
  );

  router.post(
    '/regulations/:id/subjects',
    requirePermission('subjects.create'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const subject = await curriculumService.createSubject(
          req.dbClient,
          {
            collegeId: req.collegeId,
            regulationId: req.params.id,
            ...bodyToFields(req.body || {}, SUBJECT_BODY_FIELDS),
          },
          { actorUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.status(201).json(subject);
      } catch (err) {
        if (mapCurriculumServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/regulations/:id/subjects',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const subjects = await curriculumService.listSubjectsForRegulation(req.dbClient, req.params.id);
      res.json(subjects);
    }),
  );

  router.put(
    '/subjects/:id',
    requirePermission('subjects.update'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const subject = await curriculumService.updateSubject(
          req.dbClient,
          req.params.id,
          bodyToFields(req.body || {}, SUBJECT_BODY_FIELDS),
          { userId: identityService.resolveActorUserId(req.capabilities) },
        );
        if (subject === null) {
          res.status(404).json({ detail: `No subject found with id ${JSON.stringify(req.params.id)}` });
          return;
        }
        res.json(subject);
      } catch (err) {
        if (mapCurriculumServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.delete(
    '/subjects/:id',
    requirePermission('subjects.delete'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const subject = await curriculumService.removeSubject(req.dbClient, req.params.id, {
        userId: identityService.resolveActorUserId(req.capabilities),
      });
      if (subject === null) {
        res.status(404).json({ detail: `No subject found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.status(204).end();
    }),
  );

  router.post(
    '/students/:id/curriculum-migration',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { to_regulation_id: toRegulationId } = req.body || {};
      try {
        const request = await curriculumService.requestCurriculumMigration(
          req.dbClient,
          req.params.id,
          toRegulationId,
          { requestedByUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.status(201).json(request);
      } catch (err) {
        if (mapCurriculumServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/students/:id/curriculum-migration/approve',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const student = await curriculumService.approveCurriculumMigration(req.dbClient, req.params.id, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
        });
        res.json(student);
      } catch (err) {
        if (mapCurriculumServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/students/:id/curriculum-migration/reject',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const student = await curriculumService.rejectCurriculumMigration(req.dbClient, req.params.id, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
        });
        res.json(student);
      } catch (err) {
        if (mapCurriculumServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  return router;
}

module.exports = createCurriculumRouter;
