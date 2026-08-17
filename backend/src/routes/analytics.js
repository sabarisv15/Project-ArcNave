'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission } = require('../middleware/rbac');
const analyticsService = require('../services/analyticsService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function createAnalyticsRouter() {
  const router = express.Router();

  // requirePermission('analytics.attendance_rate.read') —
  // permissions.js maps this to ['principal', 'hod', 'staff']. Widened
  // 2026-07-26 (UAT discovery, Class Tutor dashboard) to add 'staff',
  // scoped through analyticsService.getAttendanceRateForActor — the
  // same actor-scoped resolver the AI tool (attendance_summary) already
  // used — never a caller-supplied class_id (scope is derived, not
  // supplied, same as every AI tool's own convention).
  //
  // Branches on req.capabilities.effectiveRole (the RESOLVED role —
  // req.jwtClaims.role is only ever the JWT's own stale claim, e.g. an
  // Acting HOD's JWT still says 'staff'; using that raw claim here
  // would wrongly route a real HOD through the narrow staff-only scope
  // — see capability-resolver-integration.test.js's own "Acting HOD
  // still resolves as hod even though the JWT claim says staff" case).
  // principal/hod (by resolved role) keep the exact prior behavior
  // unchanged (unscoped, class_id/date filters honored) — only a
  // genuinely resolved 'staff' takes the new scoped path.
  router.get('/analytics/attendance-rate', requirePermission('analytics.attendance_rate.read'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { class_id: classId, start_date: startDate, end_date: endDate } = req.query;
    if (req.capabilities.effectiveRole === 'staff') {
      const rows = await analyticsService.getAttendanceRateForActor(
        req.dbClient,
        { actorUserId: identityService.resolveActorUserId(req.capabilities), actorRole: req.capabilities.effectiveRole, collegeId: req.collegeId },
        { startDate, endDate },
      );
      res.json(rows);
      return;
    }
    const rows = await analyticsService.getAttendanceRateByClass(req.dbClient, { classId, startDate, endDate });
    res.json(rows);
  }));

  return router;
}

module.exports = createAnalyticsRouter;
