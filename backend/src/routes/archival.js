'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const archivalService = require('../services/archivalService');
const workflowService = require('../services/workflowService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function mapArchivalServiceError(err, res) {
  if (err instanceof archivalService.ArchivalValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof archivalService.ArchivalAlreadyArchivedError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof archivalService.ArchivalNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof archivalService.ArchivalAlreadyRestoredError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof archivalService.ArchivalNoPendingRestorationError) {
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
  return false;
}

const archivedRecordIdParams = z.object({ id: z.string() });
const createArchivedRecordSchema = z.object({
  body: z
    .object({
      entity_type: z.string().optional(),
      entity_id: z.string().optional(),
      reason: z.string().optional(),
    })
    .optional(),
});
const listArchivedRecordsSchema = z.object({
  query: z.object({ entity_type: z.string().optional() }).optional(),
});
const requestRestorationSchema = z.object({
  params: archivedRecordIdParams,
  body: z.object({ reason: z.string().optional() }).optional(),
});
const approveRestorationSchema = z.object({ params: archivedRecordIdParams });
const rejectRestorationSchema = z.object({ params: archivedRecordIdParams });

function createArchivalRouter() {
  const router = express.Router();

  // BusinessRules.md Data retention and archival names no specific
  // actor for archiving itself ("according to the institution's data
  // retention policy") — requirePermission mapped to ['principal'],
  // same conservative default other institution-configuration/
  // compliance actions in this codebase use.
  router.post(
    '/archived-records',
    requirePermission('archived_records.create'),
    validate(createArchivedRecordSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { entity_type: entityType, entity_id: entityId, reason } = req.body || {};
      try {
        const record = await archivalService.archiveRecord(
          req.dbClient,
          { entityType, entityId, reason },
          { actorUserId: identityService.resolveActorUserId(req.capabilities), collegeId: req.collegeId },
        );
        res.status(201).json(record);
      } catch (err) {
        if (mapArchivalServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/archived-records',
    requireAuth,
    validate(listArchivedRecordsSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const records = await archivalService.listArchivedRecords(req.dbClient, req.collegeId, {
        entityType: req.query.entity_type,
      });
      res.json(records);
    }),
  );

  router.post(
    '/archived-records/:id/request-restoration',
    requireAuth,
    validate(requestRestorationSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const result = await archivalService.requestRestoration(
          req.dbClient,
          req.params.id,
          { reason: (req.body || {}).reason },
          { requestedByUserId: identityService.resolveActorUserId(req.capabilities), collegeId: req.collegeId },
        );
        res.status(201).json(result);
      } catch (err) {
        if (mapArchivalServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/archived-records/:id/approve-restoration',
    requireAuth,
    validate(approveRestorationSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const record = await archivalService.approveRestoration(req.dbClient, req.params.id, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
        });
        res.json(record);
      } catch (err) {
        if (mapArchivalServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/archived-records/:id/reject-restoration',
    requireAuth,
    validate(rejectRestorationSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const record = await archivalService.rejectRestoration(req.dbClient, req.params.id, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
        });
        res.json(record);
      } catch (err) {
        if (mapArchivalServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  return router;
}

module.exports = createArchivalRouter;
module.exports.schemas = {
  '/archived-records': { post: createArchivedRecordSchema, get: listArchivedRecordsSchema },
  '/archived-records/{id}/request-restoration': { post: requestRestorationSchema },
  '/archived-records/{id}/approve-restoration': { post: approveRestorationSchema },
  '/archived-records/{id}/reject-restoration': { post: rejectRestorationSchema },
};
