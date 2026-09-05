'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/rbac');
const classLogService = require('../services/classLogService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function actorInput(req) {
  return {
    actorUserId: identityService.resolveActorUserId(req.capabilities),
    actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
    collegeId: req.collegeId,
  };
}

function mapClassLogServiceError(err, res) {
  if (err instanceof classLogService.ClassLogValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof classLogService.ClassLogNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof classLogService.ClassLogForbiddenError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  return false;
}

// requireAuth only, not requirePermission — classLogService itself is
// the gate (visibilityService.assertCanViewClass for create/read,
// creator-only ownership for edit/delete), same "the service is the
// real gate" split most write routes in this codebase already use.
const classLogIdParams = z.object({ id: z.string() });
const listClassLogsSchema = z.object({
  query: z
    .object({
      class_id: z.string().optional(),
      subject: z.string().optional(),
      from_date: z.string().optional(),
      to_date: z.string().optional(),
    })
    .optional(),
});
const createClassLogSchema = z.object({
  body: z
    .object({
      class_id: z.string().optional(),
      timetable_period_id: z.string().optional(),
      subject: z.string().optional(),
      session_date: z.string().optional(),
      topic: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
});
const updateClassLogSchema = z.object({
  params: classLogIdParams,
  body: z
    .object({
      subject: z.string().optional(),
      topic: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
});
const deleteClassLogSchema = z.object({ params: classLogIdParams });

function createClassLogsRouter() {
  const router = express.Router();

  router.get(
    '/class-logs',
    requireAuth,
    validate(listClassLogsSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { class_id: classId, subject, from_date: fromDate, to_date: toDate } = req.query;
      try {
        const entries = await classLogService.listLogEntries(
          req.dbClient,
          {
            classId,
            subject,
            fromDate,
            toDate,
          },
          actorInput(req),
        );
        res.json(entries);
      } catch (err) {
        if (mapClassLogServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/class-logs',
    requireAuth,
    validate(createClassLogSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const {
        class_id: classId,
        timetable_period_id: timetablePeriodId,
        subject,
        session_date: sessionDate,
        topic,
        notes,
      } = req.body || {};
      try {
        const entry = await classLogService.createLogEntry(
          req.dbClient,
          {
            classId,
            timetablePeriodId,
            subject,
            sessionDate,
            topic,
            notes,
          },
          actorInput(req),
        );
        res.status(201).json(entry);
      } catch (err) {
        if (mapClassLogServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.put(
    '/class-logs/:id',
    requireAuth,
    validate(updateClassLogSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { subject, topic, notes } = req.body || {};
      try {
        const entry = await classLogService.updateLogEntry(
          req.dbClient,
          req.params.id,
          { subject, topic, notes },
          actorInput(req),
        );
        res.json(entry);
      } catch (err) {
        if (mapClassLogServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.delete(
    '/class-logs/:id',
    requireAuth,
    validate(deleteClassLogSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        await classLogService.deleteLogEntry(req.dbClient, req.params.id, actorInput(req));
        res.status(204).end();
      } catch (err) {
        if (mapClassLogServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  return router;
}

module.exports = createClassLogsRouter;
module.exports.schemas = {
  '/class-logs': { get: listClassLogsSchema, post: createClassLogSchema },
  '/class-logs/{id}': { put: updateClassLogSchema, delete: deleteClassLogSchema },
};
