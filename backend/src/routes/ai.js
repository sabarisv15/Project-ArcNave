'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/rbac');
const aiToolRegistry = require('../services/aiToolRegistry');
const aiService = require('../services/aiService');
const aiProviders = require('../services/aiProviders');
const conversationService = require('../services/conversationService');
const notificationService = require('../services/notificationService');
const webRetrievalService = require('../services/webRetrievalService');
const imageGenerationService = require('../services/imageGenerationService');
const assessmentService = require('../services/assessmentService');
const calendarService = require('../services/calendarService');
const financeService = require('../services/financeService');
const staffService = require('../services/staffService');
const studentService = require('../services/studentService');
const academicService = require('../services/academicService');
const workflowService = require('../services/workflowService');
const attendanceService = require('../services/attendanceService');
const projectService = require('../services/projectService');
const artifactService = require('../services/artifactService');
const documentService = require('../services/documentService');
const aiCostControlService = require('../services/aiCostControlService');
const aiThinkingDepthClassifier = require('../services/aiThinkingDepthClassifier');
const aiGuardrailService = require('../services/aiGuardrailService');
const auditLogRepository = require('../repositories/auditLogRepository');
const { IdentifierResolutionError } = require('../identifierResolution');

// CEO Vertex/Gemini audit #26 (2026-08-30) — "in AI Composer enable
// level switching let user decide". Frontend-facing labels
// (ThinkingLevelToggle.jsx) are deliberately decoupled from Gemini's own
// enum, same "label only, wire-level value is this codebase's own"
// precedent ScopeToggle.jsx already established for mode/'general'.
// MEDIUM/HIGH are NOT independently live-verified against the real
// Vertex endpoint — only LOW has been (gemini.js's own GENERATION_CONFIG
// comment) — this mapping is Google's documented enum shape, not a
// guess, but flagged here so a future reader doesn't assume it was
// re-probed.
const THINKING_LEVEL_BY_LABEL = { fast: 'LOW', balanced: 'MEDIUM', deep: 'HIGH' };
const DEFAULT_THINKING_LEVEL = 'fast';

// P3 1.11 — a label the user genuinely clicked (a real 'fast'/
// 'balanced'/'deep' string) is ALWAYS respected verbatim and never
// reaches the classifier below; only a missing/unset label (the
// composer's own `null` default, EMPTY_COMPOSER.thinkingLevel) falls
// through to aiThinkingDepthClassifier's difficulty-based guess. An
// unrecognized-but-present label (a bug, not "let auto decide") still
// falls back to DEFAULT_THINKING_LEVEL exactly as before — only a truly
// ABSENT label triggers auto-classification, so a malformed request
// never silently gets a different, unexpected escalation behavior.
function resolveThinkingLevel(label, question) {
  if (label === undefined || label === null || label === '') {
    const autoLabel = aiThinkingDepthClassifier.classifyThinkingDepth(question);
    return THINKING_LEVEL_BY_LABEL[autoLabel] || THINKING_LEVEL_BY_LABEL[DEFAULT_THINKING_LEVEL];
  }
  return THINKING_LEVEL_BY_LABEL[label] || THINKING_LEVEL_BY_LABEL[DEFAULT_THINKING_LEVEL];
}

