'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const collegeProfileService = require('../services/collegeProfileService');
const staffService = require('../services/staffService');
const academicService = require('../services/academicService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// principal only, both read and write — same "this whole resource
// belongs to one role" reasoning routes/collegeProfile.js documents
// (moved from college_admin for the same reason — see that file's
// comment).
const DEPARTMENT_BODY_FIELDS = [
  ['name', 'name'],
  ['approved_intake', 'approvedIntake'],
  ['course_duration', 'courseDuration'],
  ['default_sections', 'defaultSections'],
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

function mapDepartmentError(err, res) {
  if (err instanceof collegeProfileService.DepartmentValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof collegeProfileService.DepartmentNameConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassGenerationValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassNameConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  return false;
}

function createDepartmentsRouter() {
  const router = express.Router();

  router.get('/departments', requirePermission('departments.read'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const departments = await collegeProfileService.listDepartments(req.dbClient, req.collegeId);
    res.json(departments);
  }));

  router.post('/departments', requirePermission('departments.create'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const department = await collegeProfileService.createDepartment(
        req.dbClient,
        { collegeId: req.collegeId, ...bodyToFields(req.body || {}, DEPARTMENT_BODY_FIELDS) },
        { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.status(201).json(department);
    } catch (err) {
      if (mapDepartmentError(err, res)) return;
      throw err;
    }
  }));

  router.get('/departments/:id', requirePermission('departments.read'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const department = await collegeProfileService.getDepartment(req.dbClient, req.params.id);
    if (department === null) {
      res.status(404).json({ detail: `No department found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.json(department);
  }));

  router.put('/departments/:id', requirePermission('departments.update'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const department = await collegeProfileService.updateDepartment(
        req.dbClient,
        req.params.id,
        bodyToFields(req.body || {}, DEPARTMENT_BODY_FIELDS),
        { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      if (department === null) {
        res.status(404).json({ detail: `No department found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.json(department);
    } catch (err) {
      if (mapDepartmentError(err, res)) return;
      throw err;
    }
  }));

  router.delete('/departments/:id', requirePermission('departments.delete'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const department = await collegeProfileService.removeDepartment(
      req.dbClient,
      req.params.id,
      { actorUserId: identityService.resolveActorUserId(req.capabilities), collegeId: req.collegeId },
    );
    if (department === null) {
      res.status(404).json({ detail: `No department found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.status(204).end();
  }));

  // BusinessRules.md Staff lifecycle: "the Principal may appoint an
  // eligible faculty member as HOD In-Charge." requirePermission
  // mapped to ['principal'] is that authority check — unlike the
  // per-row tutor/hod checks elsewhere, "Principal" is a plain role
  // check, no per-row identity resolution needed.
  router.post('/departments/:id/hod-in-charge', requirePermission('hod_in_charge.appoint'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { faculty_user_id: facultyUserId, reason } = req.body || {};
    try {
      const appointment = await staffService.appointHodInCharge(
        req.dbClient, req.params.id, facultyUserId, { reason }, { actorUserId: identityService.resolveActorUserId(req.capabilities), collegeId: req.collegeId },
      );
      res.status(201).json(appointment);
    } catch (err) {
      if (mapDepartmentError(err, res)) return;
      if (err instanceof staffService.HodInChargeValidationError) {
        res.status(400).json({ detail: err.message });
        return;
      }
      if (err instanceof staffService.HodInChargeAlreadyActiveError) {
        res.status(409).json({ detail: err.message });
        return;
      }
      throw err;
    }
  }));

  router.get('/departments/:id/hod-in-charge', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const appointment = await staffService.getActiveHodInCharge(req.dbClient, req.collegeId, req.params.id);
    res.json(appointment);
  }));

  router.get('/departments/:id/hod-in-charge/history', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const history = await staffService.listHodInChargeHistory(req.dbClient, req.params.id);
    res.json(history);
  }));

  router.post('/departments/:id/hod-in-charge/:appointmentId/revoke', requirePermission('hod_in_charge.appoint'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const appointment = await staffService.revokeHodInCharge(req.dbClient, req.params.appointmentId, { actorUserId: identityService.resolveActorUserId(req.capabilities) });
      res.json(appointment);
    } catch (err) {
      if (err instanceof staffService.StaffDeactivationNotFoundError) {
        res.status(404).json({ detail: err.message });
        return;
      }
      throw err;
    }
  }));

  return router;
}

module.exports = createDepartmentsRouter;
