'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission } = require('../middleware/rbac');
const collegeProfileService = require('../services/collegeProfileService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// principal only, both read and write. Was college_admin-only under
// the earlier College Admin design; BusinessRules.md's College Admin
// — final model made College Admin an ARCNAVE support employee with
// no seat in any tenant's users table, so college profile maintenance
// (an in-tenant, ongoing operational duty) now belongs to Principal
// instead. No requireAuth-for-reads/requireRole-for-writes split like
// finance.js/staff.js's placeholder: this whole resource is
// principal's, full stop.
// name/level1_position_title/level3_position_title (Stage 8a / D13 /
// RS-GOV-013): moved here from the platform-admin frontend — see
// collegeProfileRepository.js's own comment for the matching
// column-level GRANT this now depends on.
const COLLEGE_PROFILE_BODY_FIELDS = [
  ['name', 'name'],
  ['level1_position_title', 'level1PositionTitle'],
  ['level3_position_title', 'level3PositionTitle'],
  ['level4_position_title', 'level4PositionTitle'],
  ['affiliating_university', 'affiliatingUniversity'],
  ['year_established', 'yearEstablished'],
  ['address', 'address'],
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

function createCollegeProfileRouter() {
  const router = express.Router();

  router.get('/college-profile', requirePermission('college_profile.read'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const profile = await collegeProfileService.getProfile(req.dbClient, req.collegeId);
    if (profile === null) {
      res.status(404).json({ detail: `No college found with college_id ${JSON.stringify(req.collegeId)}` });
      return;
    }
    res.json(profile);
  }));

  router.put('/college-profile', requirePermission('college_profile.update'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    let profile;
    try {
      profile = await collegeProfileService.updateProfile(
        req.dbClient,
        req.collegeId,
        bodyToFields(req.body || {}, COLLEGE_PROFILE_BODY_FIELDS),
        { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
    } catch (err) {
      if (err instanceof collegeProfileService.CollegeProfileValidationError) {
        res.status(400).json({ detail: err.message });
        return;
      }
      throw err;
    }
    if (profile === null) {
      res.status(404).json({ detail: `No college found with college_id ${JSON.stringify(req.collegeId)}` });
      return;
    }
    res.json(profile);
  }));

  return router;
}

module.exports = createCollegeProfileRouter;
