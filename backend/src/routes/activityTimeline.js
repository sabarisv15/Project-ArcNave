'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/rbac');
const activityTimelineService = require('../services/activityTimelineService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// requireAuth only — self-only by construction, see
// activityTimelineService's own comment for why no userId is ever
// accepted from the request.
function createActivityTimelineRouter() {
  const router = express.Router();

  router.get('/activity-timeline', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { limit: rawLimit, offset: rawOffset } = req.query;
    const entries = await activityTimelineService.getOwnActivity(req.dbClient, {
      actorUserId: identityService.resolveActorUserId(req.capabilities),
      limit: rawLimit === undefined ? undefined : Number(rawLimit),
      offset: rawOffset === undefined ? undefined : Number(rawOffset),
    });
    res.json(entries);
  }));

  return router;
}

module.exports = createActivityTimelineRouter;
