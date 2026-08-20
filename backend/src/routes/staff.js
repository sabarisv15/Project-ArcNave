'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const { createUserScopedRateLimiter } = require('../middleware/rateLimit');
const staffService = require('../services/staffService');
const staffPhoneVerificationService = require('../services/staffPhoneVerificationService');
const staffWorkHistoryService = require('../services/staffWorkHistoryService');
const workflowService = require('../services/workflowService');
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
// util, same reasoning as students.js's STUDENT_BODY_FIELDS.
// college_id is deliberately absent (always req.collegeId, never the
// request body). Unlike students.js, user_id IS mapped here: it's how
// the caller names which already-provisioned account this profile
// belongs to (staff.user_id is NOT NULL + FK'd to users.id) — students
// has no equivalent column at all.
const STAFF_BODY_FIELDS = [
  ['user_id', 'userId'],
  ['staff_code', 'staffCode'],
  ['full_name', 'fullName'],
  ['first_name', 'firstName'],
  ['last_name', 'lastName'],
  ['email', 'email'],
  ['gender', 'gender'],
  ['dob', 'dob'],
  ['phone', 'phone'],
  ['department', 'department'],
  ['department_id', 'departmentId'],
  ['designation', 'designation'],
  ['qualification', 'qualification'],
  ['has_phd', 'hasPhd'],
  ['aicte_id', 'aicteId'],
  ['joined_year', 'joinedYear'],
  ['address', 'address'],
  // Expanded profile (UAT Priority 1 #4) — administrative half, same
  // principal-only staff.update permission as every other field above.
  ['appointment_type', 'appointmentType'],
  ['date_of_joining', 'dateOfJoining'],
  ['ug_qualification', 'ugQualification'],
  ['ug_specialization', 'ugSpecialization'],
  ['pg_qualification', 'pgQualification'],
  ['pg_specialization', 'pgSpecialization'],
  ['sslc_details', 'sslcDetails'],
  ['hsc_diploma_iti_details', 'hscDiplomaItiDetails'],
  ['work_experience', 'workExperience'],
  ['bank_account_number', 'bankAccountNumber'],
  ['bank_ifsc', 'bankIfsc'],
  ['pf_number', 'pfNumber'],
];