// Short-session conversation memory (P0.1) — the outer ceiling on how
// many of the most recent messages are even fetched from the DB before
// aiService.buildHistoryHint applies the real, character-budget-based
// trim (ADL-047). This constant now only bounds query/memory cost, not
// how much context the model actually sees — a genuinely long
// conversation used to get chopped to exactly 20 messages regardless of
// their length (a real complaint: a short side-conversation could still
// push a much older, unfinished topic entirely out of the window). 200
// is generous headroom for that outer fetch; buildHistoryHint's own char
// budget is what actually governs prompt size now.
const HISTORY_MESSAGE_CEILING = 200;

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
    err instanceof aiToolRegistry.AiToolTenantMismatchError ||
    err instanceof aiToolRegistry.AiToolRoleNotPermittedError ||
    err instanceof aiToolRegistry.AiToolDataClassificationError ||
    err instanceof aiToolRegistry.AiToolDepartmentScopeError
  ) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof aiService.AiServiceValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  // A bounded-plan step count/shape/tool-name issue (P0.3) — same
  // category as AiServiceValidationError above, its own class only so
  // a caller/test can tell "bad question" apart from "bad plan."
  if (err instanceof aiService.AiWorkflowPlanValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  // 422, not 400 — the request is well-formed on its own, the problem
  // is specifically that this Idempotency-Key value was already used
  // for different params (see aiService.invokeToolIdempotent's own
  // comment).
  if (err instanceof aiService.AiIdempotencyKeyReusedError) {
    res.status(422).json({ detail: err.message });
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
  // Second optimization pass, finding #4: a bulk-capable tool's
  // estimated affected-row count exceeded its own hard safety ceiling
  // — a 400, same category as AiToolInvalidParamsError above (a
  // request the caller must narrow, not an authorization decision).
  if (err instanceof aiToolRegistry.AiToolBulkOperationRejectedError) {
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
  // own comment on config.gemini) — same "no SMTP_HOST means a stub, not
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
  // CEO Vertex/Gemini audit #42/C20/C21 (2026-08-30) — 429, the standard
  // HTTP code for both "you've used your allowance" and "slow down,"
  // never a 400 (the request itself is well-formed) or a 500 (this
  // isn't a bug). Both thrown by aiCostControlService.checkUsageLimits,
  // called once at the very top of askAgent, before any provider is
  // ever reached.
  if (
    err instanceof aiCostControlService.AiQuotaExceededError ||
    err instanceof aiCostControlService.AiRateLimitExceededError
  ) {
    res.status(429).json({ detail: err.message });
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
    err instanceof notificationService.NotificationNoPendingRequestError ||
    err instanceof notificationService.NotificationNotApprovedError
  ) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  // fetch_trusted_web_page (P2.3) — not-enabled/domain-not-allowed are
  // both "this request can't be served as configured," same 400
  // category as AiServiceValidationError above; a real upstream fetch
  // failure (timeout, non-2xx, oversized response) is 502, same
  // reasoning as aiProviders.LlmRequestError below (the vendor/site,
  // not this server, is at fault).
  if (
    err instanceof webRetrievalService.WebRetrievalNotEnabledError ||
    err instanceof webRetrievalService.WebRetrievalDomainNotAllowedError
  ) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof webRetrievalService.WebRetrievalRequestError) {
    res.status(502).json({ detail: err.message });
    return true;
  }
  // generate_image (RS-AIG-025) — same 400 category as the web-retrieval
  // not-enabled case just above: this college hasn't opted in, or the
  // prompt itself was invalid, either way "this request can't be served
  // as configured/asked," not a server or upstream-provider fault.
  if (
    err instanceof imageGenerationService.ImageGenerationNotEnabledError ||
    err instanceof imageGenerationService.ImageGenerationValidationError
  ) {
    res.status(400).json({ detail: err.message });
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
    err instanceof assessmentService.AssessmentMarkValidationError ||
    err instanceof calendarService.CalendarEventValidationError ||
    err instanceof financeService.FeePaymentValidationError ||
    err instanceof financeService.FeePaymentStatusError ||
    err instanceof financeService.FeeCorrectionValidationError ||
    err instanceof staffService.StaffValidationError ||
    err instanceof studentService.StudentTransferValidationError ||
    err instanceof studentService.StudentLifecycleValidationError ||
    err instanceof academicService.ClassValidationError ||
    err instanceof workflowService.WorkflowRequestValidationError ||
    err instanceof projectService.ProjectValidationError ||
    // UAT finding: attendanceService's own error classes (mark_attendance_nl's
    // Business Service) were never registered here at all — every one of
    // its errors fell through to an unhandled 500 instead of the same
    // clean mapping routes/attendance.js's own mapAttendanceServiceError
    // already gives a human caller of the equivalent action. Statuses
    // below match that existing mapper exactly, not a new convention.
    err instanceof attendanceService.AttendanceValidationError ||
    err instanceof attendanceService.AttendanceCorrectionValidationError ||
    // export_artifact/update_artifact_content (this session's own tools) —
    // never registered here until the live test that first exercised the
    // failure path caught it: artifactService's errors fell straight
    // through to an unhandled 500 (the frontend's own generic "Sorry, I
    // ran into a problem" fallback), same class of gap the
    // attendanceService UAT finding above already fixed once for a
    // different service.
    err instanceof artifactService.ArtifactValidationError ||
    // generate_document (this session's own tool) — same reasoning,
    // applied up front this time rather than found live: uploadDocument's
    // own required-field guard (documentService.js).
    err instanceof documentService.DocumentValidationError
  ) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (
    err instanceof assessmentService.AssessmentMarkNotAssignedFacultyError ||
    err instanceof studentService.StudentNotAuthorizedError ||
    err instanceof attendanceService.AttendanceForbiddenError ||
    err instanceof financeService.FeePaymentNotAuthorizedError ||
    err instanceof projectService.ProjectForbiddenError ||
    err instanceof artifactService.ArtifactForbiddenError
  ) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (
    err instanceof assessmentService.AssessmentMarkClassNotFoundError ||
    err instanceof calendarService.CalendarEventNotFoundError ||
    err instanceof financeService.FeePaymentStudentNotFoundError ||
    err instanceof financeService.FeePaymentDocumentNotFoundError ||
    err instanceof financeService.FeeCorrectionNotFoundError ||
    err instanceof staffService.StaffNotFoundError ||
    err instanceof staffService.StaffDepartmentNotFoundError ||
    err instanceof staffService.StaffHodNotFoundError ||
    err instanceof staffService.StaffPrincipalNotFoundError ||
    err instanceof studentService.StudentClassNotFoundError ||
    err instanceof studentService.StudentTransferStudentNotFoundError ||
    err instanceof studentService.StudentTransferClassNotFoundError ||
    err instanceof studentService.StudentLifecycleStudentNotFoundError ||
    err instanceof attendanceService.AttendanceClassNotFoundError ||
    err instanceof attendanceService.AttendanceSessionNotFoundError ||
    err instanceof attendanceService.AttendanceCorrectionNotFoundError ||
    err instanceof projectService.ProjectNotFoundError ||
    err instanceof artifactService.ArtifactNotFoundError
  ) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (
    err instanceof financeService.FeePaymentConflictError ||
    err instanceof financeService.FeePaymentAlreadyMarkedError ||
    err instanceof financeService.FeeCorrectionNoPendingRequestError ||
    err instanceof staffService.StaffCodeConflictError ||
    err instanceof studentService.StudentRollNoConflictError ||
    err instanceof studentService.StudentLifecycleApprovalRequiredError ||
    err instanceof workflowService.WorkflowRequestConflictError ||
    err instanceof attendanceService.AttendanceTimetableNotApprovedError ||
    err instanceof attendanceService.AttendanceLockedError ||
    err instanceof attendanceService.AttendanceSessionConflictError ||
    err instanceof attendanceService.AttendanceReMarkConflictError ||
    err instanceof attendanceService.AttendanceNotLockedError ||
    err instanceof attendanceService.AttendanceCorrectionNoPendingRequestError ||
    err instanceof projectService.ProjectDocumentAlreadyAttachedError ||
    // No active teaching session right now is the same "actor/resource
    // isn't in a state that allows this action right now" semantics
    // AttendanceTimetableNotApprovedError/AttendanceLockedError already
    // use 409 for above — mark_attendance_nl-only (the human dashboard's
    // own attendance route never resolves "current session" implicitly,
    // so this exact class has no prior mapping anywhere to match against).
    err instanceof attendanceService.AttendanceNoActiveSessionError ||
    // Same "actor/resource isn't in a state that allows this action right
    // now" semantics as AttendanceLockedError etc. above — a published
    // artifact is terminal (assertNotPublished, artifactService.js).
    err instanceof artifactService.ArtifactAlreadyPublishedError
  ) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  // generate_document (this session's own tool) — same 413 routes/documents.js
  // already uses for this exact class, not a new convention.
  if (err instanceof documentService.DocumentStorageQuotaExceededError) {
    res.status(413).json({ detail: err.message });
    return true;
  }

  return false;
}

// P3 4.9 — contract tests / schemas, same middleware/validate.js pattern
// routes/auth.js's /auth/login established. Every field below is
// deliberately OPTIONAL/permissive at this layer, never re-asserting a
// requiredness or format check the route/service already owns (e.g.
// `question` here vs. aiService.askAgent's own AiServiceValidationError
// message) — validate.js's own comment is explicit that duplicating
// business validation risks changing an already-tested error shape.
// These schemas exist to (a) document the real accepted wire shape in
// generated OpenAPI (routes/openapi.js) and (b) turn a genuinely
// wrong-typed field (e.g. `question` sent as a number) into a clean 400
// instead of whatever undefined behavior a raw type mismatch produces
// downstream — never to narrow what a currently-valid request already
// gets accepted.
const invokeToolParamsSchema = z.object({
  params: z.object({ name: z.string() }),
  body: z.object({ params: z.record(z.string(), z.any()).optional(), question: z.string().optional() }).optional(),
});

const askSchema = z.object({
  body: z
    .object({
      question: z.string().optional(),
      focusContext: z.object({ entityType: z.string().optional(), id: z.string().optional() }).optional(),
      project_id: z.string().optional(),
      conversation_id: z.string().optional(),
      attachment_ids: z.array(z.string()).optional(),
      mode: z.string().optional(),
      thinkingLevel: z.string().optional(),
    })
    .optional(),
});

const workflowExecuteSchema = z.object({
  body: z
    .object({
      question: z.string().optional(),
      // Not `.min(1)`/required here — the route's own explicit
      // `!Array.isArray(steps) || steps.length === 0` check (below)
      // owns that exact 400 message; this schema only rejects `steps`
      // when it's present but the WRONG type.
      steps: z
        .array(
          z.object({
            toolName: z.string().optional(),
            tool_name: z.string().optional(),
            params: z.record(z.string(), z.any()).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

function createAiRouter() {
  const router = express.Router();

  // requireAuth, not a role gate — the Policy Gate inside
  // aiToolRegistry.js is the real per-tool authorization boundary (same
  // "the service is the gate" reasoning routes/workflowRequests.js's
  // own router comment gives for GET /workflow-requests/pending), not
  // this route. Listing tool names/descriptions carries no
  // classification risk of its own; invoking one is what the gate below
  // actually protects.
  router.get(
    '/ai/tools',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(aiService.listTools());
    }),
  );

  // An optional body.question turns this into the full Tool Registry
  // -> ... -> LLM pipeline (aiService.askAboutTool); omitting it keeps
  // today's behavior exactly (aiService.invokeTool, stops at the
  // sanitized context blob) — one route, not two, and every existing
  // caller/test that never sends `question` is unaffected.
  router.post(
    '/ai/tools/:name/invoke',
    requireAuth,
    validate(invokeToolParamsSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const identityContext = buildAiIdentityContext(req);
      const params = (req.body || {}).params || {};
      const question = (req.body || {}).question;
      // Opt-in — a caller that never sends this header (every caller
      // today; wiring the frontend to send one is a separate, later
      // piece of work) sees byte-for-byte the same behavior as before.
      // Only applies to the plain-invoke write path, not askAboutTool
      // (a read, nothing to deduplicate) — see
      // aiService.invokeToolIdempotent's own comment on scope.
      const idempotencyKey = req.get('Idempotency-Key');
      try {
        let result;
        if (question !== undefined) {
          result = await aiService.askAboutTool(req.dbClient, req.params.name, params, question, { identityContext });
        } else if (idempotencyKey) {
          result = await aiService.invokeToolIdempotent(req.dbClient, req.params.name, params, {
            identityContext,
            idempotencyKey,
          });
        } else {
          result = await aiService.invokeTool(req.dbClient, req.params.name, params, { identityContext });
        }
        res.json(result);
      } catch (err) {
        if (mapAiToolError(err, res)) return;
        throw err;
      }
    }),
  );

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
  // Shared by /ai/ask and /ai/ask/stream — resolves the identityContext
  // plus the two optional, gracefully-degrading hints (projectContext,
  // history) exactly once, so the streaming route (added for P0.5) is
  // not a second, drifting copy of this same resolution logic.
  async function resolveAskContext(req) {
    const identityContext = buildAiIdentityContext(req);
    const {
      question,
      focusContext,
      project_id: projectId,
      conversation_id: conversationId,
      attachment_ids: attachmentIds,
      mode,
      thinkingLevel,
    } = req.body || {};
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
    // Short-session conversation memory (P0.1) — optional, additive:
    // a caller that never sends conversation_id (every caller before
    // this) sees byte-for-byte the same behavior as before. Same
    // graceful-degrade shape as projectContext above — an invalid/
    // not-owned conversation_id just means no history, never a failed
    // ask. Bounded to the last HISTORY_MESSAGE_CEILING messages here only
    // to cap query/memory cost — aiService.buildHistoryHint applies the
    // real, character-budget-based trim that actually governs how much
    // reaches the prompt (ADL-047).
    let history;
    if (conversationId) {
      try {
        const messages = await conversationService.listMessages(req.dbClient, conversationId, {
          userId: identityContext.userId,
        });
        // attachments rides along (not just role/content) so buildHistoryHint
        // can remind the model a file from an earlier turn still has a live,
        // reusable attachmentId — see that function's own comment for why
        // dropping this here was the actual bug behind "asks to re-upload/
        // re-state the file on the very next turn".
        history = messages
          .slice(-HISTORY_MESSAGE_CEILING)
          .map((m) => ({ role: m.role, content: m.content, attachments: m.attachments || undefined }));
      } catch {
        // graceful degrade — see comment above
      }
    }
    return {
      question,
      identityContext,
      focusContext,
      projectContext,
      history,
      attachmentIds,
      mode,
      thinkingLevel: resolveThinkingLevel(thinkingLevel, question),
    };
  }

  // P3 1.18 — the guardrail layer, wired here rather than inside
  // aiService.js on purpose. Refusing a blocked turn at the route means
  // no provider call, no quota spend and no prompt assembly at all; and
  // it keeps this change entirely out of aiService.js, whose per-turn
  // system-instruction text is under clash C10/C11's "must stay
  // byte-identical" constraint and is 1.16's own target.
  //
  // Only the BLOCK tier is enforced here. The FLAG tier's reinforcement
  // note (aiGuardrailService.REINFORCEMENT_NOTE) is built and tested but
  // deliberately NOT wired: injecting it would mean adding a conditional
  // segment to the system prompt, which is precisely the change clash
  // C10/C11 records as having measurably weakened rule-following
  // (3/3 correct -> 2/7). That wiring belongs to the 1.16 session, which
  // owns that file and can verify it against the live behavioural suite.
  //
  // A guardrail refusal is recorded in the audit log via the same
  // ai_guardrail_blocked action both routes use, carrying pattern IDS
  // only — never the offending text.
  // Best-effort: a failed audit write must never turn a correct refusal
  // into a 500. The refusal itself is the security-relevant behaviour;
  // the row is visibility.
  async function auditLogGuardrailBlock(req, identityContext, matched) {
    try {
      await auditLogRepository.createAuditLogEntry(req.dbClient, {
        collegeId: identityContext.collegeId,
        userId: identityContext.userId,
        action: 'ai_guardrail_blocked',
        entity: 'ai_requests',
        entityId: null,
        // Pattern ids only. Storing the question verbatim would turn the
        // audit log into a searchable archive of hostile input — the same
        // reason the chat-attachment path audits a fixed failureReason
        // vocabulary instead of the raw extraction error.
        metadata: { matched },
      });
    } catch {
      // deliberately swallowed — see above
    }
  }

  async function guardrailBlock(req, identityContext, question) {
    const screening = aiGuardrailService.screenInput(question);
    if (screening.verdict !== 'block') return null;
    await auditLogGuardrailBlock(req, identityContext, screening.matched);
    return {
      answer: aiGuardrailService.REFUSAL_MESSAGE,
      toolUsed: null,
      evidence: null,
      guardrail: { blocked: true, matched: screening.matched },
    };
  }

  router.post(
    '/ai/ask',
    requireAuth,
    validate(askSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { question, identityContext, focusContext, projectContext, history, attachmentIds, mode, thinkingLevel } =
        await resolveAskContext(req);

      const blocked = await guardrailBlock(req, identityContext, question);
      if (blocked) {
        res.json(blocked);
        return;
      }

      try {
        const result = await aiService.askAgent(req.dbClient, question, {
          identityContext,
          focusContext,
          projectContext,
          history,
          attachmentIds,
          mode,
          thinkingLevel,
        });
        // Output screening: Aadhaar (RS-STU-002, statutory — never in AI
        // reasoning or reporting) and credential-shaped secrets.
        const screened = aiGuardrailService.screenOutput(result.answer);
        if (screened.redactions.length > 0) {
          result.answer = screened.text;
          result.guardrail = { redactions: screened.redactions };
        }
        res.json(result);
      } catch (err) {
        if (mapAiToolError(err, res)) return;
        throw err;
      }
    }),
  );

  // Streaming variant of /ai/ask (P0.5) — same tool-select/plan/
  // confirmation logic (aiService.askAgent, unchanged): the final
  // natural-language answer streams as an SSE `delta` event per chunk,
  // and (P1) a `step` event fires just before each tool in a single-tool
  // or multi-step plan call actually runs (`{phase, toolName, stepIndex,
  // totalSteps}`) — real progress, not a synthetic status string, since
  // it's emitted from the exact same call site `invokeTool`/
  // `executeWorkflowPlan` already use, never a guess about what's
  // happening. One `done` event still carries the exact full JSON shape
  // /ai/ask itself returns (toolUsed, evidence, plan, pendingConfirmation,
  // ...) so the frontend reconciles state identically regardless of which
  // route it used. A separate route, not a content-negotiated branch of
  // /ai/ask itself, so that route's existing contract/tests stay
  // byte-for-byte untouched.
  router.post(
    '/ai/ask/stream',
    requireAuth,
    validate(askSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { question, identityContext, focusContext, projectContext, history, attachmentIds, mode, thinkingLevel } =
        await resolveAskContext(req);

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const writeEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // P3 1.18 — a blocked question is refused on the stream itself
      // (headers are already sent by this point, so an SSE delta+done
      // pair is the only honest way to say it), never by changing the
      // HTTP status. The client reconciles from `done` exactly as it
      // does for any other turn.
      const streamBlocked = await guardrailBlock(req, identityContext, question);
      if (streamBlocked) {
        writeEvent('delta', { delta: streamBlocked.answer });
        writeEvent('done', streamBlocked);
        res.end();
        return;
      }

      // Output screening across chunk boundaries — see
      // aiGuardrailService.createOutputRedactor for why per-chunk
      // redaction would be worse than useless here.
      const redactor = aiGuardrailService.createOutputRedactor();

      try {
        const result = await aiService.askAgent(
          req.dbClient,
          question,
          {
            identityContext,
            focusContext,
            projectContext,
            history,
            attachmentIds,
            mode,
            thinkingLevel,
          },
          (delta) => {
            const safe = redactor.push(delta);
            if (safe) writeEvent('delta', { delta: safe });
          },
          (step) => writeEvent('step', step),
        );
        const tail = redactor.flush();
        if (tail) writeEvent('delta', { delta: tail });

        // `done` carries the full answer, so it is screened in its own
        // right — the streamed deltas and this payload must not disagree
        // about what was redacted.
        const screened = aiGuardrailService.screenOutput(result.answer);
        if (screened.redactions.length > 0) {
          result.answer = screened.text;
          result.guardrail = { redactions: screened.redactions };
        }
        writeEvent('done', result);
      } catch (err) {
        // The response has already started (headers sent) by the time
        // any error here could occur — an SSE `error` event, never an
        // HTTP status change, is the only honest way to surface it to an
        // EventSource client at this point.
        writeEvent('error', { detail: err.message });
      } finally {
        res.end();
      }
    }),
  );

  // Executes a bounded workflow plan the user already confirmed (P0.3)
  // — the frontend gets `pendingConfirmation: { steps }` back from
  // POST /ai/ask when a plan needs a yes/no, then replays that exact
  // `steps` array here once the user says yes, same "confirm now,
  // execute via a direct call, no second LLM round-trip" shape
  // /ai/tools/:name/invoke already uses for a single confirmed tool.
  // Not re-planned: re-asking the LLM here could produce a DIFFERENT
  // plan than the one the user actually saw and approved.
  //
  // No extra trust is placed in `steps` for being client-supplied
  // rather than LLM-proposed — executeWorkflowPlan runs every step
  // through the same invokeTool (Policy Gate, tenant/role/classification
  // checks) any other entry point uses, exactly like
  // /ai/tools/:name/invoke already lets a caller name any tool+params
  // directly with no LLM in the loop at all. The Policy Gate is the
  // real authority here, never "was this plan LLM-authored."
  router.post(
    '/ai/workflow/execute',
    requireAuth,
    validate(workflowExecuteSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const identityContext = buildAiIdentityContext(req);
      const { question, steps } = req.body || {};
      if (!Array.isArray(steps) || steps.length === 0) {
        res.status(400).json({ detail: 'steps is required and must be a non-empty array' });
        return;
      }
      const resolvedSteps = steps.map((s) => ({ toolName: s.toolName || s.tool_name, params: s.params || {} }));
      try {
        const result = await aiService.executeWorkflowPlan(req.dbClient, resolvedSteps, question || '', {
          identityContext,
        });
        res.json(result);
      } catch (err) {
        if (mapAiToolError(err, res)) return;
        throw err;
      }
    }),
  );

  return router;
}

module.exports = createAiRouter;
// P3 1.11 — attached as a property on the factory function (not a
// second named export replacing the default) so tenantApp.js's own
// `createAiRouter()` call site is completely unaffected; exists purely
// so a unit test can exercise the label/auto-classify boundary without
// spinning up a real Express app + DB.
module.exports.resolveThinkingLevel = resolveThinkingLevel;
// P3 4.9 — same "attached to the factory function" convention as
// routes/auth.js's own `.schemas`, read by routes/openapi.js.
module.exports.schemas = {
  '/ai/tools/{name}/invoke': { post: invokeToolParamsSchema },
  '/ai/ask': { post: askSchema },
  '/ai/ask/stream': { post: askSchema },
  '/ai/workflow/execute': { post: workflowExecuteSchema },
};
