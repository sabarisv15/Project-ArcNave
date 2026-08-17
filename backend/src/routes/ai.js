'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/rbac');
const aiToolRegistry = require('../services/aiToolRegistry');
const aiService = require('../services/aiService');
const aiProviders = require('../services/aiProviders');
const notificationService = require('../services/notificationService');
const assessmentService = require('../services/assessmentService');
const calendarService = require('../services/calendarService');
const financeService = require('../services/financeService');
const staffService = require('../services/staffService');
const studentService = require('../services/studentService');
const academicService = require('../services/academicService');
const workflowService = require('../services/workflowService');
const attendanceService = require('../services/attendanceService');
const projectService = require('../services/projectService');
const { IdentifierResolutionError } = require('../identifierResolution');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// Phase 3 (AI Identity Context Integration) — the one normalized shape
// every AI consumer reads generically from here down, regardless of
// which resolver populated req.capabilities (resolveCapabilities,
// Personal Identity Context; resolveCapabilitiesForPosition,
// Institutional Identity Context — ADR-023). No branch here on which
// one ran; every field below is read the same way either way.
//
// userId: resolveCapabilities returns it at the top level;
// resolveCapabilitiesForPosition doesn't (a Position Account token's
// own claims.sub is the position_account_id, never a userId — ADR-023)
// but returns currentOccupantUserId instead, the real human behind
// that seat right now — that's the correct "who is actually asking"
// value for a Position Account session, not the account id itself.
//
// departmentId (singular) feeds assertPolicyAllows's existing
// departmentScoped exact-match check (a tool requiring the caller's
// own single department to equal a requested one) — set only when
// scope is exactly one department (true for any HOD or Class Tutor
// position), null otherwise; departmentIds/classIds (plural) are the
// general-purpose scope fields prompt context and future tool-scoping
// read.
function buildAiIdentityContext(req) {
  const capabilities = req.capabilities || {};
  const departmentIds = capabilities.departmentIds || [];
  const classIds = capabilities.assignedClassIds || capabilities.classIds || [];
  return {
    userId: capabilities.userId || capabilities.currentOccupantUserId || null,
    role: capabilities.effectiveRole,
    collegeId: req.collegeId,
    departmentIds,
    departmentId: departmentIds.length === 1 ? departmentIds[0] : null,
    classIds,
    scopeLevel: capabilities.scopeLevel || null,
    positionAccountId: capabilities.positionAccountId || null,
  };
}

