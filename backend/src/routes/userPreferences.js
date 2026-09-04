'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/rbac');
const userPreferenceService = require('../services/userPreferenceService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function mapUserPreferenceServiceError(err, res) {
  if (err instanceof userPreferenceService.UserPreferenceValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  return false;
}

// requireAuth only, always scoped to identityService.resolveActorUserId(req.capabilities) — same
// "no role rule, only ownership" shape as personal-notes.js. Generic by
// design: the frontend decides what preference_key values exist
// (dashboard layout, saved filters, notification channels, ...), this
// route just stores/returns whatever key/value it's given.
const preferenceKeyParams = z.object({ key: z.string() });
const getPreferenceSchema = z.object({ params: preferenceKeyParams });
const setPreferenceSchema = z.object({
  params: preferenceKeyParams,
  body: z.object({ value: z.any().optional() }).optional(),
});
const deletePreferenceSchema = z.object({ params: preferenceKeyParams });

function createUserPreferencesRouter() {
  const router = express.Router();

  router.get(
    '/preferences',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const preferences = await userPreferenceService.listPreferences(req.dbClient, {
        actorUserId: identityService.resolveActorUserId(req.capabilities),
      });
      res.json(preferences);
    }),
  );

  router.get(
    '/preferences/:key',
    requireAuth,
    validate(getPreferenceSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const preference = await userPreferenceService.getPreference(req.dbClient, req.params.key, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
        });
        res.json(preference);
      } catch (err) {
        if (mapUserPreferenceServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.put(
    '/preferences/:key',
    requireAuth,
    validate(setPreferenceSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const preference = await userPreferenceService.setPreference(
          req.dbClient,
          req.params.key,
          (req.body || {}).value,
          { actorUserId: identityService.resolveActorUserId(req.capabilities), collegeId: req.collegeId },
        );
        res.json(preference);
      } catch (err) {
        if (mapUserPreferenceServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.delete(
    '/preferences/:key',
    requireAuth,
    validate(deletePreferenceSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        await userPreferenceService.deletePreference(req.dbClient, req.params.key, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
        });
        res.status(204).end();
      } catch (err) {
        if (mapUserPreferenceServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  return router;
}

module.exports = createUserPreferencesRouter;
module.exports.schemas = {
  '/preferences/{key}': { get: getPreferenceSchema, put: setPreferenceSchema, delete: deletePreferenceSchema },
};