// Expanded profile (UAT Priority 1 #4) — self-service half, used only
// by PUT /staff/me below, never by the principal-only PUT /staff/:id
// route above. Deliberately a separate, narrower map rather than
// reusing STAFF_BODY_FIELDS with a runtime filter — keeps "what a
// staff member may change about themselves" visible as its own list,
// not derived by exclusion from the administrative one.
const SELF_SERVICE_BODY_FIELDS = [
  ['phone', 'phone'],
  ['address', 'address'],
  ['emergency_contact_name', 'emergencyContactName'],
  ['emergency_contact_phone', 'emergencyContactPhone'],
  ['emergency_contact_relation', 'emergencyContactRelation'],
  ['profile_photo_document_id', 'profilePhotoDocumentId'],
  // Widened 2026-08-04, ADL-030/RS-STF-013.
  ['first_name', 'firstName'],
  ['last_name', 'lastName'],
  ['email', 'email'],
  ['dob', 'dob'],
  ['gender', 'gender'],
  ['designation', 'designation'],
  ['appointment_type', 'appointmentType'],
  ['has_phd', 'hasPhd'],
  ['ug_qualification', 'ugQualification'],
  ['ug_specialization', 'ugSpecialization'],
  ['pg_qualification', 'pgQualification'],
  ['pg_specialization', 'pgSpecialization'],
  ['work_experience', 'workExperience'],
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

function bodyToServiceFields(body) {
  return bodyToFields(body, STAFF_BODY_FIELDS);
}

// Response bodies are NOT translated back to camelCase — same choice
// students.js made, same reasoning: strictly less code here, and
// nothing downstream expects camelCase yet.

function mapStaffServiceError(err, res) {
  if (err instanceof staffService.StaffValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffUserConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffCodeConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffAccountConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffUserNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffDepartmentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffPrincipalAlreadyActiveError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffHodAlreadyActiveError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffInvitationValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffInvitationNotAuthorizedError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffDeactivationNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffDeactivationNotAuthorizedError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffDeactivationHasActiveDutiesError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.HodInChargeValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.HodInChargeAlreadyActiveError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  // submitStaffRegistration's own error surface, per its own comment:
  // resolves the department's real HOD and the college's real Principal
  // (each throws if none exists yet), then calls
  // workflowService.submitRequest (throws if a Pending request already
  // governs this staff row, or the resolved shape is somehow invalid) —
  // none of these are staffService's own CRUD error classes, but this
  // route is the one place they can actually surface.
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
  if (err instanceof visibilityService.VisibilityForbiddenError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  return false;
}

function mapStaffPhoneVerificationServiceError(err, res) {
  if (err instanceof staffPhoneVerificationService.StaffPhoneVerificationValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffPhoneVerificationService.StaffPhoneVerificationNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffPhoneVerificationService.StaffPhoneVerificationNoPhoneOnFileError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffPhoneVerificationService.StaffPhoneVerificationNotRequestedError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffPhoneVerificationService.StaffPhoneVerificationMaxAttemptsExceededError) {
    res.status(429).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffPhoneVerificationService.StaffPhoneVerificationCodeMismatchError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  return false;
}

function mapStaffWorkHistoryServiceError(err, res) {
  if (err instanceof staffWorkHistoryService.StaffWorkHistoryValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffWorkHistoryService.StaffWorkHistoryNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffWorkHistoryService.StaffWorkHistoryForbiddenError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  return false;
}

function createStaffRouter() {
  const router = express.Router();

  // Same OTP-request brute-force protection as students.js's own
  // instance — see middleware/rateLimit.js.
  const otpRequestLimiter = createUserScopedRateLimiter(
    (req) => identityService.resolveActorUserId(req.capabilities),
  );

  // RBAC here is the same deliberately conservative default
  // students.js uses, not a final decision. BusinessRules.md's real
  // Staff registration chain (Faculty submits -> HOD approves ->
  // Principal approves) now runs through the real WorkflowService
  // (Module 8, see submitStaffRegistration/approveStaffRegistration
  // below), but plain create/update/delete on a staff row is still
  // gated by requirePermission('staff.create'/'update'/'delete')
  // (mapped to ['principal'] in middleware/permissions.js) — both the
  // Staff and HOD registration chains BusinessRules.md describes end
  // with Principal's final approval, so Principal is the one existing
  // role that's genuinely the final authority in every real chain;
  // requireAuth gates reads.
  //
  // RS-STF-001 (D10): kept intentionally, per ADL-007 — an internal/
  // administrative provisioning path (existing user + already-known
  // profile data, e.g. data migration, principal-provisioned bulk
  // setup), not a substitute for registration. The live app's own UI
  // (StaffListPage) no longer calls this — it invites
  // (POST /staff/invitations below) exclusively — which was the
  // documented gap ("frontend not yet repointed"). This route staying
  // reachable at the API layer for administrative use is a separate,
  // still-open decision, not re-litigated in this pass.
  router.post('/staff', requirePermission('staff.create'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const staff = await staffService.createStaff(
        req.dbClient,
        { collegeId: req.collegeId, ...bodyToServiceFields(req.body || {}) },
        { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.status(201).json(staff);
    } catch (err) {
      if (mapStaffServiceError(err, res)) return;
      throw err;
    }
  }));

  // RS-STF-001 (D10): the spec-compliant registration entry point —
  // "Staff registration is L3-initiated and invite-first... L3 sends
  // the invite — a plain email-address entry — from L3's own login."
  // requireAuth, not requirePermission: the real authority check is
  // "is this actor a real, verified hod of some department," which
  // staffService.inviteStaff itself enforces (throws
  // StaffInvitationNotAuthorizedError otherwise) — same "the service is
  // the gate, not requireRole" reasoning submit-registration/deactivate
  // below already use.
  router.post('/staff/invitations', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const invitation = await staffService.inviteStaff(
        req.dbClient,
        { email: (req.body || {}).email },
        { actorUserId: identityService.resolveActorUserId(req.capabilities), collegeId: req.collegeId },
      );
      res.status(201).json({
        id: invitation.id, college_id: invitation.college_id, department_id: invitation.department_id, email: invitation.email, expires_at: invitation.expires_at,
      });
    } catch (err) {
      if (mapStaffServiceError(err, res)) return;
      throw err;
    }
  }));

  router.post('/staff/hod-accounts', requirePermission('staff.hod_accounts.create'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const { username, email } = req.body || {};
      const result = await staffService.provisionHodAccount(
        req.dbClient,
        {
          collegeId: req.collegeId,
          username,
          email,
          ...bodyToServiceFields(req.body || {}),
        },
        { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.status(201).json({
        user_id: result.user.id,
        staff_id: result.staff.id,
        college_id: result.staff.college_id,
        username: result.user.username,
        email: result.user.email,
        role: result.user.role,
        staff_code: result.staff.staff_code,
        department_id: result.staff.department_id,
      });
    } catch (err) {
      if (mapStaffServiceError(err, res)) return;
      throw err;
    }
  }));

  // "My Profile" self-service (UAT Priority 1 #4). Registered before
  // GET/PUT /staff/:id so Express never matches the literal path
  // segment "me" as a :id — order-sensitive, same reasoning
  // classes.js's /substitute-assignments/mine comment gives.
  router.get('/staff/me', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const staff = await staffService.getOwnProfile(req.dbClient, { userId: identityService.resolveActorUserId(req.capabilities) });
      res.json(staff);
    } catch (err) {
      if (mapStaffServiceError(err, res)) return;
      throw err;
    }
  }));

  router.put('/staff/me', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const staff = await staffService.updateOwnProfile(
        req.dbClient,
        bodyToFields(req.body || {}, SELF_SERVICE_BODY_FIELDS),
        { userId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.json(staff);
    } catch (err) {
      if (mapStaffServiceError(err, res)) return;
      throw err;
    }
  }));

  // RS-STF-014 (ADL-030) — self-only phone OTP, mirrors
  // /students/:id/phone-verification/otp|verify's shape exactly, minus
  // the `target` field (staff has one phone, not phone+parent_phone).
  router.post('/staff/me/phone-verification/otp', requireAuth, otpRequestLimiter, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const result = await staffPhoneVerificationService.requestOtp(
        req.dbClient, { userId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.status(201).json(result);
    } catch (err) {
      if (mapStaffPhoneVerificationServiceError(err, res)) return;
      throw err;
    }
  }));

  router.post('/staff/me/phone-verification/verify', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const staff = await staffPhoneVerificationService.verifyOtp(
        req.dbClient, { userId: identityService.resolveActorUserId(req.capabilities) }, (req.body || {}).code,
      );
      res.json(staff);
    } catch (err) {
      if (mapStaffPhoneVerificationServiceError(err, res)) return;
      throw err;
    }
  }));

  // "Previous institutions" (ADL-030 follow-up, frontend redesign
  // handoff §3) — self-only repeatable list, same registration-order
  // reasoning as /staff/me above (no :id segment to collide with).
  router.get('/staff/me/work-history', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const entries = await staffWorkHistoryService.listOwnWorkHistory(
        req.dbClient, { userId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.json(entries);
    } catch (err) {
      if (mapStaffWorkHistoryServiceError(err, res)) return;
      throw err;
    }
  }));

  router.post('/staff/me/work-history', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const body = req.body || {};
      const entry = await staffWorkHistoryService.addOwnWorkHistoryEntry(
        req.dbClient,
        {
          institutionName: body.institution_name,
          designationHeld: body.designation_held,
          fromDate: body.from_date,
          toDate: body.to_date,
        },
        { userId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.status(201).json(entry);
    } catch (err) {
      if (mapStaffWorkHistoryServiceError(err, res)) return;
      throw err;
    }
  }));

  router.delete('/staff/me/work-history/:entryId', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      await staffWorkHistoryService.removeOwnWorkHistoryEntry(
        req.dbClient, req.params.entryId, { userId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.status(204).end();
    } catch (err) {
      if (mapStaffWorkHistoryServiceError(err, res)) return;
      throw err;
    }
  }));

  // requireAuth gates "must be logged in"; the real scope (self, hod of
  // the target's own department, principal college-wide — this
  // session's own task) is visibilityService.assertCanViewStaff's job.
  router.get('/staff/:id', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    let staff;
    try {
      staff = await visibilityService.assertCanViewStaff(req.dbClient, { staffId: req.params.id }, {
        actorUserId: identityService.resolveActorUserId(req.capabilities), actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
      });
    } catch (err) {
      if (mapStaffServiceError(err, res)) return;
      throw err;
    }
    if (staff === null) {
      res.status(404).json({ detail: `No staff found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.json(staff);
  }));

  // limit/offset are passed through as-is — staffService/
  // staffRepository already default them to 50/0, not re-implemented
  // here. Scoped by role (this session's own task: this route used to
  // return the whole college's staff directory to anyone
  // authenticated): principal sees the whole college, hod sees their
  // own (real, verified) department, ordinary staff see only their own
  // profile.
  router.get('/staff', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { limit: rawLimit, offset: rawOffset } = req.query;
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    const offset = rawOffset === undefined ? 0 : Number(rawOffset);
    const actorRole = req.jwtClaims.role || req.capabilities.effectiveRole;
    const actorUserId = identityService.resolveActorUserId(req.capabilities);

    if (actorRole === 'principal') {
      const staff = await staffService.listStaff(req.dbClient, { limit, offset, collegeId: req.collegeId });
      res.json(staff);
      return;
    }
    if (actorRole === 'hod') {
      const departmentId = await staffService.findHodDepartmentId(req.dbClient, req.collegeId, actorUserId);
      if (departmentId === null) {
        res.json([]);
        return;
      }
      const all = await staffService.listStaffByDepartment(req.dbClient, departmentId, req.collegeId);
      res.json(all.slice(offset, offset + limit));
      return;
    }
    // RS-STF-015 (ADL-030): ordinary staff/class_tutor now sees a
    // limited-field directory of every colleague, not just themselves —
    // a distinct, narrower shape than the principal/hod branches above,
    // never the full row.
    const directory = await staffService.listStaffDirectory(req.dbClient, req.collegeId);
    res.json(directory);
  }));

  router.put('/staff/:id', requirePermission('staff.update'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const staff = await staffService.updateStaff(
        req.dbClient,
        req.params.id,
        bodyToServiceFields(req.body || {}),
        { userId: identityService.resolveActorUserId(req.capabilities) },
      );
      if (staff === null) {
        res.status(404).json({ detail: `No staff found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.json(staff);
    } catch (err) {
      if (mapStaffServiceError(err, res)) return;
      throw err;
    }
  }));

  // Module 8 final slice: submitStaffRegistration was built (Module 8
  // first/third slices) but never wired to a route — a staff profile
  // created above has no way to actually enter the real
  // Faculty->HOD->Principal chain. This is that trigger point.
  //
  // requireAuth, deliberately NOT the principal-mapped permission gate
  // create/update above use: BusinessRules.md names a real actor for
  // this one action ("Faculty submits"), unlike create/update which
  // have no named actor and so fall back to this router's conservative
  // default. Gating submission to principal-only would actively
  // break the feature for the common single-principal-per-college
  // case — requestedByUserId would equal the Principal's own user_id,
  // which is also the resolved final-step approver in every chain
  // (findPrincipal), so ADR-005's self-approval rule would reject
  // every single submission at the terminal step. workflowService's
  // own step-matching + self-approval checks are the real gate here
  // (same "the service is the gate, not requireRole" reasoning
  // attendance.js's router comment already gives for
  // AttendanceForbiddenError), not this route's RBAC.
  router.post('/staff/:id/submit-registration', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const workflowRequest = await staffService.submitStaffRegistration(
        req.dbClient,
        req.params.id,
        { requestedByUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.status(201).json(workflowRequest);
    } catch (err) {
      if (mapStaffServiceError(err, res)) return;
      throw err;
    }
  }));

  // requireAuth, not requirePermission: RS-STF-005 names a real,
  // per-row actor ("L3, own department only"), which requirePermission's
  // role-only gate can't express — same "the service is the gate, not
  // requireRole" reasoning attendance.js's router comment gives for
  // AttendanceForbiddenError. staffService.deactivateStaff itself
  // verifies actorUserId is the real, verified hod of the target's own
  // department (D16, fixed 2026-07-25) and throws
  // StaffDeactivationNotAuthorizedError otherwise — the per-row check
  // this comment used to flag as missing.
  router.post('/staff/:id/deactivate', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const result = await staffService.deactivateStaff(req.dbClient, req.params.id, { actorUserId: identityService.resolveActorUserId(req.capabilities) });
      res.json(result);
    } catch (err) {
      if (mapStaffServiceError(err, res)) return;
      throw err;
    }
  }));

  router.delete('/staff/:id', requirePermission('staff.delete'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const staff = await staffService.removeStaff(req.dbClient, req.params.id, { userId: identityService.resolveActorUserId(req.capabilities) });
    if (staff === null) {
      res.status(404).json({ detail: `No staff found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.status(204).end();
  }));

  return router;
}

module.exports = createStaffRouter;
