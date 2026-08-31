'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const { createUserScopedRateLimiter } = require('../middleware/rateLimit');
const studentService = require('../services/studentService');
const phoneVerificationService = require('../services/phoneVerificationService');
const workflowService = require('../services/workflowService');
const staffService = require('../services/staffService');
const workflowChainService = require('../services/workflowChainService');
const attendanceService = require('../services/attendanceService');
const financeService = require('../services/financeService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// snake_case <-> camelCase translation lives here, not in a shared
// util, because this is the only file that needs it so far.
// StudentEditorModal.jsx (the frontend this module will eventually
// repoint) already POSTs snake_case matching the DB columns directly
// (see its handleSave) — translating at this boundary, once, keeps
// the later UI-repoint slice a URL/fetch-path change, not a
// payload-reshaping one. college_id is deliberately absent from this
// map: it comes from req.collegeId, never the request body.
const STUDENT_BODY_FIELDS = [
  ['roll_no', 'rollNo'],
  ['full_name', 'fullName'],
  ['gender', 'gender'],
  ['entry_type', 'entryType'],
  ['emis_number', 'emisNumber'],
  ['umis_number', 'umisNumber'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['phone_verified', 'phoneVerified'],
  ['parent_name', 'parentName'],
  ['parent_phone', 'parentPhone'],
  ['parent_phone_verified', 'parentPhoneVerified'],
  ['address', 'address'],
  ['pincode', 'pincode'],
  ['mark_10th', 'mark10th'],
  ['mark_12th', 'mark12th'],
  ['mark_iti', 'markIti'],
  ['accommodation', 'accommodation'],
  ['club', 'club'],
  ['internship', 'internship'],
  ['career_plan', 'careerPlan'],
  ['notes', 'notes'],
  ['license_number', 'licenseNumber'],
  ['bike_number', 'bikeNumber'],
  ['annual_income', 'annualIncome'],
  ['class_id', 'classId'],
  // Create Student (AI-first admission) — regulation_id/current_semester
  // are mapped here for POST /students only in practice: createStudent
  // picks them up as initial-value-only fields (CREATE_ONLY_FIELDS,
  // studentService.js's own comment), while updateStudent's shared
  // pickStudentFields silently drops them (not in ALLOWED_FIELDS), same
  // as any other unrecognized field — no route-level split needed.
  ['regulation_id', 'regulationId'],
  ['current_semester', 'currentSemester'],
  ['dob', 'dob'],
  ['blood_group', 'bloodGroup'],
  ['nationality', 'nationality'],
  ['section', 'section'],
  ['batch', 'batch'],
  ['admission_year', 'admissionYear'],
  ['register_number', 'registerNumber'],
  ['academic_year_id', 'academicYearId'],
  ['school_name', 'schoolName'],
  ['school_type', 'schoolType'],
  ['education_board', 'educationBoard'],
  ['previous_qualification', 'previousQualification'],
  ['passing_year', 'passingYear'],
  ['community', 'community'],
  ['community_cert_number', 'communityCertNumber'],
  ['bank_account_holder_name', 'bankAccountHolderName'],
  ['bank_name', 'bankName'],
  ['bank_branch', 'bankBranch'],
  ['bank_account_number', 'bankAccountNumber'],
  ['bank_ifsc_code', 'bankIfscCode'],
  ['bank_account_type', 'bankAccountType'],
];

function bodyToServiceFields(body) {
  const fields = {};
  for (const [snakeKey, camelKey] of STUDENT_BODY_FIELDS) {
    if (body[snakeKey] !== undefined) {
      fields[camelKey] = body[snakeKey];
    }
  }
  return fields;
}

// Response bodies are NOT translated back to camelCase — this returns
// studentRepository's native row shape (snake_case, since that's what
// Postgres returns) as-is. Picked over a reverse-translation step
// because it's strictly less code here, and StudentEditorModal.jsx
// already expects snake_case field names throughout, matching what
// this returns without any further reshaping at repoint time either.

function mapStudentServiceError(err, res) {
  if (err instanceof studentService.StudentValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentRollNoConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentNotClassTutorError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentClassMismatchError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentClassNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentNotAuthorizedError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentFlagValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentFlagStudentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentFlagNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentSemesterResultValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentSemesterResultStudentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentTransferValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentTransferStudentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentTransferClassNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentTransferNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentTransferNoPendingRequestError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentLifecycleValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentLifecycleStudentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentLifecycleApprovalRequiredError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentLifecycleNoPendingRequestError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffPrincipalNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowChainService.WorkflowChainMissingContextError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowChainService.WorkflowChainFloorViolationError) {
    res.status(409).json({ detail: err.message });
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

function mapPhoneVerificationServiceError(err, res) {
  if (err instanceof phoneVerificationService.PhoneVerificationValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof phoneVerificationService.PhoneVerificationStudentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof phoneVerificationService.PhoneVerificationNoPhoneOnFileError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof phoneVerificationService.PhoneVerificationNotRequestedError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof phoneVerificationService.PhoneVerificationMaxAttemptsExceededError) {
    res.status(429).json({ detail: err.message });
    return true;
  }
  if (err instanceof phoneVerificationService.PhoneVerificationCodeMismatchError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentNotAuthorizedError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  return false;
}

function createStudentsRouter() {
  const router = express.Router();

  // OTP-request brute-force protection — config.js's own `otp` comment
  // flags this as a known, previously-unsolved gap. Keyed on the
  // already-authenticated actor's own userId (requireAuth runs first),
  // not on the student/target phone — see middleware/rateLimit.js.
  const otpRequestLimiter = createUserScopedRateLimiter((req) => identityService.resolveActorUserId(req.capabilities));

  // POST/PUT/DELETE /students: requirePermission maps each to the
  // roles that can EVER qualify (['staff'] for create; ['staff', 'hod',
  // 'principal'] for update/delete — middleware/permissions.js). The
  // real scope check — tutor -> own class, hod -> own department,
  // principal -> own college — is studentService's job
  // (createStudent/assertCanModifyStudent), resolved from real
  // classes.tutor_user_id/staff role assignments, never trusted from
  // the role claim alone. req.jwtClaims.role is passed through as
  // actorRole for exactly that resolution — it is itself trustworthy
  // (auth middleware already verified the JWT signature before this
  // route ever runs), just not sufficient on its own. Any authenticated
  // tenant user may still read.

  router.post(
    '/students',
    requirePermission('students.create'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const student = await studentService.createStudent(req.dbClient, {
          collegeId: req.collegeId,
          userId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
          ...bodyToServiceFields(req.body || {}),
        });
        res.status(201).json(student);
      } catch (err) {
        if (mapStudentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // GET /students/:id and GET /students are now tutor(own class)/
  // hod(own department)/principal(own college)-scoped (this session's
  // own task) — requireAuth still gates "must be logged in"; the real
  // scope is studentService's job (getStudent/listStudents), same
  // split students.update/delete already established.
  router.get(
    '/students/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const student = await studentService.getStudent(req.dbClient, req.params.id, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
        });
        if (student === null) {
          res.status(404).json({ detail: `No student found with id ${JSON.stringify(req.params.id)}` });
          return;
        }
        res.json(student);
      } catch (err) {
        if (mapStudentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // limit/offset are passed through as-is — studentService/
  // studentRepository already default them to 50/0, not
  // re-implemented here.
  router.get(
    '/students',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { limit: rawLimit, offset: rawOffset } = req.query;
      const students = await studentService.listStudents(
        req.dbClient,
        {
          limit: rawLimit === undefined ? undefined : Number(rawLimit),
          offset: rawOffset === undefined ? undefined : Number(rawOffset),
        },
        {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
          collegeId: req.collegeId,
        },
      );

      // Students List page's Attendance %/Fee Status columns — composed
      // here, not inside studentService.listStudents, because both
      // AttendanceService and FinanceService already depend upward on
      // StudentService (see their own file-level comments); calling
      // back down from StudentService would be a circular require. Route
      // handlers may freely call multiple services, so the composition
      // happens here instead. Presentation-only: neither field is ever
      // accepted back on create/update (not in studentService's own
      // ALLOWED_FIELDS), and this is the only place either gets attached.
      const studentRefs = students.map((student) => ({ id: student.id, classId: student.class_id }));
      const [attendanceByStudentId, feeStatusByStudentId, backlogCountByStudentId] = await Promise.all([
        attendanceService.computeAttendancePercentageForStudents(req.dbClient, studentRefs),
        financeService.computeFeeStatusForStudents(req.dbClient, studentRefs),
        studentService.computeBacklogCountForStudents(req.dbClient, studentRefs),
      ]);
      const enriched = students.map((student) => ({
        ...student,
        attendance_percentage: attendanceByStudentId.get(student.id) ?? null,
        fee_status: feeStatusByStudentId.get(student.id) ?? 'no_fees',
        backlog_count: backlogCountByStudentId.get(student.id) ?? 0,
      }));

      res.json(enriched);
    }),
  );

  router.put(
    '/students/:id',
    requirePermission('students.update'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const student = await studentService.updateStudent(
          req.dbClient,
          req.params.id,
          bodyToServiceFields(req.body || {}),
          {
            userId: identityService.resolveActorUserId(req.capabilities),
            actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
          },
        );
        if (student === null) {
          res.status(404).json({ detail: `No student found with id ${JSON.stringify(req.params.id)}` });
          return;
        }
        res.json(student);
      } catch (err) {
        if (mapStudentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.delete(
    '/students/:id',
    requirePermission('students.delete'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const student = await studentService.removeStudent(req.dbClient, req.params.id, {
          userId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
        });
        if (student === null) {
          res.status(404).json({ detail: `No student found with id ${JSON.stringify(req.params.id)}` });
          return;
        }
        res.status(204).end();
      } catch (err) {
        if (mapStudentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // requireAuth, not requirePermission: BusinessRules.md names no
  // specific submitter for a transfer request — same conservative
  // default other un-named-actor submit actions in this codebase use
  // (staff.js's own submit-registration route). transfer_type
  // ('internal' | 'inter_college') selects which service function
  // actually runs; body shape differs slightly between the two (see
  // studentService's own comment on why inter_college never touches
  // another tenant).
  router.post(
    '/students/:id/transfer-requests',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const {
        transfer_type: transferType,
        destination_class_id: destinationClassId,
        destination_college_id: destinationCollegeId,
        reason,
      } = req.body || {};
      try {
        let result;
        if (transferType === 'inter_college') {
          result = await studentService.requestInterCollegeTransfer(
            req.dbClient,
            req.params.id,
            { destinationCollegeId, reason },
            { requestedByUserId: identityService.resolveActorUserId(req.capabilities) },
          );
        } else {
          result = await studentService.requestInternalTransfer(
            req.dbClient,
            req.params.id,
            { destinationClassId, reason },
            { requestedByUserId: identityService.resolveActorUserId(req.capabilities) },
          );
        }
        res.status(201).json(result);
      } catch (err) {
        if (mapStudentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/students/:id/transfer-requests',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const requests = await studentService.listTransferRequestsForStudent(req.dbClient, req.params.id);
      res.json(requests);
    }),
  );

  router.post(
    '/students/:id/transfer-requests/:transferRequestId/approve',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const result = await studentService.approveStudentTransfer(
          req.dbClient,
          req.params.id,
          req.params.transferRequestId,
          { actorUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.json(result);
      } catch (err) {
        if (mapStudentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/students/:id/transfer-requests/:transferRequestId/reject',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const result = await studentService.rejectStudentTransfer(
          req.dbClient,
          req.params.id,
          req.params.transferRequestId,
          { actorUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.json(result);
      } catch (err) {
        if (mapStudentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // Student flag (UAT discovery, Class Tutor dashboard, 2026-07-26) —
  // requireAuth only, not requirePermission: studentService.
  // assertCanModifyStudent is the real gate (same boundary as editing
  // the student), same "the service is the gate" split every other
  // student-scoped write route in this file already uses.
  router.post(
    '/students/:id/flag',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const flag = await studentService.flagStudent(
          req.dbClient,
          req.params.id,
          { remark: (req.body || {}).remark },
          {
            actorUserId: identityService.resolveActorUserId(req.capabilities),
            actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
          },
        );
        res.status(201).json(flag);
      } catch (err) {
        if (mapStudentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/students/:id/flag/clear',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const flag = await studentService.clearStudentFlag(req.dbClient, req.params.id, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
        });
        res.json(flag);
      } catch (err) {
        if (mapStudentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/students/:id/flag',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const flag = await studentService.getActiveFlag(req.dbClient, req.params.id, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
        });
        res.json(flag);
      } catch (err) {
        if (mapStudentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/students/:id/flag-history',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const history = await studentService.listFlagHistory(req.dbClient, req.params.id, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
        });
        res.json(history);
      } catch (err) {
        if (mapStudentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // Semester result (Students List redesign, 2026-07-30) — requireAuth
  // only, same "the service is the gate" split the flag routes above
  // already use: studentService.recordSemesterResult's own
  // assertCanModifyStudent call is the real authorization boundary.
  router.post(
    '/students/:id/semester-results',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const body = req.body || {};
        const row = await studentService.recordSemesterResult(
          req.dbClient,
          req.params.id,
          {
            academicYear: body.academic_year,
            semester: body.semester,
            subject: body.subject,
            resultStatus: body.result_status,
            documentId: body.document_id,
          },
          {
            actorUserId: identityService.resolveActorUserId(req.capabilities),
            actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
          },
        );
        res.status(201).json(row);
      } catch (err) {
        if (mapStudentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/students/:id/semester-results',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const rows = await studentService.listSemesterResultsForStudent(req.dbClient, req.params.id, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
        });
        res.json(rows);
      } catch (err) {
        if (mapStudentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // requireAuth, not requirePermission: BusinessRules.md names Class
  // Tutor as the actor for ordinary lifecycle changes but doesn't
  // narrow it further at the route layer — same conservative default
  // other un-named-scope actions in this router use. Rejects outright
  // (409, StudentLifecycleApprovalRequiredError) for any status that
  // actually requires approval, directing the caller to the request
  // endpoint below instead.
  router.post(
    '/students/:id/lifecycle-status',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { new_status: newStatus, reason, effective_date: effectiveDate } = req.body || {};
      try {
        const student = await studentService.updateStudentLifecycleStatus(
          req.dbClient,
          req.params.id,
          { newStatus, reason, effectiveDate },
          { actorUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.json(student);
      } catch (err) {
        if (mapStudentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/students/:id/lifecycle-status/request',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { new_status: newStatus, reason, effective_date: effectiveDate } = req.body || {};
      try {
        const result = await studentService.requestLifecycleStatusChange(
          req.dbClient,
          req.params.id,
          { newStatus, reason, effectiveDate },
          { requestedByUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.status(201).json(result);
      } catch (err) {
        if (mapStudentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/students/:id/lifecycle-status/approve',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { effective_date: effectiveDate } = req.body || {};
      try {
        const student = await studentService.approveLifecycleStatusChange(req.dbClient, req.params.id, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          effectiveDate,
        });
        res.json(student);
      } catch (err) {
        if (mapStudentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/students/:id/lifecycle-status/reject',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const student = await studentService.rejectLifecycleStatusChange(req.dbClient, req.params.id, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
        });
        res.json(student);
      } catch (err) {
        if (mapStudentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/students/:id/lifecycle-events',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const events = await studentService.listLifecycleEventsForStudent(req.dbClient, req.params.id);
      res.json(events);
    }),
  );

  router.get(
    '/students/:id/timeline',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const entries = await studentService.listTimelineForStudent(req.dbClient, req.params.id);
      res.json(entries);
    }),
  );

  // Phone OTP verification — requireAuth gates "must be logged in";
  // phoneVerificationService.requestOtp/verifyOtp enforce the real
  // tutor(own class)/hod(own department)/principal(own college) scope
  // (this session's own task, same boundary as reads/update/delete).
  router.post(
    '/students/:id/phone-verification/otp',
    requireAuth,
    otpRequestLimiter,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const result = await phoneVerificationService.requestOtp(req.dbClient, req.params.id, (req.body || {}).target, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
        });
        res.status(201).json(result);
      } catch (err) {
        if (mapPhoneVerificationServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/students/:id/phone-verification/verify',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const student = await phoneVerificationService.verifyOtp(
          req.dbClient,
          req.params.id,
          (req.body || {}).target,
          (req.body || {}).code,
          {
            actorUserId: identityService.resolveActorUserId(req.capabilities),
            actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
          },
        );
        res.json(student);
      } catch (err) {
        if (mapPhoneVerificationServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  return router;
}

module.exports = createStudentsRouter;
