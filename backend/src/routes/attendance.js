'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const attendanceService = require('../services/attendanceService');
const visibilityService = require('../services/visibilityService');
const workflowService = require('../services/workflowService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// snake_case <-> camelCase translation lives here, not in a shared
// util, same reasoning as classes.js/facultyAllocation.js's own
// *_BODY_FIELDS. college_id is deliberately absent (always
// req.collegeId, never the request body). absent_student_ids is
// passed straight through as the JSON array express.json() already
// parsed it into — attendanceService.markAttendance is the one that
// JSON.stringify's it before handing it to the repository (see that
// file's own comment on why), not this route.
const ATTENDANCE_BODY_FIELDS = [
  ['class_id', 'classId'],
  ['session_date', 'sessionDate'],
  ['hour_index', 'hourIndex'],
  ['absent_student_ids', 'absentStudentIds'],
  ['total_students', 'totalStudents'],
];

function bodyToServiceFields(body) {
  const fields = {};
  for (const [snakeKey, camelKey] of ATTENDANCE_BODY_FIELDS) {
    if (body[snakeKey] !== undefined) {
      fields[camelKey] = body[snakeKey];
    }
  }
  return fields;
}

// Response bodies are NOT translated back to camelCase — same choice
// classes.js/facultyAllocation.js/staff.js/students.js all made.

function mapAttendanceServiceError(err, res) {
  if (err instanceof attendanceService.AttendanceValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof attendanceService.AttendanceClassNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  // "Not Approved" and "locked" are both "this resource isn't in a
  // state that allows this action right now" — the same state-
  // conflict semantics ClassNameConflictError/FacultyAllocationPeriodTakenError
  // already use 409 for elsewhere in this codebase, not a new
  // convention invented here.
  if (err instanceof attendanceService.AttendanceTimetableNotApprovedError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof attendanceService.AttendanceLockedError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof attendanceService.AttendanceSessionConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof attendanceService.AttendanceReMarkConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  // Authenticated but not permitted to mark *this* class's attendance
  // — the same 403 rbac.js's requireRole already uses for "wrong
  // role," extended here to a per-row authorization decision
  // requireRole can't express (see the router's own comment on why
  // this route doesn't gate writes with requireRole at all).
  if (err instanceof attendanceService.AttendanceForbiddenError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof visibilityService.VisibilityForbiddenError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof attendanceService.AttendanceSessionNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof attendanceService.AttendanceNotLockedError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof attendanceService.AttendanceCorrectionValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof attendanceService.AttendanceCorrectionNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof attendanceService.AttendanceCorrectionNotAuthorizedError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof attendanceService.AttendanceCorrectionNoPendingRequestError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof attendanceService.AttendanceCorrectionInvalidEscalationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowService.WorkflowRequestStepMismatchError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof attendanceService.AttendanceAbsenceFlagNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof attendanceService.AttendanceAbsenceFlagAlreadyClosedError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof attendanceService.AttendanceAbsenceFlagNotAuthorizedError) {
    res.status(403).json({ detail: err.message });
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

function createAttendanceRouter() {
  const router = express.Router();

  // RBAC here deliberately does NOT follow classes.js/staff.js/
  // students.js/facultyAllocation.js's requireRole('principal')-for-
  // writes convention. Those services have no authorization logic of
  // their own — the route is the only gate, so it has to be
  // conservative. attendanceService.markAttendance is different: it
  // already enforces BusinessRules.md's real, three-actor rule itself
  // (class tutor, HOD force-mark, or the staff member genuinely
  // scheduled for the period — see attendanceService.js's own
  // assertCanMark), mapped to a 403 via AttendanceForbiddenError
  // above. Gating this route with requireRole('principal') would
  // silently override that and lock out every actor BusinessRules.md
  // actually names as eligible — ordinary teaching staff and class
  // tutors are not principals. requireAuth (any authenticated tenant
  // user) is the correct, and only correct, route-level gate here;
  // the service is where the real decision is made.

  router.post('/attendance', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const session = await attendanceService.markAttendance(
        req.dbClient,
        bodyToServiceFields(req.body || {}),
        { actorUserId: identityService.resolveActorUserId(req.capabilities), actorRole: req.jwtClaims.role || req.capabilities.effectiveRole },
      );
      // 200, not 201: markAttendance is a real mark-or-re-mark upsert
      // (StaffDashboard.jsx's own "Mark Attendance"/"Update Attendance"
      // button is the same handler either way — see that file's own
      // comment), and the service's return value doesn't distinguish
      // which happened, so there's nothing here to key a 201 off of
      // without changing markAttendance's own contract, which this
      // slice doesn't do.
      res.status(200).json(session);
    } catch (err) {
      if (mapAttendanceServiceError(err, res)) return;
      throw err;
    }
  }));

  // RS-ATT-008 (D6, Stage 6): scoped exactly like
  // assessment_marks_summary's own actor-scoped read — a tutor sees
  // their own class's flags, hod their department's, principal
  // unrestricted. Registered ahead of /attendance/:id below — Express
  // matches routes in registration order, and "absence-flags" would
  // otherwise be swallowed as an :id (found live, 2026-07-28).
  router.get('/attendance/absence-flags', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const flags = await attendanceService.listOutstandingAbsenceFlagsForActor(req.dbClient, {
      actorUserId: identityService.resolveActorUserId(req.capabilities), actorRole: req.jwtClaims.role || req.capabilities.effectiveRole, collegeId: req.collegeId,
    });
    res.json(flags);
  }));

  // requireAuth, not requirePermission: RS-ATT-008 names the actor
  // ("L3 MUST open and close it out") — closeAbsenceFlag's own hod/
  // principal check is the real gate, same "the service is the gate"
  // reasoning this router already uses throughout.
  router.post('/attendance/absence-flags/:id/close', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { remarks } = req.body || {};
    try {
      const flag = await attendanceService.closeAbsenceFlag(
        req.dbClient,
        req.params.id,
        { actorUserId: identityService.resolveActorUserId(req.capabilities), actorRole: req.jwtClaims.role || req.capabilities.effectiveRole, remarks },
      );
      res.json(flag);
    } catch (err) {
      if (mapAttendanceServiceError(err, res)) return;
      throw err;
    }
  }));

  // requireAuth gates "must be logged in"; the real scope (staff:
  // tutor/faculty-allocated of this session's class, hod: own
  // department, principal: own college — this session's own task) is
  // visibilityService.assertCanViewClass's job, same
  // resolve-the-real-assignment discipline attendanceService's own
  // assertCanMark already uses for the write side.
  router.get('/attendance/:id', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const session = await attendanceService.getAttendanceSession(req.dbClient, req.params.id);
    if (session === null) {
      res.status(404).json({ detail: `No attendance session found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    try {
      await visibilityService.assertCanViewClass(req.dbClient, session.class_id, {
        actorUserId: identityService.resolveActorUserId(req.capabilities), actorRole: req.jwtClaims.role || req.capabilities.effectiveRole, collegeId: req.collegeId,
      });
    } catch (err) {
      if (mapAttendanceServiceError(err, res)) return;
      throw err;
    }
    res.json(session);
  }));

  // class_id is always required. session_date (exact match) keeps its
  // original required-together contract — no breaking change for any
  // existing caller. start_date/end_date are new and optional: either
  // may be given instead of session_date to widen the same read into a
  // range, and omitting both start_date and end_date (with no
  // session_date) means all-time for that class, not a 400.
  router.get('/attendance', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const {
      class_id: classId, session_date: sessionDate, start_date: startDate, end_date: endDate,
    } = req.query;
    if (!classId) {
      res.status(400).json({ detail: 'class_id query parameter is required' });
      return;
    }
    try {
      await visibilityService.assertCanViewClass(req.dbClient, classId, {
        actorUserId: identityService.resolveActorUserId(req.capabilities), actorRole: req.jwtClaims.role || req.capabilities.effectiveRole, collegeId: req.collegeId,
      });
    } catch (err) {
      if (mapAttendanceServiceError(err, res)) return;
      throw err;
    }
    if (sessionDate) {
      const sessions = await attendanceService.listAttendanceSessionsForClassAndDate(req.dbClient, classId, sessionDate);
      res.json(sessions);
      return;
    }
    const sessions = await attendanceService.listAttendanceSessionsForClassInRange(req.dbClient, classId, { startDate, endDate });
    res.json(sessions);
  }));

  router.post('/attendance/:id/lock', requirePermission('attendance.lock'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const session = await attendanceService.lockAttendanceSession(req.dbClient, req.params.id, { actorUserId: identityService.resolveActorUserId(req.capabilities) });
      res.json(session);
    } catch (err) {
      if (mapAttendanceServiceError(err, res)) return;
      throw err;
    }
  }));

  router.get('/attendance/:id/effective', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const session = await attendanceService.getEffectiveAttendanceSession(req.dbClient, req.params.id);
    if (session === null) {
      res.status(404).json({ detail: `No attendance session found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.json(session);
  }));

  // requireAuth, not requirePermission: BusinessRules.md names the
  // actor ("Subject Faculty submits a correction request") — same
  // "service is the gate" reasoning the rest of this router already
  // uses. Nothing here restricts *which* faculty may submit; the
  // approval step (Class Tutor only, via workflowService's own
  // step-matching) is the real gate on the outcome.
  router.post('/attendance/:id/corrections', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const {
      proposed_absent_student_ids: proposedAbsentStudentIds,
      proposed_total_students: proposedTotalStudents,
      reason,
    } = req.body || {};
    try {
      const result = await attendanceService.requestAttendanceCorrection(
        req.dbClient,
        req.params.id,
        { proposedAbsentStudentIds, proposedTotalStudents, reason },
        { requestedByUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.status(201).json(result);
    } catch (err) {
      if (mapAttendanceServiceError(err, res)) return;
      throw err;
    }
  }));

  router.get('/attendance/:id/corrections', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const corrections = await attendanceService.listAttendanceCorrectionsForSession(req.dbClient, req.params.id);
    res.json(corrections);
  }));

  router.post('/attendance/corrections/:correctionId/approve', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const correction = await attendanceService.approveAttendanceCorrection(req.dbClient, req.params.correctionId, { actorUserId: identityService.resolveActorUserId(req.capabilities), actorRole: req.jwtClaims.role || req.capabilities.effectiveRole });
      res.json(correction);
    } catch (err) {
      if (mapAttendanceServiceError(err, res)) return;
      throw err;
    }
  }));

  // RS-ATT-004 (D9): only the current step's real approver (checked by
  // workflowService.escalateRequest's own step-mismatch guard, same as
  // approve/reject) may escalate — requireAuth, not requirePermission,
  // same "the service is the gate" reasoning this router already uses
  // throughout.
  router.post('/attendance/corrections/:correctionId/escalate', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { escalate_to_role: escalateToRole, remarks } = req.body || {};
    try {
      const correction = await attendanceService.escalateAttendanceCorrection(
        req.dbClient,
        req.params.correctionId,
        { actorUserId: identityService.resolveActorUserId(req.capabilities), actorRole: req.jwtClaims.role || req.capabilities.effectiveRole, escalateToRole, remarks },
      );
      res.json(correction);
    } catch (err) {
      if (mapAttendanceServiceError(err, res)) return;
      throw err;
    }
  }));

  router.post('/attendance/corrections/:correctionId/reject', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const correction = await attendanceService.rejectAttendanceCorrection(req.dbClient, req.params.correctionId, { actorUserId: identityService.resolveActorUserId(req.capabilities), actorRole: req.jwtClaims.role || req.capabilities.effectiveRole });
      res.json(correction);
    } catch (err) {
      if (mapAttendanceServiceError(err, res)) return;
      throw err;
    }
  }));

  // No DELETE route: attendance_sessions is soft-delete only per
  // BusinessRules.md's AI section, and any real deletion is an
  // approval-gated action ("even with approval") — WorkflowService
  // (Module 8) doesn't exist yet, and attendanceService.js itself
  // exposes no softDelete wrapper to call even if a route wanted to
  // (attendanceRepository.softDelete is unwrapped, same "don't invent
  // structure nobody asked for yet" restraint applied elsewhere).

  return router;
}

module.exports = createAttendanceRouter;
