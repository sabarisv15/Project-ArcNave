'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const academicService = require('../services/academicService');
const visibilityService = require('../services/visibilityService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// snake_case <-> camelCase translation lives here, not in a shared
// util, same reasoning as classes.js's CLASS_BODY_FIELDS. college_id
// is deliberately absent (always req.collegeId, never the request
// body).
const ALLOCATION_BODY_FIELDS = [
  ['class_id', 'classId'],
  ['period_id', 'periodId'],
  ['subject', 'subject'],
  ['staff_user_id', 'staffUserId'],
];

function bodyToServiceFields(body) {
  const fields = {};
  for (const [snakeKey, camelKey] of ALLOCATION_BODY_FIELDS) {
    if (body[snakeKey] !== undefined) {
      fields[camelKey] = body[snakeKey];
    }
  }
  return fields;
}

// Response bodies are NOT translated back to camelCase — same choice
// classes.js/staff.js/students.js all made.

function mapAcademicServiceError(err, res) {
  if (err instanceof academicService.FacultyAllocationValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.FacultyAllocationPeriodTakenError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.FacultyAllocationStaffConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.FacultyAllocationClassNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.FacultyAllocationPeriodNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.FacultyAllocationStaffNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof visibilityService.VisibilityForbiddenError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  return false;
}

// Shared read-scope gate for both GET routes below (this session's own
// task): visible if the actor may view the allocation's class
// (tutor/faculty-allocated staff, hod of its department, principal of
// the college) OR may view the allocated staff member themselves (self,
// or hod/principal — visibilityService.assertCanViewStaff's own rule).
// Either is sufficient — "staff sees own allocations" and "tutor/
// allocated faculty see relevant class" are two separate named rules,
// not a conjunction.
async function assertCanViewAllocation(client, allocation, actor) {
  try {
    await visibilityService.assertCanViewClass(client, allocation.class_id, actor);
    return;
  } catch (err) {
    if (!(err instanceof visibilityService.VisibilityForbiddenError)) {
      throw err;
    }
  }
  const staff = await visibilityService.assertCanViewStaff(client, { userId: allocation.staff_user_id }, actor);
  if (staff === null) {
    throw new visibilityService.VisibilityForbiddenError(
      `role ${JSON.stringify(actor.actorRole)} (user ${JSON.stringify(actor.actorUserId)}) may not view faculty allocation ${JSON.stringify(allocation.id)}`,
    );
  }
}

function createFacultyAllocationRouter() {
  const router = express.Router();

  // RBAC here is the same deliberately conservative default
  // classes.js/staff.js/students.js use, not a final decision.
  // BusinessRules.md names no specific actor for "who may assign
  // faculty to a period" (unlike "Class Tutor is assigned only by
  // HOD") — academicService.js's own .ai/TASK.md already left this to
  // the route/RBAC layer, not invented at either layer.
  // requirePermission('faculty_allocation.create'/'delete') (mapped to
  // ['principal']) gates writes, requireAuth gates reads, same as
  // every other Module 3 route.

  router.post('/faculty-allocation', requirePermission('faculty_allocation.create'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const allocation = await academicService.assignFacultyAllocation(
        req.dbClient,
        { collegeId: req.collegeId, ...bodyToServiceFields(req.body || {}) },
        { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.status(201).json(allocation);
    } catch (err) {
      if (mapAcademicServiceError(err, res)) return;
      throw err;
    }
  }));

  router.get('/faculty-allocation/:id', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const allocation = await academicService.getFacultyAllocation(req.dbClient, req.params.id);
    if (allocation === null) {
      res.status(404).json({ detail: `No faculty allocation found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    const actor = { actorUserId: identityService.resolveActorUserId(req.capabilities), actorRole: req.jwtClaims.role || req.capabilities.effectiveRole, collegeId: req.collegeId };
    try {
      await assertCanViewAllocation(req.dbClient, allocation, actor);
    } catch (err) {
      if (mapAcademicServiceError(err, res)) return;
      throw err;
    }
    res.json(allocation);
  }));

  // No plain, unscoped "list all" — academicService.js exposes only
  // the two lookups a real consumer already needs
  // (listFacultyAllocationsForClass/listFacultyAllocationsForStaff),
  // matching its own "not every repository export gets wrapped, only
  // what's needed" precedent. Exactly one of class_id/staff_user_id is
  // required to pick which. Scoped via visibilityService (this
  // session's own task): class_id uses assertCanViewClass directly;
  // staff_user_id uses assertCanViewStaff — "staff sees own
  // allocations" means a staff actor may only query their own
  // staff_user_id, while hod/principal may query anyone's within their
  // own department/college.
  router.get('/faculty-allocation', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { class_id: classId, staff_user_id: staffUserId } = req.query;
    if (!classId && !staffUserId) {
      res.status(400).json({ detail: 'class_id or staff_user_id query parameter is required' });
      return;
    }
    if (classId && staffUserId) {
      res.status(400).json({ detail: 'provide only one of class_id or staff_user_id, not both' });
      return;
    }
    const actor = { actorUserId: identityService.resolveActorUserId(req.capabilities), actorRole: req.jwtClaims.role || req.capabilities.effectiveRole, collegeId: req.collegeId };
    try {
      if (classId) {
        await visibilityService.assertCanViewClass(req.dbClient, classId, actor);
      } else {
        const staff = await visibilityService.assertCanViewStaff(req.dbClient, { userId: staffUserId }, actor);
        if (staff === null) {
          res.status(404).json({ detail: `No staff found with user id ${JSON.stringify(staffUserId)}` });
          return;
        }
      }
    } catch (err) {
      if (mapAcademicServiceError(err, res)) return;
      throw err;
    }
    const allocations = classId
      ? await academicService.listFacultyAllocationsForClass(req.dbClient, classId)
      : await academicService.listFacultyAllocationsForStaff(req.dbClient, staffUserId);
    res.json(allocations);
  }));

  router.delete('/faculty-allocation/:id', requirePermission('faculty_allocation.delete'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const allocation = await academicService.removeFacultyAllocation(req.dbClient, req.params.id, { actorUserId: identityService.resolveActorUserId(req.capabilities) });
    if (allocation === null) {
      res.status(404).json({ detail: `No faculty allocation found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.status(204).end();
  }));

  return router;
}

module.exports = createFacultyAllocationRouter;
