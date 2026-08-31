'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const academicService = require('../services/academicService');
const classTutorService = require('../services/classTutorService');
const staffService = require('../services/staffService');
const workflowService = require('../services/workflowService');
const visibilityService = require('../services/visibilityService');
const studentService = require('../services/studentService');
const attendanceService = require('../services/attendanceService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// snake_case <-> camelCase translation lives here, not in a shared
// util, same reasoning as staff.js's STAFF_BODY_FIELDS. college_id is
// deliberately absent (always req.collegeId, never the request body).
// tutor_user_id is mapped here NOT because the column still exists —
// classes.tutor_user_id was dropped in
// 1758000000000_drop-classes-tutor-user-id.js, Class Tutor is a
// Position/Account/Occupant now (position_class_assignments) — but so
// bodyToServiceFields can translate the field name and let
// academicService's own explicit check (fields.tutorUserId !== undefined)
// reject it with a clear "use POST/PUT /classes/:id/tutor instead"
// error, rather than silently dropping an unrecognized snake_case key.
const CLASS_BODY_FIELDS = [
  ['class_name', 'className'],
  ['department', 'department'],
  ['department_id', 'departmentId'],
  ['semester', 'semester'],
  ['tutor_user_id', 'tutorUserId'],
  ['timetable_status', 'timetableStatus'],
  ['timetable_data', 'timetableData'],
  ['timetable_remarks', 'timetableRemarks'],
  ['max_hours_per_day_per_staff', 'maxHoursPerDayPerStaff'],
];

function bodyToServiceFields(body) {
  const fields = {};
  for (const [snakeKey, camelKey] of CLASS_BODY_FIELDS) {
    if (body[snakeKey] !== undefined) {
      fields[camelKey] = body[snakeKey];
    }
  }
  return fields;
}

// Response bodies are NOT translated back to camelCase — same choice
// staff.js/students.js made, same reasoning: strictly less code here,
// and nothing downstream expects camelCase yet.

function mapAcademicServiceError(err, res) {
  if (err instanceof academicService.ClassValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.SubstituteAssignmentValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.SubstituteAssignmentPeriodNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.SubstituteAssignmentConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.SubstituteAssignmentNotAuthorizedError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.SubstituteAssignmentCandidateNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.SubstituteAssignmentCandidateNotInDepartmentError) {
    res.status(422).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.SubstituteAssignmentCandidateNotFreeError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.SubstituteAssignmentRequestNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.SubstituteAssignmentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.TimetableGenerationValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.TimetableGenerationClassApprovedError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.TimetableGenerationForbiddenError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.TimetableConfigValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassTimetableStatusError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassNameConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassTutorConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassTutorNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassDepartmentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassTimetableStatusManagedByWorkflowError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassTimetableApprovalNotPendingError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffHodNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffPrincipalNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowService.WorkflowRequestConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowService.WorkflowRequestUserNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowService.WorkflowRequestValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassSendAlertValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassSendAlertNotAssignedError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof visibilityService.VisibilityForbiddenError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  // Phase 2 step 18 — classTutorService.assignClassTutor/
  // reassignClassTutor's own errors, checked here rather than a second
  // mapper function: same one call site (mapAcademicServiceError)
  // routes/classes.js already funnels every service error through.
  if (err instanceof classTutorService.ClassTutorClassNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof classTutorService.ClassTutorValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof classTutorService.ClassTutorNotAssignedError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  return false;
}

function createClassesRouter() {
  const router = express.Router();

  // RBAC here is the same deliberately conservative default
  // staff.js/students.js use, not a final decision. BusinessRules.md's
  // real rules ("Class Tutor is assigned only by HOD", the HOD/
  // Principal timetable review chain) go through the real
  // submitTimetableForApproval/approveTimetableApproval chain now
  // (WorkflowService, Module 8) for the review itself, but plain
  // create/update/delete on a class row is still gated by
  // requirePermission('classes.create'/'update'/'delete') — mapped to
  // ['principal'] in middleware/permissions.js — since Principal is
  // the one existing role that's genuinely the final authority in
  // every real chain BusinessRules.md describes; requireAuth gates
  // reads. Revisit once BusinessRules.md names a narrower actor (e.g.
  // "HOD may assign a Class Tutor for their own department") — that's
  // a new permission mapping at that point, not a new mechanism.

  router.post(
    '/classes',
    requirePermission('classes.create'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const cls = await academicService.createClass(
          req.dbClient,
          { collegeId: req.collegeId, ...bodyToServiceFields(req.body || {}) },
          { actorUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.status(201).json(cls);
      } catch (err) {
        if (mapAcademicServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/classes/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const cls = await academicService.getClass(req.dbClient, req.params.id);
      if (cls === null) {
        res.status(404).json({ detail: `No class found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      try {
        await visibilityService.assertCanViewClass(req.dbClient, cls.id, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
          collegeId: req.collegeId,
        });
      } catch (err) {
        if (mapAcademicServiceError(err, res)) return;
        throw err;
      }
      res.json(cls);
    }),
  );

  // limit/offset are passed through as-is — academicService/
  // classRepository already default them to 50/0, not re-implemented
  // here — for principal/internal callers, where visibilityService.
  // getVisibleClassIds returns null (unrestricted). staff/hod are
  // scoped first (this session's own task: this route used to return
  // every class in the college to anyone authenticated) via
  // getVisibleClassIds, then paginated in JS the same way
  // studentService.listStudents already paginates its own
  // staff/hod-scoped rosters — a tutor's or a department's class list
  // is never large enough for that to matter.
  router.get(
    '/classes',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { limit: rawLimit, offset: rawOffset } = req.query;
      const limit = rawLimit === undefined ? 50 : Number(rawLimit);
      const offset = rawOffset === undefined ? 0 : Number(rawOffset);
      const actor = {
        actorUserId: identityService.resolveActorUserId(req.capabilities),
        actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
        collegeId: req.collegeId,
      };

      const visibleIds = await visibilityService.getVisibleClassIds(req.dbClient, actor);
      if (visibleIds === null) {
        const classes = await academicService.listClasses(req.dbClient, { limit, offset });
        res.json(classes);
        return;
      }
      if (visibleIds.length === 0) {
        res.json([]);
        return;
      }
      const classes = (await Promise.all(visibleIds.map((id) => academicService.getClass(req.dbClient, id))))
        .filter((cls) => cls !== null)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      res.json(classes.slice(offset, offset + limit));
    }),
  );

  router.put(
    '/classes/:id',
    requirePermission('classes.update'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const cls = await academicService.updateClass(
          req.dbClient,
          req.params.id,
          bodyToServiceFields(req.body || {}),
          { userId: identityService.resolveActorUserId(req.capabilities) },
        );
        if (cls === null) {
          res.status(404).json({ detail: `No class found with id ${JSON.stringify(req.params.id)}` });
          return;
        }
        res.json(cls);
      } catch (err) {
        if (mapAcademicServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // Phase 2 step 18: dedicated routes for Class Tutor
  // assignment/reassignment — a genuinely different actor set
  // (HOD-only, own-department, requirePermission('classes.assign_tutor')
  // mapped to ['hod']) than the rest of this file's principal-only
  // create/update/delete, so folded into neither PATCH /classes/:id nor
  // a shared permission. POST is first-time assignment (409 if one
  // already exists); PUT is reassignment (404 if none exists yet).
  router.post(
    '/classes/:id/tutor',
    requirePermission('classes.assign_tutor'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const occupant = await classTutorService.assignClassTutor(req.dbClient, req.params.id, {
          newTutorUserId: (req.body || {}).new_tutor_user_id,
          actorUserId: identityService.resolveActorUserId(req.capabilities),
        });
        res.status(201).json(occupant);
      } catch (err) {
        if (mapAcademicServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.put(
    '/classes/:id/tutor',
    requirePermission('classes.assign_tutor'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const occupant = await classTutorService.reassignClassTutor(req.dbClient, req.params.id, {
          newTutorUserId: (req.body || {}).new_tutor_user_id,
          actorUserId: identityService.resolveActorUserId(req.capabilities),
        });
        res.json(occupant);
      } catch (err) {
        if (mapAcademicServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // Module 3->4 gap fix: the trigger point for the real HOD->Principal
  // timetable review chain — same requireAuth (not requireRole)
  // reasoning staff.js's own submit-registration route gives: the
  // named actor per BusinessRules.md is whoever submits, and
  // workflowService's own step-matching + self-approval checks are the
  // real gate, not this route's RBAC.
  router.post(
    '/classes/:id/submit-for-approval',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const workflowRequest = await academicService.submitTimetableForApproval(req.dbClient, req.params.id, {
          requestedByUserId: identityService.resolveActorUserId(req.capabilities),
        });
        res.status(201).json(workflowRequest);
      } catch (err) {
        if (mapAcademicServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // RS-CLS-007 (ADL-004): "the absent staff member, L3, or the class's
  // L4 may initiate the request" — not an ['hod', 'principal'] role
  // list (a hod of an unrelated department, or a principal, is not this
  // rule's actor set), so requireAuth only, same "the service is the
  // real gate" split submit-for-approval already uses — academicService.
  // requestSubstituteAssignment resolves the actual authorization
  // itself, against this specific class/department.
  router.post(
    '/classes/:id/substitute-assignments',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const {
        timetable_period_id: timetablePeriodId,
        assignment_date: assignmentDate,
        original_staff_user_id: originalStaffUserId,
        substitute_staff_user_id: substituteStaffUserId,
        reason,
      } = req.body || {};
      try {
        const result = await academicService.requestSubstituteAssignment(
          req.dbClient,
          {
            classId: req.params.id,
            timetablePeriodId,
            assignmentDate,
            originalStaffUserId,
            substituteStaffUserId,
            reason,
          },
          {
            requestedByUserId: identityService.resolveActorUserId(req.capabilities),
            requestedByRole: req.jwtClaims.role || req.capabilities.effectiveRole,
          },
        );
        res.status(201).json(result);
      } catch (err) {
        if (mapAcademicServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // Enriched with RS-CLS-008's read-only marking-status advisory
  // (marked / markingOverdue) — AttendanceService's, not AcademicService's,
  // since AttendanceService owns attendance_sessions and the 24-hour
  // window is its rule, not AcademicService's.
  router.get(
    '/classes/:id/substitute-assignments',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const assignments = await attendanceService.listSubstituteAssignmentsWithMarkingStatus(
        req.dbClient,
        req.params.id,
      );
      res.json(assignments);
    }),
  );

  // "My Substitute Duties" (UAT Priority 1 #2) — every assignment
  // where the caller IS the substitute, across every class. Registered
  // before /classes/:id routes would ever be reached for a literal
  // "mine" id (Express matches route strings in registration order,
  // and this path never collides with a UUID :id anyway, but kept
  // adjacent to the other substitute-assignment routes for
  // discoverability, not because of a routing hazard).
  router.get(
    '/substitute-assignments/mine',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const assignments = await academicService.listMySubstituteAssignments(req.dbClient, {
        substituteStaffUserId: identityService.resolveActorUserId(req.capabilities),
      });
      res.json(assignments);
    }),
  );

  router.post(
    '/substitute-assignments/:id/acknowledge',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const acknowledgement = await academicService.acknowledgeSubstituteAssignment(req.dbClient, req.params.id, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          collegeId: req.collegeId,
        });
        res.status(201).json(acknowledgement);
      } catch (err) {
        if (mapAcademicServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // requirements: [{ subject, subject_type, staff_user_id |
  // staff_user_ids, periods_per_week, session_blocks }] — see
  // academicService.generateTimetable's own comment for why this is a
  // caller-supplied input, not derived automatically.
  //
  // Corrected in the same session that introduced this route:
  // originally gated by requirePermission('timetables.generate'), the
  // same table-lookup mechanism every OTHER permission-gated route in
  // this codebase uses — but a genuine Class Tutor Position Account
  // seat login's req.capabilities.effectiveRole is 'class_tutor', a
  // value permissions.js's PERMISSION_ROLES table never lists for any
  // permission, so that login shape got a flat 403 before
  // academicService.assertCanGenerateForClass (the real own-class-only
  // gate) ever ran. requireAuth + that service-layer gate is the
  // correct shape here — the same "role list only narrows who reaches
  // the route; the service is the real gate" split submit-for-approval/
  // send-alert/substitute-assignments above already use for every
  // other actor-scoped (not blanket-role-scoped) action in this file.
  router.post(
    '/classes/:id/generate-timetable',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const requirements = ((req.body || {}).requirements || []).map((r) => ({
        subject: r.subject,
        subjectType: r.subject_type,
        staffUserId: r.staff_user_id,
        staffUserIds: r.staff_user_ids,
        periodsPerWeek: r.periods_per_week,
        sessionBlocks: r.session_blocks,
      }));
      try {
        // actorRole prefers req.jwtClaims.role (the literal JWT claim a
        // personal login carries) over req.capabilities.effectiveRole —
        // NOT the other way round. A position_access (seat) token has no
        // role claim at all, so effectiveRole is the only source there;
        // but for an ordinary personal login, capabilities.effectiveRole
        // is freshly re-derived from live Position-model rows and can
        // legitimately disagree with the JWT's own role for any user who
        // predates/lacks a matching `positions` row (confirmed by this
        // session's own test run: students.test.js's plain
        // users.role='principal' fixture has no Position row, so
        // effectiveRole alone resolves to 'staff'). jwtClaims.role is the
        // one every existing caller already trusted; keep trusting it
        // when it exists, only fall back to effectiveRole when it can't.
        const result = await academicService.generateTimetable(req.dbClient, req.params.id, requirements, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
          maxHoursPerDay: (req.body || {}).max_hours_per_day,
        });
        res.status(200).json(result);
      } catch (err) {
        if (mapAcademicServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // RS-TTB-001 Section 11 — "any modification creates a Revision
  // Proposal ... regenerate ONLY affected sessions." Same requirements
  // shape as generate-timetable, but every entry names a subject whose
  // existing rows get replaced; everything else on the class is left
  // alone. Ends by calling the existing submit-for-approval chain
  // itself (see academicService.reviseTimetable's own comment) — this
  // route does not additionally call submit-for-approval. Same
  // requireAuth-not-requirePermission correction as generate-timetable
  // above, same reason.
  router.post(
    '/classes/:id/revise-timetable',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const changedRequirements = ((req.body || {}).requirements || []).map((r) => ({
        subject: r.subject,
        subjectType: r.subject_type,
        staffUserId: r.staff_user_id,
        staffUserIds: r.staff_user_ids,
        periodsPerWeek: r.periods_per_week,
        sessionBlocks: r.session_blocks,
      }));
      try {
        const result = await academicService.reviseTimetable(req.dbClient, req.params.id, changedRequirements, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
          maxHoursPerDay: (req.body || {}).max_hours_per_day,
        });
        res.status(200).json(result);
      } catch (err) {
        if (mapAcademicServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // BusinessRules.md Semester progression and graduation: "promotion
  // occurs automatically when the current semester is officially
  // closed" — this is the manual trigger for that (no scheduled job
  // ties it to Academic Year closing yet, same honest gap
  // attendanceService.lockAttendanceSession's own comment already
  // flags for time-based locking). requirePermission, not requireAuth:
  // unlike lifecycle-status changes (which name Class Tutor),
  // BusinessRules.md names no actor for triggering a whole class's
  // promotion — same conservative default other un-named-actor create
  // actions in this codebase use.
  router.post(
    '/classes/:id/promote-semester',
    requirePermission('classes.promote_semester'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const result = await studentService.promoteSemesterForClass(req.dbClient, req.params.id, {
        actorUserId: identityService.resolveActorUserId(req.capabilities),
      });
      res.json(result);
    }),
  );

  // Read-only — BusinessRules.md Timetable revision: "all revisions are
  // permanently retained." requireAuth, same as every other read in
  // this router; nothing scopes revision history to a narrower actor.
  router.get(
    '/classes/:id/timetable-revisions',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const revisions = await academicService.listTimetableRevisions(req.dbClient, req.params.id);
      res.json(revisions);
    }),
  );

  // "attendance always uses the revision effective on the class date"
  // — the same lookup exposed as its own endpoint for any caller
  // (human or AI) that needs to resolve it directly, without assuming
  // today's date. ?date=YYYY-MM-DD; defaults to today when omitted.
  router.get(
    '/classes/:id/timetable-revisions/effective',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const date = req.query.date || new Date().toISOString().slice(0, 10);
      const revision = await academicService.getEffectiveTimetableRevision(req.dbClient, req.params.id, date);
      if (revision === null) {
        res.status(404).json({
          detail: `No timetable revision is effective for class ${JSON.stringify(req.params.id)} on ${JSON.stringify(date)}`,
        });
        return;
      }
      res.json(revision);
    }),
  );

  // Send Alert (item 5 of this session's task) — requireAuth, not a
  // permission: the real gate is academicService.sendClassAlert's own
  // "actorUserId must be this class's tutor OR its timetable-assigned
  // faculty" check (widened from tutor-only by ADL-024/RS-NTF-007,
  // 2026-07-30), same requireAuth-not-requireRole reasoning
  // submit-for-approval above already documents for an actor-scoped
  // action. Body is a single plain-text field, no AI, never routed
  // through WorkflowService — see sendClassAlert's own comment for why
  // that's an explicitly documented exception, not an oversight.
  router.post(
    '/classes/:id/send-alert',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const results = await academicService.sendClassAlert(req.dbClient, req.params.id, (req.body || {}).body, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
        });
        res.status(200).json({ results });
      } catch (err) {
        if (mapAcademicServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.delete(
    '/classes/:id',
    requirePermission('classes.delete'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const cls = await academicService.removeClass(req.dbClient, req.params.id, {
        userId: identityService.resolveActorUserId(req.capabilities),
      });
      if (cls === null) {
        res.status(404).json({ detail: `No class found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.status(204).end();
    }),
  );

  return router;
}

module.exports = createClassesRouter;
