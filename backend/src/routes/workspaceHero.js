'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/rbac');
const identityService = require('../services/identityService');
const academicService = require('../services/academicService');
const staffService = require('../services/staffService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// The task-first workspace hero (Phase 4 blueprint / Concept A - The
// Instrument Panel's "Period 2 — Physics, Class 10B — starts in 40
// minutes."). requireAuth only, always scoped to the caller's own id
// — same "no role rule, only self" shape as personal-notes/activity-
// timeline — a principal/HOD with no teaching schedule simply gets
// null, same as a staff member with nothing left today; the frontend
// falls back to generic copy either way.
function createWorkspaceHeroRouter() {
  const router = express.Router();

  router.get('/workspace/hero', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const actorUserId = identityService.resolveActorUserId(req.capabilities);
    // First name for the hero's "Good evening, Priya" greeting (frontend
    // redesign, 2026-08-07). A Principal has no `staff` row at all
    // (staffService.findPrincipal's own comment) — that's not an error
    // here, the greeting just falls back to no name, same "self only, no
    // role rule" shape the rest of this route already follows.
    const [moment, weeklySchedule, staffName] = await Promise.all([
      academicService.resolveNextTeachingMomentForStaff(req.dbClient, req.collegeId, actorUserId),
      academicService.resolveWeeklyScheduleForStaff(req.dbClient, req.collegeId, actorUserId),
      staffService.getOwnProfile(req.dbClient, { userId: actorUserId })
        .then((profile) => profile.first_name || profile.full_name || null)
        .catch((err) => {
          if (err instanceof staffService.StaffNotFoundError) return null;
          throw err;
        }),
    ]);
    res.json({ nextTeachingMoment: moment, weeklySchedule, staffName });
  }));

  return router;
}

module.exports = createWorkspaceHeroRouter;
