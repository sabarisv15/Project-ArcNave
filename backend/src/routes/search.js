'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/rbac');
const identityService = require('../services/identityService');
const searchService = require('../services/searchService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// requireAuth only, no dedicated permission — searchService itself
// calls the same scoped Business Services every role-gated roster
// page/route already calls (studentService.listStudents,
// staffService.listStaffForActor, academicService.listClasses), so
// per-entity RBAC/scope is inherited from those, not re-decided here.
const searchSchema = z.object({
  query: z.object({ q: z.string().optional() }).optional(),
});

function createSearchRouter() {
  const router = express.Router();

  router.get(
    '/search',
    requireAuth,
    validate(searchSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const results = await searchService.searchAll(req.dbClient, {
        query: req.query.q,
        actorUserId: identityService.resolveActorUserId(req.capabilities),
        actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
        collegeId: req.collegeId,
      });
      res.json(results);
    }),
  );

  return router;
}

module.exports = createSearchRouter;
module.exports.schemas = {
  '/search': { get: searchSchema },
};
