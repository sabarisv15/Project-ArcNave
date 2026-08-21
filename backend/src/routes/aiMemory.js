'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/rbac');
const aiMemoryService = require('../services/aiMemoryService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function mapAiMemoryServiceError(err, res) {
  if (err instanceof aiMemoryService.AiMemoryValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  return false;
}

// requireAuth only, always scoped to the caller's own account — same
// ownership-only shape as routes/userPreferences.js and routes/personal-notes.js.
// This is the ONLY place consent may be set (aiMemoryService.js's own file
// comment) — a human, hitting this route directly, never an AI tool call.
function createAiMemoryRouter() {
  const router = express.Router();

  router.get('/ai/memory/consent', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const consent = await aiMemoryService.getConsent(req.dbClient, { actorUserId: identityService.resolveActorUserId(req.capabilities) });
    res.json(consent);
  }));

  router.put('/ai/memory/consent', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const consent = await aiMemoryService.setConsent(
        req.dbClient,
        (req.body || {}).consented,
        { actorUserId: identityService.resolveActorUserId(req.capabilities), collegeId: req.collegeId },
      );
      res.json(consent);
    } catch (err) {
      if (mapAiMemoryServiceError(err, res)) return;
      throw err;
    }
  }));

  router.get('/ai/memory', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const memories = await aiMemoryService.recallPreferences(req.dbClient, { actorUserId: identityService.resolveActorUserId(req.capabilities) });
    res.json(memories);
  }));

  router.delete('/ai/memory/:memoryType', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      await aiMemoryService.forgetPreference(
        req.dbClient,
        req.params.memoryType,
        { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.status(204).end();
    } catch (err) {
      if (mapAiMemoryServiceError(err, res)) return;
      throw err;
    }
  }));

  return router;
}

module.exports = createAiMemoryRouter;