// Each Policy Gate error gets its own HTTP mapping so a caller (and a
// test) can tell rejections apart, same distinction
// aiToolRegistry.js's own file comment argues for at the error-class
// level: 404 for a name that doesn't exist at all, 409 for a real tool
// this pipeline structurally can't run yet (L2/L3), 403 for every
// actor-vs-tool authorization mismatch.
function mapAiToolError(err, res) {
  if (err instanceof aiToolRegistry.AiToolNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof aiToolRegistry.AiToolLevelNotSupportedError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (
    err instanceof aiToolRegistry.AiToolTenantMismatchError
    || err instanceof aiToolRegistry.AiToolRoleNotPermittedError
    || err instanceof aiToolRegistry.AiToolDataClassificationError
    || err instanceof aiToolRegistry.AiToolDepartmentScopeError
  ) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof aiService.AiServiceValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  // UAT finding: a live LLM call omitting a tool's own required
  // parameter (or sending it as an empty/placeholder value) previously
  // reached the Business Service unvalidated and crashed as an
  // unhandled 500 — aiToolRegistry.invokeTool now validates against
  // the tool's own declared JSON schema before calling the handler,
  // same "untrusted input, validate before use" reasoning as
  // AiServiceValidationError above.
  if (err instanceof aiToolRegistry.AiToolInvalidParamsError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  // A tool's own resolveXId helper (studentService.resolveStudentId,
  // staffService.resolveStaffId, academicService.resolveClassId,
  // assessmentService.resolveAssessmentTypeId) couldn't match a
  // caller-supplied identifier (a roll number, staff code, class
  // name, or assessment type name) to a real row in this college —
  // a clean 400, never a raw Postgres uuid-cast crash reaching the
  // client as a 500 (the AI Copilot UAT finding this exists to fix).
  if (err instanceof IdentifierResolutionError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  // 503, not 500: an unconfigured LLM provider isn't a bug in this
  // request, it's a real, expected environment state (see config.js's
  // own comment on config.nim) — same "no SMTP_HOST means a stub, not
  // a crash" reasoning notificationService.js already established,
  // just surfaced here as an honest error instead of a silent stub
  // because an "ask" genuinely has no answer to give without one.
  if (err instanceof aiProviders.LlmNotConfiguredError) {
    res.status(503).json({ detail: err.message });
    return true;
  }
  // 502: the provider itself is configured and reachable in principle,
  // but this particular call failed upstream — a Bad Gateway, not this
  // server's own fault.
  if (err instanceof aiProviders.LlmRequestError) {
    res.status(502).json({ detail: err.message });
    return true;
  }
  // A college's configured provider genuinely can't do what was asked
  // (e.g. claude has no embeddings endpoint) — a real vendor
  // limitation, not this server's bug and not the caller's mistake.
  if (err instanceof aiProviders.AiProviderCapabilityError) {
    res.status(503).json({ detail: err.message });
    return true;
  }
  // draft_notification/request_notification_send wrap notificationService
  // directly (CLAUDE.md rule 1 — a thin wrapper over a Business
  // Service, no second error-mapping layer of its own) — its domain
  // errors surface here the same way aiToolRegistry's/llmProvider's do,
  // same mapping routes/workflowRequests.js already uses for this
  // exact set of classes.
  if (err instanceof notificationService.NotificationValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof notificationService.NotificationNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (
    err instanceof notificationService.NotificationNoPendingRequestError
    || err instanceof notificationService.NotificationNotApprovedError
  ) {
    res.status(409).json({ detail: err.message });
    return true;
  }

  // Role-aware ERP Copilot tools (this slice) — each wraps an existing
  // Business Service directly (no second error-mapping layer of its
  // own, same reasoning as the notification tools above), so their
  // domain errors surface here the same way. assertIsAssignedFaculty/
  // assertCanModifyStudent failures are 403 (role-permitted but
  // scope-denied), matching the Policy Gate's own 403s above for the
  // same reason — an authenticated, permitted caller reaching for
  // something outside their own scope.
  if (
    err instanceof assessmentService.AssessmentMarkValidationError
    || err instanceof calendarService.CalendarEventValidationError
    || err instanceof financeService.FeePaymentValidationError
    || err instanceof financeService.FeePaymentStatusError
    || err instanceof financeService.FeeCorrectionValidationError
    || err instanceof staffService.StaffValidationError
    || err instanceof studentService.StudentTransferValidationError
    || err instanceof studentService.StudentLifecycleValidationError
    || err instanceof academicService.ClassValidationError
    || err instanceof workflowService.WorkflowRequestValidationError
    || err instanceof projectService.ProjectValidationError
    // UAT finding: attendanceService's own error classes (mark_attendance_nl's
    // Business Service) were never registered here at all — every one of
    // its errors fell through to an unhandled 500 instead of the same
    // clean mapping routes/attendance.js's own mapAttendanceServiceError
    // already gives a human caller of the equivalent action. Statuses
    // below match that existing mapper exactly, not a new convention.
    || err instanceof attendanceService.AttendanceValidationError
    || err instanceof attendanceService.AttendanceCorrectionValidationError
  ) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (
    err instanceof assessmentService.AssessmentMarkNotAssignedFacultyError
    || err instanceof studentService.StudentNotAuthorizedError
    || err instanceof attendanceService.AttendanceForbiddenError
    || err instanceof financeService.FeePaymentNotAuthorizedError
    || err instanceof projectService.ProjectForbiddenError
  ) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (
    err instanceof assessmentService.AssessmentMarkClassNotFoundError
    || err instanceof calendarService.CalendarEventNotFoundError
    || err instanceof financeService.FeePaymentStudentNotFoundError
    || err instanceof financeService.FeePaymentDocumentNotFoundError
    || err instanceof financeService.FeeCorrectionNotFoundError
    || err instanceof staffService.StaffNotFoundError
    || err instanceof staffService.StaffDepartmentNotFoundError
    || err instanceof staffService.StaffHodNotFoundError
    || err instanceof staffService.StaffPrincipalNotFoundError
    || err instanceof studentService.StudentClassNotFoundError
    || err instanceof studentService.StudentTransferStudentNotFoundError
    || err instanceof studentService.StudentTransferClassNotFoundError
    || err instanceof studentService.StudentLifecycleStudentNotFoundError
    || err instanceof attendanceService.AttendanceClassNotFoundError
    || err instanceof attendanceService.AttendanceSessionNotFoundError
    || err instanceof attendanceService.AttendanceCorrectionNotFoundError
    || err instanceof projectService.ProjectNotFoundError
  ) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (
    err instanceof financeService.FeePaymentConflictError
    || err instanceof financeService.FeePaymentAlreadyMarkedError
    || err instanceof financeService.FeeCorrectionNoPendingRequestError
    || err instanceof staffService.StaffCodeConflictError
    || err instanceof studentService.StudentRollNoConflictError
    || err instanceof studentService.StudentLifecycleApprovalRequiredError
    || err instanceof workflowService.WorkflowRequestConflictError
    || err instanceof attendanceService.AttendanceTimetableNotApprovedError
    || err instanceof attendanceService.AttendanceLockedError
    || err instanceof attendanceService.AttendanceSessionConflictError
    || err instanceof attendanceService.AttendanceNotLockedError
    || err instanceof attendanceService.AttendanceCorrectionNoPendingRequestError
    || err instanceof projectService.ProjectDocumentAlreadyAttachedError
    // No active teaching session right now is the same "actor/resource
    // isn't in a state that allows this action right now" semantics
    // AttendanceTimetableNotApprovedError/AttendanceLockedError already
    // use 409 for above — mark_attendance_nl-only (the human dashboard's
    // own attendance route never resolves "current session" implicitly,
    // so this exact class has no prior mapping anywhere to match against).
    || err instanceof attendanceService.AttendanceNoActiveSessionError
  ) {
    res.status(409).json({ detail: err.message });
    return true;
  }

  return false;
}

function createAiRouter() {
  const router = express.Router();

  // requireAuth, not a role gate — the Policy Gate inside
  // aiToolRegistry.js is the real per-tool authorization boundary (same
  // "the service is the gate" reasoning routes/workflowRequests.js's
  // own router comment gives for GET /workflow-requests/pending), not
  // this route. Listing tool names/descriptions carries no
  // classification risk of its own; invoking one is what the gate below
  // actually protects.
  router.get('/ai/tools', requireAuth, asyncHandler(async (req, res) => {
    res.json(aiService.listTools());
  }));

  // An optional body.question turns this into the full Tool Registry
  // -> ... -> LLM pipeline (aiService.askAboutTool); omitting it keeps
  // today's behavior exactly (aiService.invokeTool, stops at the
  // sanitized context blob) — one route, not two, and every existing
  // caller/test that never sends `question` is unaffected.
  router.post('/ai/tools/:name/invoke', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const identityContext = buildAiIdentityContext(req);
    const params = (req.body || {}).params || {};
    const question = (req.body || {}).question;
    try {
      const result = question !== undefined
        ? await aiService.askAboutTool(req.dbClient, req.params.name, params, question, { identityContext })
        : await aiService.invokeTool(req.dbClient, req.params.name, params, { identityContext });
      res.json(result);
    } catch (err) {
      if (mapAiToolError(err, res)) return;
      throw err;
    }
  }));

  // Tool-selection entry point: body {question}, no toolName — the LLM
  // picks a tool (or none) from aiService.askAgent's own registry list.
  // Same error mapping as /invoke below; the Policy Gate re-validating
  // whatever the LLM picked surfaces through the exact same
  // aiToolRegistry.* error classes (a hallucinated tool name -> 404,
  // same as any caller naming a bad tool would get).
  // focusContext (optional { entityType, id }) — the Workspace Focus
  // hint from WorkspaceContext (frontend), forwarded as-is. See
  // aiService.js's askAgent/buildFocusHint for how it's used: purely a
  // prompt-wording hint, never stored, never a session/history.
  //
  // project_id (optional, Step 6/Approved Spec §12) — never trusted as
  // raw hint text from the client (unlike focusContext): resolved
  // server-side through projectService's own ownership check, same as
  // every other project route, so a caller can never inject another
  // user's project id/instructions into their own conversation. On any
  // failure (missing, not owned, doesn't exist) this silently degrades
  // to "no project context" rather than failing the whole ask — the
  // same graceful-hint behavior buildFocusHint already has for bad
  // focusContext input.
  router.post('/ai/ask', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const identityContext = buildAiIdentityContext(req);
    const { question, focusContext, project_id: projectId } = req.body || {};
    let projectContext;
    if (projectId) {
      try {
        const projects = await projectService.listOwnProjects(req.dbClient, { userId: identityContext.userId });
        const project = projects.find((p) => p.id === projectId);
        if (project) projectContext = { id: project.id, instructions: project.instructions };
      } catch {
        // graceful degrade — see comment above
      }
    }
    try {
      const result = await aiService.askAgent(req.dbClient, question, { identityContext, focusContext, projectContext });
      res.json(result);
    } catch (err) {
      if (mapAiToolError(err, res)) return;
      throw err;
    }
  }));

  return router;
}

module.exports = createAiRouter;
