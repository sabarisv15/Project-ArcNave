'use strict';

// Module 9 (AI) — Tool Registry + Policy Gate. AI-Governance.md §1/§2:
// "AI Agent -> Tool Registry -> Read/Generate/Workflow Tools ->
// Business Services (never repositories, never storage)". This file
// owns two closely related but genuinely separate jobs, deliberately
// kept in one file because the Policy Gate IS the registry's own
// invocation path, not a bolt-on:
//   1. the registry itself — {name, level, dataClassification,
//      description, handler} entries, each handler a thin wrapper over
//      exactly one Business Service method (CLAUDE.md rule 1). No
//      handler contains its own validation/query construction —
//      AI-Governance.md §2 names this explicitly as the reason the
//      Tool Registry exists at all.
//   2. the Policy Gate — a deterministic, pre-invocation check
//      (tenant match, role, data classification, department scope)
//      run before any handler executes. Never touches prompt/text
//      content — that's aiPromptSafetyLayer.js's job, a strictly
//      separate concern with a different attack surface (content
//      safety vs. authorization).
//
// L1 (Inform), L2 (Generate), and L3 (Act) all have working execution
// paths now — invokeTool rejects any OTHER level value (a typo, a
// future L4 that doesn't exist) with AiToolLevelNotSupportedError, a
// real branch, not a TODO. L3 is the one that needs its own real
// discipline, not a runtime check this file can enforce generically:
// AI-Governance.md §1 — "L3 actions are never executed directly by an
// AI tool. The tool creates a request in WorkflowService... A human
// must approve before the action executes" — means every L3 tool's
// handler MUST be a thin wrapper over a Business Service method that
// itself only ever SUBMITS something for approval (e.g.
// notificationService.submitForApproval, which calls
// workflowService.submitRequest internally), never one that performs
// the actual send/mutation (dispatchApprovedNotification, sendEmail).
// The Policy Gate cannot introspect what a handler's Business Service
// call actually does — this is enforced by registration-time
// discipline/code review, the same way rule 1 ("no handler contains
// its own validation/query construction") is: see request_notification_send
// below for the one real example.
//
// R0-R5 risk ladder + Action Manifest (this session's own task):
// AI-Governance.md names L1/L2/L3 (action level) and Internal/
// Confidential/Restricted (data classification) as its two axes, but
// never actually specifies an "R0-R5" ladder anywhere in the doc — this
// is this slice's own, explicitly-flagged interpretation, not a spec
// transcription. RISK_MATRIX below derives a tool's risk level
// deterministically from its own already-declared level +
// dataClassification (never a third, independently-set field that
// could drift from those two), monotonically non-decreasing in both
// axes, capped at R5 for the single most dangerous combination (L3 +
// Restricted). The ladder currently informs the Action Manifest
// (below) — it makes an AI action's real risk visible to the human
// approver at approval time — but it does NOT add a second, automated
// hard-block beyond AI-Governance.md's existing "L3 always requires
// human approval, no exceptions" rule. A real escalation policy (e.g.
// "R5 requires two independent approvers") is a follow-up, deliberately
// not invented here: `request_notification_send` (R4: L3+Confidential)
// is the only real L3 tool that exists today, and no R5 tool exists
// yet to design that policy against without guessing.
//
// The Action Manifest is a structured record of what an L3 tool call
// actually is — toolName, actionLevel, dataClassification, riskLevel,
// the actor who invoked it, and the params it was called with —
// attached to the workflow_requests row it creates (via
// workflowService.submitRequest's new optional actionManifest
// parameter, migration 1754100000000) so the human approver can see
// what they're actually approving, not just an entity_type/entity_id
// pair. Built fresh per call inside invokeTool (buildActionManifest
// below), passed to the handler as a 4th argument — L1/L2 handlers
// never see it (JS silently ignores an extra argument a function
// doesn't declare), only an L3 handler that explicitly accepts and
// forwards it (see request_notification_send) actually attaches one.
// Not an LLM-generated summary — every field is either a hard fact
// this file already computes (level/classification/risk) or the
// caller-supplied params/actor identity, never free text a model wrote.
//
// Every Policy Gate rejection also writes an `ai_tool_denied` audit_log
// row (which check failed, for whom) — a security-relevant event
// regardless of outcome, same reasoning `ai_tool_invoked` already
// gets logged for the success path (aiService.js). A tool name that
// doesn't exist at all (AiToolNotFoundError) is NOT logged this way:
// that's rejected before the Policy Gate ever runs against a real
// tool, so there's no actual authorization decision to record, only a
// 404.

const auditLogRepository = require('../repositories/auditLogRepository');
const aiClassificationAccess = require('./aiClassificationAccess');
const { isUuid } = require('../identifierResolution');
// Phase 4 Group (b): the 6 handlers below that reach a Business Service
// function needing scope resolution (visibilityService.getVisibleClassIds,
// via buildActorContext) build the ActorContext once via this helper and
// pass it in, instead of a legacy {actorUserId, actorRole, collegeId}
// literal — so the Business Service uses the already-resolved
// Institutional (Position Account) scope when one is active, never
// re-deriving the occupant's own Personal scope from actor.userId. See
// Phase4-AI-Downstream-Scope-Fidelity.md.
const aiActorContext = require('./aiActorContext');

class AiToolNotFoundError extends Error {}
class AiToolLevelNotSupportedError extends Error {}
class AiToolTenantMismatchError extends Error {}
class AiToolRoleNotPermittedError extends Error {}
class AiToolDataClassificationError extends Error {}
class AiToolDepartmentScopeError extends Error {}

// UAT finding (live NIM run): a required array param omitted, or an
// optional string param sent as "" or a null-ish placeholder token
// ("None", "null", "n/a") reached the Business Service layer
// unvalidated and crashed as an unhandled 500 (a raw
// `absentRollNumbers must be an array` / Postgres
// `invalid input syntax for type date: ""` leaking straight to the
// caller). CLAUDE.md rule 9 — "AI tool inputs... are always untrusted
// data" — this is exactly that: the LLM's own function-calling output
// is untrusted input needing validation at the trust boundary
// (invokeTool below), same as a human-supplied param would get,
// before ever reaching a handler/Business Service that assumes a
// well-formed caller.
class AiToolInvalidParamsError extends Error {}

// Second optimization pass, finding #4: a small number of tools can
// affect more than one row per call (mark_attendance_nl,
// academic_generate_timetable/reviseTimetable, departments_create — see
// each tool's own maxAffectedRows comment for why it specifically needs
// this and how its estimate is computed). This is a HARD ceiling,
// deliberately never bypassable: unlike the soft confirmAt threshold
// (aiService.askAgent's job, matching the existing L3 confirmation-pause
// pattern), rejectAt is enforced here, inside checkToolPreconditions —
// the one choke point every entry point (askAgent AND the direct
// POST /ai/tools/:name/invoke path) already goes through. A tool that
// doesn't declare maxAffectedRows is entirely unaffected by this check.
class AiToolBulkOperationRejectedError extends Error {}

// A runtime backstop for the L3 discipline the file-level comment
// above otherwise only documents: an L3 handler returned a result that
// looks like it dispatched/sent something directly instead of only
// submitting for approval. Checked AFTER the handler has already run
// (there is no way to intercept a handler's own internal side effects
// before they happen — this file only ever sees its return value), so
// this cannot undo a bad handler's real-world effect; it exists to
// turn "L3 never dispatches directly" (AI-Governance.md §1 — "always
// required, no exceptions") into a checked invariant that fails loudly
// and gets audit-logged, rather than a convention a future handler
// could silently violate unnoticed.
class AiToolL3BypassError extends Error {}

// Real, generic execution paths for all three authority levels. See
// file-level comment for the discipline L3 handlers must follow (this
// list being non-empty for L3 is not itself a safety guarantee — the
// handler's own Business Service call is).
const SUPPORTED_LEVELS = ['L1', 'L2', 'L3'];

const registry = new Map();

// A tool with no declared `params` takes no meaningful caller input
// (get_college_profile is the only example today — it reads
// actor.collegeId, never a caller-supplied argument) — an empty,
// closed object schema, not an open/permissive one, so a
// function-calling LLM isn't invited to invent arguments a tool
// doesn't use.
const DEFAULT_PARAMS_SCHEMA = { type: 'object', properties: {}, additionalProperties: false };

// R0-R5 risk ladder — see the file-level comment for what this is and
// (importantly) is not. Deliberately a plain lookup table, not a
// formula: a formula invites someone to "simplify" it in a way that
// silently changes a risk level nobody reviewed, where an explicit
// table makes every one of the 9 real (level, classification)
// combinations a reviewable, individual decision. Monotonic by
// construction — reading down any column or across any row, the
// number never decreases.
const RISK_MATRIX = {
  L1: { Internal: 0, Confidential: 1, Restricted: 1 },
  L2: { Internal: 2, Confidential: 2, Restricted: 3 },
  L3: { Internal: 3, Confidential: 4, Restricted: 5 },
};

function computeRiskLevel(level, dataClassification) {
  const row = RISK_MATRIX[level];
  const risk = row && row[dataClassification];
  return typeof risk === 'number' ? risk : null;
}

// RS-ANL-002: "AI may read and summarize analytics data but never acts
// on a number by itself." A tool tagged `analyticsSourced: true` (its
// handler is backed by AnalyticsService — see the two real callers
// below) can never be anything but L1 read: L2 would produce a draft
// artifact from the number, L3 would let AI act on it directly, both
// exactly what the rule forbids. Checked HERE, at registration time,
// not left as a fact that merely happens to be true of every tool
// registered today — a future PR adding an L2/L3 analytics tool fails
// loudly at module load, the same "checked runtime invariant, not only
// a registration convention" discipline this file's own Action
// Manifest gate already applies to L3 approval.
class AiToolAnalyticsLevelViolationError extends Error {}

function registerTool(tool) {
  if (!tool || !tool.name || !tool.level || !tool.dataClassification || typeof tool.handler !== 'function') {
    throw new Error('tool must have {name, level, dataClassification, handler}');
  }
  if (tool.analyticsSourced && tool.level !== 'L1') {
    throw new AiToolAnalyticsLevelViolationError(
      `tool ${JSON.stringify(tool.name)} is analytics-sourced but declared level ${JSON.stringify(tool.level)} — RS-ANL-002 permits analytics tools to be L1 read only, never L2/L3`,
    );
  }
  // Computed at registration time from the tool's own declared level +
  // dataClassification, never a third field a registration could set
  // independently (and so never a field that could disagree with
  // them) — see RISK_MATRIX's own comment.
  registry.set(tool.name, { ...tool, riskLevel: computeRiskLevel(tool.level, tool.dataClassification) });
}

function getTool(name) {
  return registry.get(name) || null;
}

// The Action Manifest (see file-level comment) — a plain, fully-
// deterministic object, never LLM-generated text. Only called for L3
// tools (invokeTool below) since AI-Governance.md's approval
// requirement — the whole reason a manifest needs to travel with a
// request at all — only applies to L3; an L1/L2 call has no approval
// step for a human to inspect this against.
function buildActionManifest(tool, identityContext, params) {
  return {
    toolName: tool.name,
    actionLevel: tool.level,
    dataClassification: tool.dataClassification,
    riskLevel: tool.riskLevel,
    actorUserId: identityContext.userId,
    actorRole: identityContext.role,
    collegeId: identityContext.collegeId,
    params: params || {},
    requestedAt: new Date().toISOString(),
    manifestVersion: 1,
  };
}

// `params` is a JSON-Schema-shaped description of the tool's caller-
// supplied arguments — exposed so aiService.askAgent can hand the
// whole list to llmProvider.completeWithTools as a function-calling
// schema (name + description + params, this slice's own build brief).
// riskLevel is exposed alongside for the same reason — a caller (or a
// future dashboard) can see a tool's real risk without recomputing
// RISK_MATRIX itself. Never the tool's internal logic, just its own
// declared input shape + derived risk.
// excludeHumanOnly (aiService.askAgent's own use — see
// upload_institutional_document's file comment): a tool marked
// humanOnly: true never reaches the LLM's own function-calling list —
// it still shows up in the human-facing GET /ai/tools listing
// (listTools() with no args), and is still fully invokable via the
// existing explicit POST /ai/tools/:name/invoke path (the Policy Gate
// runs identically either way), it's simply never one the LLM can
// decide to call on its own mid-conversation.
// `role` (aiService.askAgent's own use, added alongside excludeHumanOnly):
// scopes the list to tools the calling role may actually invoke, using
// the same `allowedRoles` metadata assertPolicyAllows enforces at
// invoke time — so the LLM is never offered a tool call it would then
// have to be rejected for by the Policy Gate. Omitted (undefined) keeps
// the full-registry listing GET /ai/tools relies on (see excludeHumanOnly's
// own comment above) unchanged.
function listTools({ excludeHumanOnly = false, role } = {}) {
  let tools = excludeHumanOnly
    ? Array.from(registry.values()).filter((tool) => !tool.humanOnly)
    : Array.from(registry.values());
  if (role) {
    tools = tools.filter((tool) => (tool.allowedRoles || []).includes(role));
  }
  return tools.map(({
    name, level, dataClassification, riskLevel, description, params,
  }) => ({
    name,
    level,
    dataClassification,
    riskLevel,
    description,
    params: params || DEFAULT_PARAMS_SCHEMA,
  }));
}

// Tool-schema filtering (P0.2 of the AI capability roadmap,
// CHECKPOINT.md) — round 2's own design: "deterministic domain-prefix
// filtering, embeddings deferred until real usage data exists". Role
// filtering above already cuts the list somewhat, but a broad role
// (principal gets 56 of 57 registered tools) still sends the LLM's
// tool-select call almost the entire schema — this narrows further,
// deterministically, using the question's own words against each
// tool's name/description.
//
// Deliberately conservative, since this has no eval set (recall@N)
// behind it any more than the deferred embeddings approach would —
// unvalidated ranking heuristics that HARD-EXCLUDE a tool risk making
// a real question unanswerable by removing the one tool that could
// have answered it, which is strictly worse than sending extra tokens.
// So this never excludes: RANK_CAP only kicks in when the role-
// filtered list is already large, and even then every tool with any
// keyword overlap is kept before any zero-overlap tool is dropped —
// the worst case is "no narrowing happened," never "the right tool was
// silently removed."
const RANK_CAP = 25;
const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'in', 'on', 'for', 'and', 'or',
  'my', 'me', 'i', 'you', 'your', 'what', 'how', 'who', 'whom', 'when', 'where', 'which', 'this',
  'that', 'with', 'do', 'does', 'did', 'can', 'could', 'please', 'show', 'tell', 'give', 'about',
]);

function significantWords(text) {
  const matches = (text || '').toLowerCase().match(/[a-z]+/g) || [];
  return matches.filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function toolKeywordOverlap(tool, questionWords) {
  const toolWords = new Set(significantWords(`${tool.name.replace(/_/g, ' ')} ${tool.description}`));
  let overlap = 0;
  for (const w of questionWords) if (toolWords.has(w)) overlap += 1;
  return overlap;
}

// Ranks `tools` (already role-filtered) by keyword overlap with
// `question` and keeps at most RANK_CAP. Round 32: this is now only
// ever the LEXICAL FALLBACK tier of aiToolRetrievalService.js, used
// when embeddingService.isAvailable() is false — the primary path for
// a capable college is semantic retrieval, which has no zero-keywords
// blind spot at all ("hi" still embeds to something comparable). Both
// "nothing to rank on" cases below used to return the full, unfiltered
// list (a real, measured ~13K-token cost for a bare "hi" on a 69-tool
// role) — that fail-open behavior is exactly what "never send all
// tools just because retrieval failed" (this round's own requirement)
// rules out. RANK_CAP is now a hard ceiling in every branch, not just
// the ones with something to rank; the tradeoff the original comment
// flagged (a hard exclusion could in theory drop a tool a vague
// question actually needed) is accepted here as this tier's known
// limitation, not this function's problem to solve alone — a capable
// college never reaches this path at all.
function filterToolsByRelevance(tools, question) {
  if (tools.length <= RANK_CAP) return tools;
  const questionWords = new Set(significantWords(question));
  if (questionWords.size === 0) return tools.slice(0, RANK_CAP);

  const ranked = tools
    .map((tool) => ({ tool, overlap: toolKeywordOverlap(tool, questionWords) }))
    .sort((a, b) => b.overlap - a.overlap);

  const overlapping = ranked.filter((r) => r.overlap > 0);
  // No tool's own name/description shares a single word with the
  // question — that's not evidence any tool is irrelevant, it just
  // means this heuristic found nothing to rank on. Same capped
  // fallback as the qWords.size === 0 case above.
  if (overlapping.length === 0) return tools.slice(0, RANK_CAP);
  if (overlapping.length >= RANK_CAP) return overlapping.slice(0, RANK_CAP).map((r) => r.tool);

  const zeroOverlapFill = ranked.filter((r) => r.overlap === 0).slice(0, RANK_CAP - overlapping.length);
  return [...overlapping, ...zeroOverlapFill].map((r) => r.tool);
}

// The Policy Gate. Four independent checks, each its own error class —
// a caller needs to tell a wrong-role rejection apart from a wrong-
// classification rejection apart from a cross-tenant attempt; a single
// generic "denied" would hide which of four unrelated invariants
// actually failed, both from a caller and from test coverage (this
// slice's own verification brief asks for exactly this distinction).
function assertPolicyAllows(tool, identityContext, params) {
  if (!SUPPORTED_LEVELS.includes(tool.level)) {
    throw new AiToolLevelNotSupportedError(
      `tool ${JSON.stringify(tool.name)} is level ${JSON.stringify(tool.level)}, which is not a supported `
      + `authority level (expected one of ${JSON.stringify(SUPPORTED_LEVELS)} — AI-Governance.md §1)`,
    );
  }

  if (params && params.collegeId !== undefined && params.collegeId !== identityContext.collegeId) {
    throw new AiToolTenantMismatchError(
      `caller's tenant ${JSON.stringify(identityContext.collegeId)} does not match requested collegeId ${JSON.stringify(params.collegeId)}`,
    );
  }

  const allowedRoles = tool.allowedRoles || [];
  if (!allowedRoles.includes(identityContext.role)) {
    throw new AiToolRoleNotPermittedError(
      `role ${JSON.stringify(identityContext.role)} is not permitted to invoke tool ${JSON.stringify(tool.name)}`,
    );
  }

  // RS-FIN-006: "action level, data classification and ownership are
  // three independent checks... the one exception is
  // finance_record_payment, which is Restricted but class_tutor-scoped
  // because the acting tutor is the owner of that specific datum." A
  // named, per-tool exception to the general role->classification
  // matrix, not a change to the matrix itself (every OTHER Restricted
  // tool must stay closed to class_tutor) — classificationOverrideRoles
  // is empty for every tool but this one.
  const permittedClassifications = aiClassificationAccess.permittedClassifications(identityContext.role);
  const classificationOverride = (tool.classificationOverrideRoles || []).includes(identityContext.role);
  if (!permittedClassifications.includes(tool.dataClassification) && !classificationOverride) {
    throw new AiToolDataClassificationError(
      `role ${JSON.stringify(identityContext.role)} is not permitted to access `
      + `${JSON.stringify(tool.dataClassification)} data (tool ${JSON.stringify(tool.name)})`,
    );
  }

  if (tool.departmentScoped) {
    const departmentId = params && params.departmentId;
    if (!departmentId || departmentId !== identityContext.departmentId) {
      throw new AiToolDepartmentScopeError(
        `caller's department ${JSON.stringify(identityContext.departmentId)} does not match requested `
        + `departmentId ${JSON.stringify(departmentId)} (tool ${JSON.stringify(tool.name)})`,
      );
    }
  }
}

// Null-ish placeholder tokens a function-calling LLM sometimes emits
// for a parameter it means to leave unset (observed live: NVIDIA
// NIM's meta/llama-3.1-8b-instruct sending "None" for an omitted
// optional date). Only ever stripped from OPTIONAL params (never a
// required one — a required field left as a placeholder must still
// fail the required-params check below, not be silently dropped).
const NULLISH_PARAM_TOKENS = new Set(['', 'none', 'null', 'n/a', 'na', 'undefined', 'nil']);

// Drops any optional param whose value is one of the placeholder
// tokens above, so a downstream Business Service never sees "" or
// "None" where it expects either a real value or the key absent
// entirely (its own contract, same as a human-supplied request body
// would be held to). Returns a new object — never mutates the
// caller's params.
function sanitizeParams(tool, params) {
  const schema = tool.params || DEFAULT_PARAMS_SCHEMA;
  const required = new Set(schema.required || []);
  const sanitized = { ...params };
  Object.keys(sanitized).forEach((key) => {
    if (required.has(key)) return;
    const value = sanitized[key];
    if (typeof value === 'string' && NULLISH_PARAM_TOKENS.has(value.trim().toLowerCase())) {
      delete sanitized[key];
    }
  });
  return sanitized;
}

// Enforces the tool's own already-declared JSON-schema `required`
// list (today's only real gap: it was defined for the LLM's
// function-calling contract but never actually checked before a
// handler ran) plus a minimal type check for `array`-typed required
// params — the exact shape `mark_attendance_nl`'s
// `absent_roll_numbers` needs and the exact shape a live LLM call was
// observed omitting, previously reaching attendanceService as an
// unhandled crash instead of a clean rejection here.
function assertParamsValid(tool, params) {
  const schema = tool.params || DEFAULT_PARAMS_SCHEMA;
  const required = schema.required || [];
  const missing = required.filter((key) => params[key] === undefined || params[key] === null || params[key] === '');
  if (missing.length > 0) {
    throw new AiToolInvalidParamsError(
      `tool ${JSON.stringify(tool.name)} is missing required parameter(s): ${missing.map((k) => JSON.stringify(k)).join(', ')}`,
    );
  }
  required.forEach((key) => {
    const propSchema = schema.properties && schema.properties[key];
    if (propSchema && propSchema.type === 'array' && !Array.isArray(params[key])) {
      throw new AiToolInvalidParamsError(
        `tool ${JSON.stringify(tool.name)}'s parameter ${JSON.stringify(key)} must be an array`,
      );
    }
  });

  // UAT finding (live NIM run against request_notification_send/
  // finance_submit_fee_structure_change): a handful of params are
  // deliberately pure-UUID with no natural key to resolve from (see
  // each one's own description) — a live LLM call invented a
  // placeholder ("12345", a description fragment) for one of these
  // when it had no real id to supply, and that string reached a
  // repository's `WHERE id = $1` as an unhandled Postgres uuid-cast
  // crash. Rejecting it here, before the handler runs, turns that into
  // the same clean 400 an unresolvable name-based identifier already
  // gets via IdentifierResolutionError — never a fix for the missing
  // resolver itself (deliberately out of scope, see each field's own
  // description), only for the crash.
  Object.keys(schema.properties || {}).forEach((key) => {
    const propSchema = schema.properties[key];
    if (propSchema.format === 'uuid' && params[key] !== undefined && !isUuid(params[key])) {
      throw new AiToolInvalidParamsError(
        `tool ${JSON.stringify(tool.name)}'s parameter ${JSON.stringify(key)} must be a real internal id, `
        + `not ${JSON.stringify(params[key])} — there is no name to resolve it from`,
      );
    }
  });
}

// Maps a Policy Gate error to a short, stable reason code for
// ai_tool_denied's metadata — the error message itself is meant for a
// human reading the exception, this is meant for querying/grouping
// audit_log rows by which check failed.
function describePolicyFailureReason(err) {
  if (err instanceof AiToolLevelNotSupportedError) return 'level_not_supported';
  if (err instanceof AiToolTenantMismatchError) return 'tenant';
  if (err instanceof AiToolRoleNotPermittedError) return 'role';
  if (err instanceof AiToolDataClassificationError) return 'classification';
  if (err instanceof AiToolDepartmentScopeError) return 'department_scope';
  if (err instanceof AiToolL3BypassError) return 'l3_bypass';
  if (err instanceof AiToolBulkOperationRejectedError) return 'bulk_operation_ceiling';
  return 'unknown';
}

// A result that looks like a direct dispatch/send rather than a
// submission — checked generically (any status string a future
// ledger-backed entity might use for its own terminal "already sent"
// state), not hardcoded to notifications alone, since a future L3 tool
// may wrap a different Business Service entirely.
const L3_BYPASS_STATUSES = ['Dispatched', 'sent'];

// The one thing every real L3 handler's result MUST look like: a
// submission, not a completed action. `workflow_request_id` present
// (truthy) proves a real workflow_requests row now governs whatever
// this handler touched — the one structural fact a "submit for
// approval" call (e.g. notificationService.submitForApproval) always
// leaves behind and a direct-action call (dispatchApprovedNotification/
// sendEmail) never does. `status` not already a terminal/dispatched
// value is the second, independent signal — belt and suspenders,
// since a hypothetical bad handler could fabricate a workflow_request_id
// without actually going through WorkflowService.
function assertL3ResultNotBypassed(tool, result) {
  if (!result || !result.workflow_request_id) {
    throw new AiToolL3BypassError(
      `L3 tool ${JSON.stringify(tool.name)}'s handler returned a result with no workflow_request_id — `
      + 'an L3 handler must only ever submit something for approval (AI-Governance.md §1), never act directly',
    );
  }
  if (L3_BYPASS_STATUSES.includes(result.status)) {
    throw new AiToolL3BypassError(
      `L3 tool ${JSON.stringify(tool.name)}'s handler returned status ${JSON.stringify(result.status)}, which looks `
      + 'like a completed dispatch/send — an L3 handler must only ever submit for approval (AI-Governance.md §1), '
      + 'never dispatch/send directly',
    );
  }
}

// The one real entry point aiService.js calls. Not exposed as
// "getTool, then call the handler yourself" — every invocation must
// pass through assertPolicyAllows, so there is exactly one path into
// any handler, never a bypass.
// Phase 3 (AI Identity Context Integration): identityContext is the
// one normalized shape routes/ai.js's buildAiIdentityContext produces
// — regardless of whether the caller is logged in via Personal
// Identity Context (resolveCapabilities) or Institutional Identity
// Context (resolveCapabilitiesForPosition, ADR-023), this function and
// everything it calls reads it the same way, never branching on which
// resolver produced it. Every existing L1/L2/L3 handler's own local
// parameter name for the value passed positionally here is still
// `actor` (unchanged, cosmetic only, ~40 call sites) — renaming this
// module's own boundary variable does not require renaming every
// handler's local parameter name too.
async function checkToolPreconditions(name, { client, identityContext, params } = {}) {
  const tool = getTool(name);
  if (tool === null) {
    throw new AiToolNotFoundError(`no AI tool named ${JSON.stringify(name)} is registered`);
  }
  try {
    assertPolicyAllows(tool, identityContext, params || {});
  } catch (err) {
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId: identityContext.collegeId,
      userId: identityContext.userId,
      action: 'ai_tool_denied',
      entity: 'ai_tools',
      entityId: null,
      metadata: { toolName: name, reason: describePolicyFailureReason(err) },
    });
    throw err;
  }

  // Untrusted-input validation (CLAUDE.md rule 9) — not a Policy Gate
  // decision (no ai_tool_denied audit entry: this is a malformed
  // request, not an authorization outcome), so it's a plain
  // AiToolInvalidParamsError -> 400, same category as
  // AiServiceValidationError elsewhere in this pipeline.
  const safeParams = sanitizeParams(tool, params || {});
  assertParamsValid(tool, safeParams);

  // Bulk-operation safety ceiling — see AiToolBulkOperationRejectedError's
  // own comment. estimate() is a pure function over the already-validated
  // params (no DB call), so this adds no query and no measurable latency.
  let estimatedAffectedRows;
  if (tool.maxAffectedRows) {
    estimatedAffectedRows = tool.maxAffectedRows.estimate(safeParams);
    if (estimatedAffectedRows > tool.maxAffectedRows.rejectAt) {
      await auditLogRepository.createAuditLogEntry(client, {
        collegeId: identityContext.collegeId,
        userId: identityContext.userId,
        action: 'ai_tool_denied',
        entity: 'ai_tools',
        entityId: null,
        metadata: { toolName: name, reason: 'bulk_operation_ceiling', estimatedAffectedRows },
      });
      throw new AiToolBulkOperationRejectedError(
        `tool ${JSON.stringify(name)} would affect approximately ${estimatedAffectedRows} record(s), `
        + `above the safety ceiling of ${tool.maxAffectedRows.rejectAt} — narrow the request and try again`,
      );
    }
  }

  return { tool, safeParams, estimatedAffectedRows };
}

async function invokeTool(name, { client, identityContext, params } = {}) {
  const { tool, safeParams } = await checkToolPreconditions(name, { client, identityContext, params });

  // Action Manifest — built only for L3 (see buildActionManifest's own
  // comment for why L1/L2 don't get one) and passed as a 4th handler
  // argument. Every existing L1/L2 handler's signature is (client,
  // params, actor) — JS silently ignores an argument a function
  // doesn't declare, so this is not a breaking change to any of them;
  // only a handler that explicitly adds a 4th parameter (see
  // request_notification_send below) actually receives and forwards it.
  const manifest = tool.level === 'L3' ? buildActionManifest(tool, identityContext, safeParams) : undefined;
  let result;
  try {
    result = await tool.handler(client, safeParams, identityContext, manifest);
  } catch (err) {
    // Round 10 P2/P3 finding: a handler throwing mid-invokeTool (a real
    // Business Service failure — NotFound, a DB constraint, a domain
    // validation error) previously left no audit trail at all — only
    // Policy Gate rejections (ai_tool_denied, above) and successes
    // (ai_tool_invoked, aiService.js's invokeTool) were ever recorded.
    // Logged distinctly from ai_tool_denied: this is an execution
    // failure, not an authorization outcome.
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId: identityContext.collegeId,
      userId: identityContext.userId,
      action: 'ai_tool_handler_failed',
      entity: 'ai_tools',
      entityId: null,
      metadata: { toolName: name, errorName: err.name, reason: err.message },
    });
    throw err;
  }

  // The runtime backstop — see AiToolL3BypassError's own comment.
  // Only meaningful for L3 (submission-only) tools; L1/L2 handlers are
  // never expected to look like a "submission," so this check would be
  // actively wrong to apply to them.
  if (tool.level === 'L3') {
    try {
      assertL3ResultNotBypassed(tool, result);
    } catch (err) {
      await auditLogRepository.createAuditLogEntry(client, {
        collegeId: identityContext.collegeId,
        userId: identityContext.userId,
        action: 'ai_tool_denied',
        entity: 'ai_tools',
        entityId: null,
        metadata: { toolName: name, reason: describePolicyFailureReason(err) },
      });
      throw err;
    }
  }

  return result;
}

// --- Real tool #1 ----------------------------------------------------
// get_college_profile: L1/Inform (a pure read, no external effect),
// Internal classification (name/affiliating_university/
// year_established/address — none of AI-Governance.md §4's
// Confidential/Restricted rows). Thin wrapper over
// collegeProfileService.getProfile (CLAUDE.md rule 1 — the Business
// Service, never collegeProfileRepository directly). Scoped to
// principal/hod, not plain staff — profile-level college metadata
// isn't every staff member's concern, same conservative-placeholder
// reasoning routes/collegeProfile.js's own principal-only RBAC gate
// already uses for the human-facing route (moved from college_admin —
// see that file's comment).
const collegeProfileService = require('./collegeProfileService');

registerTool({
  name: 'get_college_profile',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Reads the acting user's own college profile (name, affiliating university, year established, address).",
  allowedRoles: ['principal', 'hod'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => collegeProfileService.getProfile(client, actor.collegeId),
});

// --- Real tools #2/#3 — the flagship "AI drafts, human approves, then
// it sends" path -------------------------------------------------------
// Both wrap notificationService (Module 8's ledger extension) — the
// same Business Service a human-initiated notification would use,
// never a second, AI-only code path (AI-Governance.md §2's whole
// point). `Confidential` classification for both: a notification's
// `to_address` is recipient contact info, the same category
// AI-Governance.md §4's table gives "Parent phone" — not automatically
// visible to plain `staff`, same `allowedRoles` scoping
// get_college_profile already uses.
const notificationService = require('./notificationService');

// draft_notification: L2/Generate — produces a row (the Draft), no
// external effect, no approval needed to draft (AI-Governance.md §1's
// table: L2 "None — but produces no external effect"). Thin wrapper
// over notificationService.draftNotification; origin is hardcoded
// 'ai', never caller-supplied — this tool exists specifically because
// the AI is the one drafting, so there is no ambiguity to leave open
// the way draftNotification's own default ('human') covers for a
// human-facing caller.
registerTool({
  name: 'draft_notification',
  level: 'L2',
  dataClassification: 'Confidential',
  description: 'Drafts an outbound notification (channel, recipient, subject, body) for later human approval and sending. '
    + 'Never sends anything by itself — the draft must be submitted via request_notification_send and approved by a human first.',
  allowedRoles: ['principal', 'hod'],
  params: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: "Delivery channel, e.g. 'email' (the only real channel today)." },
      toAddress: { type: 'string', description: "Recipient's email address (or phone number for a future channel)." },
      subject: { type: 'string', description: 'Email subject line. Omit for a channel with no subject line.' },
      body: { type: 'string', description: 'The message content to send.' },
    },
    required: ['channel', 'toAddress', 'body'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => notificationService.draftNotification(
    client,
    { collegeId: actor.collegeId, channel: params.channel, toAddress: params.toAddress, subject: params.subject, body: params.body, origin: 'ai' },
    { actorUserId: actor.userId },
  ),
});

// request_notification_send: L3/Act — AI-Governance.md §1: "always
// required, no exceptions." This handler's ONLY Business Service call
// is notificationService.submitForApproval, which itself only ever
// calls workflowService.submitRequest — it structurally cannot send
// anything; there is no code path from this handler to
// notificationService.dispatchApprovedNotification/sendEmail. Sending
// only ever happens later, when a human approves via the existing
// POST /workflow-requests/:id/approve route (routes/workflowRequests.js's
// entity_type === 'notification' case), completely outside this
// handler's own call stack. requested_by_user_id is the real
// authenticated actor (actor.userId) — AI-Governance.md's own point
// that every AI action still ties back to the real user whose session
// triggered it, origin distinguishes who drafted the content, not
// whether a user was present.
//
// The 4th handler argument (manifest) is this tool's Action Manifest —
// built by invokeTool above only because this tool is L3 — forwarded
// straight through to notificationService.submitForApproval, which
// forwards it again to workflowService.submitRequest, which persists it
// on the workflow_requests row this call creates. The human approving
// this request (routes/workflowRequests.js) can now see the tool name,
// risk level, and exact params an AI action submitted, not just
// "notification, entity id X."
registerTool({
  name: 'request_notification_send',
  level: 'L3',
  dataClassification: 'Confidential',
  description: 'Submits a previously drafted notification (from draft_notification) for human approval. '
    + 'Does NOT send it — a human must approve via the workflow approvals screen before anything is dispatched.',
  allowedRoles: ['principal', 'hod'],
  params: {
    type: 'object',
    properties: {
      notificationId: {
        type: 'string', format: 'uuid', description: 'The id of a previously drafted notification (from draft_notification) to submit for approval. Must be the exact internal id — there is no name to resolve it from, so never guess one.',
      },
    },
    required: ['notificationId'],
    additionalProperties: false,
  },
  handler: (client, params, actor, manifest) => notificationService.submitForApproval(
    client,
    params.notificationId,
    { requestedByUserId: actor.userId, actionManifest: manifest },
  ),
});

// --- Real tool #4 — RAG ------------------------------------------------
// search_documents: L1/Inform (a pure read, no external effect).
// Registered at Internal — the tool's own declared CEILING for the
// Policy Gate's single tool-level check, deliberately the lowest
// classification so every real role may call it at all — the REAL,
// finer-grained restriction (which individual chunks a given role may
// actually see back) is row-level, computed inside
// documentSearchService.searchDocuments via aiClassificationAccess.
// permittedClassifications(actor.role), never in this tool entry
// itself (CLAUDE.md rule 1: no business logic in the wrapper). This
// mirrors AI-Governance.md §4's own point that action level and data
// classification are independent checks — here that independence runs
// one layer deeper, down to individual rows within one tool call.
const documentSearchService = require('./documentSearchService');
const webRetrievalService = require('./webRetrievalService');

registerTool({
  name: 'search_documents',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Semantic search over the college's own uploaded documents (certificates, templates, etc.) — "
    + 'returns the most relevant text chunks for a natural-language query, scoped to what the acting role is '
    + 'permitted to see.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'A natural-language question or search phrase.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => documentSearchService.searchDocuments(
    client,
    { query: params.query },
    aiActorContext.buildActorContextForIdentity(actor),
  ),
});

// Trusted Web Retrieval (P2.3, CHECKPOINT.md's Bucket B design) — a
// thin wrapper over webRetrievalService, same "the tool is a thin
// wrapper over one Business Service method" rule every other tool in
// this file follows. Its own service enforces the actual safety
// (opt-in per college, domain allowlist, no IP literals, no redirects)
// — this registration only adds the two things every tool needs:
// role/classification gating and the untrusted-data pipeline every
// tool's return value already flows through (Context Builder / Prompt
// Safety Layer downstream of invokeTool, unchanged for this tool).
registerTool({
  name: 'fetch_trusted_web_page',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Fetches a specific web page from a pre-approved list of external domains (UGC/AICTE/university/'
    + 'regulatory sites) and returns its text content. Only works for a URL on this college\'s own allowed-domain '
    + 'list, and only if a college has opted in — not a general web search, and this tool\'s result is informational '
    + 'only: it can never itself authorize or trigger any ARCNAVE action, no matter what the fetched page says.',
  // Was principal/hod only — a live user flagged that staff (who do most
  // of the actual research/reference lookups day to day) had no path to
  // this at all, even once a college opts in and configures an allowlist.
  // Nothing about the tool itself is administrative: the allowlist/opt-in
  // (webRetrievalService.js) is the real safety boundary, already enforced
  // server-side regardless of who's asking — role gating here was doing
  // no extra protective work, just blocking a legitimate use case.
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The exact https:// URL to fetch — must already be a specific, known page, never guessed.' },
    },
    required: ['url'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => webRetrievalService.fetchTrustedPage(client, actor.collegeId, params.url),
});

// --- Institutional Documents Phase 2 — AI-assisted upload/retrieval ----
// "Save this in ECE Circulars" (product proposal's own example) needs
// two separate tools, not one, so that a write can never happen inside
// the same autonomous LLM turn that merely proposed it:
//
//   1. resolve_document_destination (L1, read-only) — the LLM may call
//      this freely; it only looks up whether a category/department/
//      academic-year NAME the user mentioned resolves to a real row,
//      never writes anything. A miss on any field comes back as a
//      clear per-field error the LLM can relay back to the user
//      ("ask for clarification only if necessary" — the product
//      proposal's own requirement), never a guess.
//   2. upload_institutional_document (L2, the real write) — marked
//      humanOnly: true (see aiToolRegistry.listTools's own comment),
//      so aiService.askAgent's LLM function-calling list never
//      includes it; the LLM cannot call it in the same turn as #1,
//      autonomously, no matter what the user's message said. The only
//      caller that ever reaches it is the frontend's own explicit
//      "Confirm & Upload" button — a real human click, made only
//      after #1's resolved destination has already been shown —
//      calling POST /ai/tools/upload_institutional_document/invoke
//      directly (useToolInvoke, the same mechanism the slash-command
//      tool palette already uses for any other tool). This is the
//      "confirmation before AI performs writes" requirement, met
//      without needing WorkflowService/L3 — same reasoning
//      draft_notification (L2, a real write, no approval needed to
//      draft) already establishes for "a write that doesn't need a
//      second human's approval, only the same human's own confirm."
const documentService = require('./documentService');
const documentCategoryService = require('./documentCategoryService');
const academicYearService = require('./academicYearService');

async function resolveOptionalField(resolver, value) {
  if (!value) {
    return { value: null, error: null };
  }
  try {
    const id = await resolver(value);
    return { value: { id, name: value }, error: null };
  } catch (err) {
    return { value: null, error: err.message };
  }
}

registerTool({
  name: 'resolve_document_destination',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Looks up whether a category, department, and/or academic year name the user mentioned (e.g. '
    + '"ECE", "Circulars", "2026-2027") match real Institutional Documents data for this college. Read-only — '
    + 'never uploads or moves anything. Always call this BEFORE telling the user their document was saved '
    + 'somewhere, and relay any "not found" field back to the user as a clarifying question rather than guessing. '
    + 'Call this when the user names an actual document destination while talking about saving/uploading/filing a '
    + 'document — "save this under Circulars" names a category, "put it in the ECE folder" names a department '
    + '(NOT a category, even though the word "folder" is used), "file this for 2026-2027" names an academic year. '
    + 'Only pass the fields the user actually named; never invent a category, department, or year to fill a param '
    + 'the user did not mention, and never put a value in the wrong field — see each parameter\'s own description '
    + 'below for which kind of name belongs in it. Do NOT call this tool with every parameter empty: if the user is '
    + 'only asking to upload/save/file a document and has not named ANY category, department, or year yet, skip '
    + 'this tool entirely and ask them which category it belongs to first — an empty call wastes a round trip '
    + 'this tool cannot answer anyway.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Document category (a folder-like grouping, e.g. "Circulars", "Curriculum", "Policies", '
          + '"Notices") the user mentioned. This is NEVER a department/branch name — "ECE", "CSE", "Mechanical" and '
          + 'similar branch names always belong in the department parameter below, not here, even if the user said '
          + '"folder" or "put it in ECE".',
      },
      department: {
        type: 'string',
        description: 'Department or branch name the user mentioned, e.g. "ECE", "CSE", "Mechanical". Omit if the '
          + 'user did not name one (college-wide). This is NEVER a document category — "Circulars", "Curriculum" '
          + 'and similar category names always belong in the category parameter above, not here.',
      },
      academic_year: { type: 'string', description: 'Academic year label the user mentioned, e.g. "2026-2027". Omit if the user did not name one (defaults to the current Active year).' },
    },
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const [category, department, academicYear] = await Promise.all([
      resolveOptionalField((v) => documentCategoryService.resolveCategoryId(client, actor.collegeId, v), params.category),
      resolveOptionalField((v) => collegeProfileService.resolveDepartmentId(client, actor.collegeId, v), params.department),
      resolveOptionalField((v) => academicYearService.resolveAcademicYearId(client, actor.collegeId, v), params.academic_year),
    ]);
    return {
      category: category.value, categoryError: category.error,
      department: department.value, departmentError: department.error,
      academicYear: academicYear.value, academicYearError: academicYear.error,
    };
  },
});

registerTool({
  name: 'upload_institutional_document',
  level: 'L2',
  dataClassification: 'Internal',
  humanOnly: true,
  description: "Uploads a document into the college's Institutional Documents repository under the given "
    + 'category (required) and optional department/academic year. Never called by the AI on its own — only '
    + "reachable via the user's own explicit confirm action in the chat UI, after resolve_document_destination "
    + 'has already shown them where it will be saved.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'A short human-readable title for the document.' },
      category: { type: 'string', description: 'The category id or name (already resolved via resolve_document_destination).' },
      department: { type: 'string', description: 'The department id or name, if any.' },
      academic_year: { type: 'string', description: 'The academic year id or label, if any.' },
      file_name: { type: 'string', description: 'The original file name.' },
      mime_type: { type: 'string', description: 'The file MIME type.' },
      file_base64: { type: 'string', description: 'The raw file bytes, base64-encoded.' },
    },
    required: ['title', 'category', 'file_name', 'mime_type', 'file_base64'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const [categoryId, departmentId, academicYearId] = await Promise.all([
      documentCategoryService.resolveCategoryId(client, actor.collegeId, params.category),
      params.department ? collegeProfileService.resolveDepartmentId(client, actor.collegeId, params.department) : null,
      params.academic_year ? academicYearService.resolveAcademicYearId(client, actor.collegeId, params.academic_year) : null,
    ]);
    const document = await documentService.uploadInstitutionalDocument(
      client,
      {
        collegeId: actor.collegeId,
        title: params.title,
        categoryId,
        departmentId,
        academicYearId,
        fileName: params.file_name,
        mimeType: params.mime_type,
        fileBuffer: Buffer.from(params.file_base64, 'base64'),
      },
      { actorUserId: actor.userId },
    );
    // Best-effort: makes the freshly-uploaded document immediately
    // findable via search_documents/list_institutional_documents-style
    // AI retrieval, matching the product proposal's "AI should
    // retrieve/summarize" goal. Never fails the upload itself — an
    // unsupported mime_type (docx/xlsx/pptx: documentSearchService's
    // own documented limitation, not new here) just means this
    // document isn't semantically searchable yet, same as any other
    // document uploaded outside the AI flow today.
    try {
      await documentSearchService.ingestDocument(client, document.id, { actorUserId: actor.userId });
    } catch {
      // swallow — see comment above.
    }
    return document;
  },
});

registerTool({
  name: 'list_institutional_documents',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Lists Institutional Documents (Curriculum, Circulars, Academic Calendar, Examination, Policies, '
    + 'Forms, Notices) matching an optional category/department/academic-year/search filter — the AI-facing '
    + 'equivalent of browsing the Institutional Documents page with filters set. Most recent first, so "the '
    + 'latest examination timetable" is simply the first row of a category="Examination" call.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Category id or name to filter by, e.g. "Circulars".' },
      department: { type: 'string', description: 'Department id or name to filter by, e.g. "ECE".' },
      academic_year: { type: 'string', description: 'Academic year id or label to filter by, e.g. "2026-2027".' },
      search: { type: 'string', description: 'Free-text search against the document title/file name.' },
    },
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    // undefined, not null, for an omitted hint — documentRepository.
    // findInstitutional's own optional-filter checks are `!== undefined`
    // (a real `null` would build a `column = NULL` condition, which
    // SQL never matches, silently returning zero rows regardless of
    // the other filters).
    const [categoryId, departmentId, academicYearId] = await Promise.all([
      params.category ? documentCategoryService.resolveCategoryId(client, actor.collegeId, params.category) : undefined,
      params.department ? collegeProfileService.resolveDepartmentId(client, actor.collegeId, params.department) : undefined,
      params.academic_year ? academicYearService.resolveAcademicYearId(client, actor.collegeId, params.academic_year) : undefined,
    ]);
    // limit: this tool's own description already frames its ordering
    // as "most recent first" — capping it here matches that stated
    // semantic rather than truncating something the tool promises to
    // return in full. The human-facing GET /documents/institutional
    // browse route is untouched.
    return documentService.listInstitutionalDocuments(
      client,
      {
        categoryId, departmentId, academicYearId, search: params.search, limit: 200,
      },
      { actorRole: actor.role },
    );
  },
});

// --- Institutional Documents Phase 3 — read-only lookups ---------------
// Both L1/read-only, same reasoning search_documents/
// list_institutional_documents above already establish: nothing here
// writes, so neither needs humanOnly — the LLM may call these freely
// to answer "what changed between versions" / "what's this year's
// version of X" questions. Publish/supersede/archive themselves are
// NOT exposed as AI tools at all: CLAUDE.md rule 3 requires those to
// go through WorkflowService's human approval gate exactly like every
// other Level 3 (Act) action, and this codebase's existing pattern
// (upload_institutional_document above) is "the real write only ever
// reaches the human's own Confirm button, never the LLM's own
// function-calling list" — the same discipline applies here without
// inventing a new mechanism: publishing/superseding stay
// UI-only actions (routes/documents.js's own
// /publish//supersede/archive endpoints), reachable by a human via the
// Institutional Documents page, never via ARCNAVE AI.
registerTool({
  name: 'get_document_version_history',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Lists every version of a logical Institutional Document (same document_group_id), newest first — '
    + 'use after list_institutional_documents/search_documents has already resolved a document id.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      document_id: { type: 'string', description: 'Any document id belonging to the version group (e.g. from list_institutional_documents).' },
    },
    required: ['document_id'],
    additionalProperties: false,
  },
  handler: async (client, params) => {
    const document = await documentService.getDocument(client, params.document_id);
    if (document === null) {
      return [];
    }
    return documentService.getVersionHistory(client, document.document_group_id);
  },
});

registerTool({
  name: 'get_document_lineage',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Returns the cross-year lineage of an Institutional Document — its ancestor(s) in earlier academic '
    + 'years and its successor(s) in later years, e.g. "what is the 2025-2026 version of the 2024-2025 Curriculum?"',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      document_id: { type: 'string', description: 'The document id to resolve lineage for.' },
    },
    required: ['document_id'],
    additionalProperties: false,
  },
  handler: (client, params) => documentService.getDocumentLineage(client, params.document_id),
});

// --- ADR-029 — Universal Document Intelligence, slice 1 ----------------
// analyze_document_table: L1/Inform — read-only computation over an
// already-uploaded, already-authorized chat attachment (ownership is
// re-checked inside documentAnalysisService itself, the same chain
// aiService.resolveChatAttachments already enforces). RS-AIG-018's
// "never a general-purpose execution capability" is satisfied by
// construction: operation is a closed enum (documentAggregateService.
// OPERATIONS), filter.pattern is a plain RegExp string, never executed as
// code. The LLM's job is to supply the per-question mapping (which
// pattern counts as "arrear," which serial range to scope to) as these
// plain params — it never performs the count itself, which is the actual
// fix for the miscounting this tool exists to prevent (see
// bka/60-product-reasoning/ai-chat-result-sheet-evidence.md).
const documentAnalysisService = require('./documentAnalysisService');

registerTool({
  name: 'analyze_document_table',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Deterministically counts, sums, or breaks down pattern matches across the rows of an already-uploaded '
    + "chat-attached tabular document (e.g. a result sheet, attendance roster, or fee list) — use this instead of "
    + 'counting/summing yourself whenever a question asks "how many"/"count"/"total"/consolidate across rows of an '
    + 'attached document. Set filter.mode to "include" to get back only the rows matching filter.pattern (e.g. only '
    + 'ABSENT/RA rows) instead of every row annotated with a mostly-zero column. If you don\'t know the exact serial '
    + 'range for a named cohort (e.g. "the Sandwich section"), use sectionPattern instead of guessing a range. The '
    + 'model never computes the count/sum/breakdown/filter itself — this tool does. If it returns status '
    + '"unreliable_extraction", this system could not read that document\'s table layout dependably '
    + '(rowsExpected vs rowsAccountedFor show the shortfall). Say so plainly, and make clear the limitation '
    + 'is this system\'s, not a problem with their file — do NOT tell the user the document is unclear or '
    + 'ask them to re-upload a clearer copy, and do not substitute your own reading of the attached '
    + 'document for the analysis.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      attachmentId: { type: 'string', description: 'The chat attachment id (from this turn\'s uploaded file) to analyze.' },
      filter: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'A regular expression matched against each row\'s text. For operation "count", every match counts toward that row\'s result (e.g. "RA|Absent RA" for exam arrears). For operation "sum", each match\'s first capturing group (or the whole match if it has none) is parsed as a number and totaled per row (e.g. "Total Arrears\\s*:?\\s*(\\d+)"). For operation "breakdown", every match within each semester\'s own span is counted separately (e.g. "RA" to get a per-semester arrear count).' },
          mode: { type: 'string', enum: ['annotate', 'include'], description: '"annotate" (default) returns every row with its count/sum/breakdown. "include" returns only the rows where the pattern matched at least once — use this for a real filtered list, not just an annotated total.' },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
      operation: { type: 'string', enum: ['count', 'sum', 'breakdown'], description: "The aggregate operation — 'count' (occurrences of filter.pattern per row), 'sum' (total of the numbers filter.pattern captures/matches per row), or 'breakdown' (occurrences of filter.pattern per semester within each row, for a document that lists a semester number before each exam attempt)." },
      serialRange: {
        type: 'object',
        properties: {
          from: { type: 'number', description: 'Lowest serial/row number to include (inclusive).' },
          to: { type: 'number', description: 'Highest serial/row number to include (inclusive).' },
        },
        required: ['from', 'to'],
        additionalProperties: false,
        description: 'Optional — restricts analysis to a serial-number range (e.g. "serial 818 to 872"). Combine with sectionPattern, or use alone if you already know the exact range.',
      },
      sectionPattern: {
        type: 'string',
        description: 'Optional — a regular expression matched against the document\'s own course/section header text (e.g. "Sandwich" or "Full Time"), to scope analysis to a named cohort when you don\'t already know its serial-number range. Combine with serialRange to narrow further within that section.',
      },
    },
    required: ['attachmentId', 'filter', 'operation'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => documentAnalysisService.analyzeAttachment(client, params, actor),
});

// --- Real tool #5 — AI attendance assistant ----------------------------
// mark_attendance_nl: BusinessRules.md AI Attendance Management. AI-
// Governance.md §1 lists "modify attendance" as its own L3 example
// ("AI, please mark Sunil absent") — but that example is the AI
// deciding/initiating a change on someone else's behalf. This tool is
// structurally the other case §1 already carves out for Send Alert: a
// human's own real-time command about their own already-eligible
// action, with the AI acting only as a natural-language front end, not
// an independent decision-maker. It can never do anything the acting
// user couldn't already do by calling POST /api/v1/attendance directly
// — attendanceService.markAttendanceByRollNumbers's own call into
// markAttendance re-verifies the exact same tutor/HOD/scheduled-staff/
// substitute eligibility check (assertCanMark) that route already
// enforces; the tool grants no authority the human didn't already have.
// Registered L1 (not L3) for that reason — see AI-Governance.md §1's
// own updated note for the explicit carve-out, added in this same
// slice. No WorkflowService submission here, matching Send Alert's own
// "direct, human-triggered action" precedent, not a new exception
// invented ad hoc.
const attendanceService = require('./attendanceService');

registerTool({
  name: 'mark_attendance_nl',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Marks attendance for the session the acting faculty member is currently teaching, from a list of '
    + 'absent roll numbers (e.g. "mark roll numbers 35, 67, and 25 absent") — every other enrolled student in that '
    + "session is marked Present. Resolves the current session from the acting user's own approved timetable "
    + 'allocation or substitute assignment; fails if they have no active session right now.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      absent_roll_numbers: {
        type: 'array',
        items: { type: 'string' },
        description: 'Roll numbers to mark Absent. Every other student enrolled in the resolved class is marked Present.',
      },
    },
    required: ['absent_roll_numbers'],
    additionalProperties: false,
  },
  // Second optimization pass, finding #4: the true affected count is
  // the resolved session's whole roster (every enrolled student is
  // touched, not just the named absentees) — not knowable without
  // running the handler's own session/roster resolution first, which
  // this pre-mutation gate deliberately doesn't do (out of scope for a
  // surgical pass; attendanceService would need its own dry-run/count
  // support to make that exact). absent_roll_numbers.length is used
  // instead as a cheap, honest proxy: no real class session in this
  // domain has anywhere near 300 students, so this is a pure backstop
  // against a malformed/injected oversized list, never a limit a
  // legitimate single-session attendance call could realistically hit —
  // no confirmAt tier is set, matching that (a routine call should
  // never pause for confirmation here).
  maxAffectedRows: {
    estimate: (params) => (Array.isArray(params.absent_roll_numbers) ? params.absent_roll_numbers.length : 0),
    rejectAt: 300,
  },
  handler: (client, params, actor) => attendanceService.markAttendanceByRollNumbers(
    client,
    { absentRollNumbers: params.absent_roll_numbers },
    { actorUserId: actor.userId, actorRole: actor.role, collegeId: actor.collegeId },
  ),
});

// --- Real tool #6 — Academic Calendar read (task #20) -------------------
// list_calendar_events: BusinessRules.md Platform administration,
// Academic Calendar — "AI can answer calendar questions but never
// creates or edits an event without authorization." L1/Inform, a pure
// read with no external effect; Internal classification (semester
// dates/holidays/exam windows carry no student-identifying or contact
// data, unlike AI-Governance.md §4's Confidential/Restricted rows).
// Thin wrapper over calendarService.listEvents, which itself has no
// write path at all — the "never creates or edits" half of the rule is
// satisfied structurally, not by a runtime check this tool would have
// to get right. Open to every tenant role, same as the human-facing
// GET /calendar-events route (one shared institutional calendar, not
// scoped per role).
const calendarService = require('./calendarService');

registerTool({
  name: 'list_calendar_events',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Lists academic calendar events (semester dates, holidays, exams, and other institution-defined '
    + 'events) for the acting college, optionally within a date range. Read-only — never creates or edits an event.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      from_date: { type: 'string', description: 'Optional ISO date (YYYY-MM-DD) — only events starting on or after this date. Omit unless the user explicitly named a date/range; never invent one.' },
      to_date: { type: 'string', description: 'Optional ISO date (YYYY-MM-DD) — only events starting on or before this date. Omit unless the user explicitly named a date/range; never invent one.' },
    },
    additionalProperties: false,
  },
  // limit: a safety backstop, not a functional truncation — a college's
  // real calendar-event count (semester dates, holidays, exams) never
  // realistically approaches this; it exists purely to bound what gets
  // JSON-stringified into the LLM prompt for an unfiltered, all-time
  // query. The human-facing GET /calendar-events route is untouched —
  // this limit is only ever passed by this tool.
  handler: (client, params, actor) => calendarService.listEvents(client, {
    collegeId: actor.collegeId, fromDate: params.from_date, toDate: params.to_date, limit: 500,
  }),
});

// --- Role-aware ERP Copilot tools (this slice) -------------------------
// Every tool below follows three standing rules recorded in
// AI-Governance.md's own "Same-Actor Direct-Action Carve-Out" section:
//   1. Domain-prefixed name (students_*/attendance_*/assessment_*/
//      academic_*/staff_*/finance_*/workflow_*), one Business Service
//      call each — never an intent-branching dispatcher (a single
//      tool can only have one dataClassification/allowedRoles pair,
//      and AI-Governance.md §2 forbids business logic inside a tool
//      wrapper, so a dispatcher can't exist here without breaking
//      both).
//   2. Scope (own class(es)/department/college) is always resolved
//      from `actor` alone, inside the relevant Business Service
//      (visibilityService.getVisibleClassIds/staffService.
//      findHodDepartmentId — the same "context builder" every other
//      scoped read/write in this codebase already shares), never from
//      a caller-supplied classId/departmentId.
//   3. A tool may skip WorkflowService only where the human dashboard
//      action it mirrors is ALREADY a direct write for that exact
//      role today (verified against the real route+service code, not
//      assumed) — everywhere a human already needs approval, the tool
//      creates the identical workflow request instead and never
//      mutates directly. Delete is never a direct tool, full stop.

// Read tools (L1) ------------------------------------------------------

const studentService = require('./studentService');

registerTool({
  name: 'students_roster',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Lists students within the acting user's own scope — their own taught/tutored class(es), their own "
    + 'department (HOD), or the whole college (principal). Roster/profile data only — never includes attendance '
    + 'or marks; use attendance_summary or assessment_marks_summary for those. Only ever returns a name for a '
    + "roll number that's actually enrolled in THIS college's own student records — it has no knowledge of "
    + "roll/register numbers that only appear in a document you've separately analyzed (analyze_document_table), "
    + "since a document's own roll numbers aren't necessarily this college's own enrolled students. If the roll "
    + "numbers a document analysis surfaced don't resolve to real students here, say so — never substitute an "
    + 'unrelated/unfiltered roster as if it answered the question.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      roll_numbers: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional — narrow the roster to exactly these roll numbers (e.g. ones already named earlier '
          + 'in this conversation or by the user) instead of returning the whole scope unfiltered. Omit to list '
          + 'everyone in scope.',
      },
    },
    additionalProperties: false,
  },
  handler: (client, params, actor) => studentService.listStudents(
    client,
    { limit: 500, rollNumbers: params.roll_numbers },
    aiActorContext.buildActorContextForIdentity(actor),
  ),
});

const analyticsService = require('./analyticsService');

registerTool({
  name: 'attendance_summary',
  level: 'L1',
  analyticsSourced: true,
  dataClassification: 'Internal',
  description: "Attendance rate per class within the acting user's own scope (own taught/tutored classes, own "
    + 'department, or whole college), optionally within a date range. Use this for ANY question about attendance '
    + "— rates, percentages, who's attending, department/class attendance — not students_roster (which never "
    + 'includes attendance data).',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      start_date: { type: 'string', description: 'Optional ISO date (YYYY-MM-DD) lower bound — omit unless the user explicitly named a specific date or range; never invent one to narrow an otherwise-unqualified question.' },
      end_date: { type: 'string', description: 'Optional ISO date (YYYY-MM-DD) upper bound — omit unless the user explicitly named a specific date or range; never invent one to narrow an otherwise-unqualified question.' },
    },
    additionalProperties: false,
  },
  handler: (client, params, actor) => analyticsService.getAttendanceRateForActor(
    client,
    aiActorContext.buildActorContextForIdentity(actor),
    { startDate: params.start_date, endDate: params.end_date },
  ),
});

// Same underlying read as attendance_summary, filtered/sorted to
// below-threshold classes — kept as its own tool rather than an
// `intent`/`mode` flag on attendance_summary, per this section's own
// naming rule. The filter itself is a trivial array predicate, not
// query construction, so it stays in this thin handler rather than
// becoming a second analyticsService function.
registerTool({
  name: 'students_low_attendance',
  level: 'L1',
  analyticsSourced: true,
  dataClassification: 'Internal',
  description: "Lists classes within the acting user's own scope whose attendance rate is at or below a threshold "
    + 'percent (default 75) — the same data as attendance_summary, filtered to the classes that need attention.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      threshold_percent: { type: 'number', description: 'Attendance rate percent at or below which a class is included. Defaults to 75.' },
    },
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const rows = await analyticsService.getAttendanceRateForActor(
      client,
      aiActorContext.buildActorContextForIdentity(actor),
    );
    const threshold = typeof params.threshold_percent === 'number' ? params.threshold_percent : 75;
    return rows.filter((row) => row.attendanceRatePercent !== null && row.attendanceRatePercent <= threshold);
  },
});

const assessmentService = require('./assessmentService');

// Classified Internal here, not the Confidential default
// AI-Governance.md §4's data table gives marks generally — a
// deliberate, documented call (see AI-Governance.md's own new note):
// the same tutor already has full read+write access to these exact
// marks on the human dashboard (recordMark has no extra gate beyond
// assertIsAssignedFaculty), so reading what you can already edit is
// not a new exposure. Kept college-wide unrestricted for principal via
// the same actor-derived scoping every other tool here uses.
registerTool({
  name: 'assessment_marks_summary',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Reads (never writes) assessment marks within the acting user's own scope (own taught classes, own "
    + 'department, or whole college), optionally filtered by academic year, subject, or assessment type. Use this '
    + 'for viewing/listing marks (e.g. "who failed", "show marks for..."); use assessment_record_mark instead to '
    + 'record or update one student\'s mark.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      academic_year: { type: 'string', description: "Optional academic year filter, e.g. '2025-2026'." },
      subject: { type: 'string', description: 'Optional subject filter.' },
      assessment_type_id: { type: 'string', description: 'Optional assessment type filter — either the exact internal id (if already known from a prior tool result) or the assessment type\'s real name (e.g. "Midterm"), resolved to an id internally. Omit if unsure of the exact name rather than guessing one.' },
    },
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const assessmentTypeId = params.assessment_type_id
      ? await assessmentService.resolveAssessmentTypeId(client, actor.collegeId, params.assessment_type_id)
      : undefined;
    return assessmentService.listMarksForActor(
      client,
      aiActorContext.buildActorContextForIdentity(actor),
      { academicYear: params.academic_year, subject: params.subject, assessmentTypeId },
    );
  },
});

// attendance_outstanding_absence_flags (RS-ATT-008, D6, Stage 6): L1
// read — the flag itself is system-raised and L3-closed only
// (attendanceService.closeAbsenceFlag has no AI entry point, per
// RS-ATT-008's own "L3 MUST open and close it out"), so this tool is
// read-only, mirroring assessment_marks_summary's own scoped-read shape.
registerTool({
  name: 'attendance_outstanding_absence_flags',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Lists students currently flagged for more than five consecutive full-day absences, within the "
    + 'acting user\'s own scope (own tutored class, own department, or whole college), still awaiting L3 review '
    + 'and closure. Read-only — this tool cannot close a flag.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => attendanceService.listOutstandingAbsenceFlagsForActor(
    client,
    aiActorContext.buildActorContextForIdentity(actor),
  ),
});

const academicService = require('./academicService');

registerTool({
  name: 'academic_class_timetable',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Faculty allocation / timetable for classes within the acting user's own scope (own taught/tutored "
    + 'classes, own department, or whole college).',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => academicService.getClassTimetableForActor(
    client,
    aiActorContext.buildActorContextForIdentity(actor),
  ),
});

// Capability Coverage Audit finding (2026-07-26, cross-role #1):
// RS-TTB-001 (generate/revise timetable) shipped this session with
// zero AI tool coverage for any role — a fresh parity gap, not a
// pre-existing one. generateTimetable/reviseTimetable already do all
// real authorization themselves (academicService.assertCanGenerateForClass,
// same ownership check both the 'staff' and genuine 'class_tutor' seat
// login shapes resolve through) — these two tools are thin wrappers,
// identical in shape to assessment_record_mark above, not new logic.
const REQUIREMENT_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: 'The subject name.' },
    subject_type: { type: 'string', description: "'Theory' or 'Practical'. Defaults to 'Theory'." },
    staff_user_ids: {
      type: 'array',
      items: { type: 'string' },
      description: 'Faculty user id(s) teaching this subject — one for Theory, up to two (co-teaching) for Practical.',
    },
    periods_per_week: { type: 'number', description: 'How many periods/week this subject needs.' },
  },
  required: ['subject', 'staff_user_ids', 'periods_per_week'],
  additionalProperties: false,
};

registerTool({
  name: 'academic_generate_timetable',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Generates a draft timetable (faculty allocation) for a class from a list of subject/faculty/"
    + 'periods-per-week requirements — the same action available on the class Timetable screen. Produces a '
    + 'proposal only; it still needs submitting via academic_submit_timetable_for_approval before it locks '
    + 'attendance marking. Fails if the acting user is not this class\'s own Class Tutor (or principal/hod), or '
    + "if the class's timetable is already Approved (use academic_revise_timetable for an approved class instead).",
  // 4-login authorization architecture (2026-08-09): 'staff' removed —
  // timetable generation is L4/HOD/Principal authority only, never a
  // personal Staff login's, even for a person who occupies the L4 seat
  // (academicService.assertCanGenerateForClass now rejects 'staff'
  // outright). No Staff-level leg exists for this capability at all.
  allowedRoles: ['principal', 'hod', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      class_id: { type: 'string', description: 'The class id, or the class name (e.g. "3rd Sem · CSE-A"), resolved to an id internally.' },
      requirements: { type: 'array', items: REQUIREMENT_ITEM_SCHEMA, description: 'One entry per subject that needs periods scheduled.' },
      max_hours_per_day: { type: 'number', description: "Optional cap on one faculty member's periods/day. Defaults to the class's own configured limit." },
    },
    required: ['class_id', 'requirements'],
    additionalProperties: false,
  },
  // Second optimization pass, finding #4: the actual write count is
  // roughly one faculty_allocation row per period across every
  // requirement — Σ periods_per_week is an exact, zero-cost estimate
  // computable directly from the already-validated params, not a proxy.
  // Scoped to one class only (class_id is required), so a normal
  // request is tens of periods at most; confirmAt sits above a full
  // single-class weekly schedule, rejectAt guards against a malformed/
  // injected requirements array trying to generate an implausible
  // number of periods in one call.
  maxAffectedRows: {
    estimate: (params) => (params.requirements || [])
      .reduce((sum, r) => sum + (Number(r.periods_per_week) || 0), 0),
    confirmAt: 40,
    rejectAt: 200,
  },
  handler: async (client, params, actor) => {
    const classId = await academicService.resolveClassId(client, actor.collegeId, params.class_id);
    const requirements = (params.requirements || []).map((r) => ({
      subject: r.subject, subjectType: r.subject_type, staffUserIds: r.staff_user_ids, periodsPerWeek: r.periods_per_week,
    }));
    return academicService.generateTimetable(
      client,
      classId,
      requirements,
      { actorUserId: actor.userId, actorRole: actor.role, maxHoursPerDay: params.max_hours_per_day },
    );
  },
});

registerTool({
  name: 'academic_revise_timetable',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Revises an already-generated timetable for a class — only the named subjects\' sessions are '
    + 'regenerated, everything else on the class is left alone. Same access rule as academic_generate_timetable '
    + '(this class\'s own Class Tutor, or principal/hod). If the class is already Approved, this creates a new '
    + 'Revision Proposal through the same submit/approve chain, per RS-TTB-001 — attendance marking locks again '
    + 'from the moment it\'s submitted.',
  // 4-login authorization architecture (2026-08-09): same reasoning as
  // academic_generate_timetable above — 'staff' removed.
  allowedRoles: ['principal', 'hod', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      class_id: { type: 'string', description: 'The class id, or the class name, resolved to an id internally.' },
      requirements: { type: 'array', items: REQUIREMENT_ITEM_SCHEMA, description: 'Only the subjects being changed — every other subject\'s existing sessions are untouched.' },
      max_hours_per_day: { type: 'number', description: "Optional cap on one faculty member's periods/day." },
    },
    required: ['class_id', 'requirements'],
    additionalProperties: false,
  },
  // Same reasoning as academic_generate_timetable's own maxAffectedRows
  // comment — identical requirements shape, identical write pattern.
  maxAffectedRows: {
    estimate: (params) => (params.requirements || [])
      .reduce((sum, r) => sum + (Number(r.periods_per_week) || 0), 0),
    confirmAt: 40,
    rejectAt: 200,
  },
  handler: async (client, params, actor) => {
    const classId = await academicService.resolveClassId(client, actor.collegeId, params.class_id);
    const requirements = (params.requirements || []).map((r) => ({
      subject: r.subject, subjectType: r.subject_type, staffUserIds: r.staff_user_ids, periodsPerWeek: r.periods_per_week,
    }));
    return academicService.reviseTimetable(
      client,
      classId,
      requirements,
      { actorUserId: actor.userId, actorRole: actor.role, maxHoursPerDay: params.max_hours_per_day },
    );
  },
});

// Capability Coverage Audit finding: Send Alert had no AI tool at all,
// leaving the "AI may draft the wording, a human reviews before send"
// rule with nothing to invoke. humanOnly: true — same pattern
// upload_institutional_document uses — means the LLM can compose a
// draft message and show it in chat, but can never call this tool
// on its own; only the user's own explicit confirm action in the
// chat UI reaches it. Calls the exact same academicService.sendClassAlert
// the human Send Alert button uses — sendClassAlert's own comment
// documents this AI-drafted/human-confirmed path as the intended
// future variant, not a new authorization surface (same tutor-or-
// assigned-faculty ownership check either way, widened by ADL-024).
registerTool({
  name: 'class_send_alert',
  level: 'L2',
  dataClassification: 'Internal',
  humanOnly: true,
  description: "Sends a plain-text alert (WhatsApp/Email/SMS, best-effort per channel) to every student in the "
    + "acting user's own class. Never sends automatically — only reachable via the user's own explicit confirm "
    + 'action in the chat UI, after reviewing the drafted wording. Fails if the acting user is not this class\'s '
    + 'own Class Tutor.',
  allowedRoles: ['staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      class_id: { type: 'string', description: 'The class id, or the class name, resolved to an id internally.' },
      body: { type: 'string', description: 'The plain-text message body to send, as reviewed and confirmed by the user.' },
    },
    required: ['class_id', 'body'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const classId = await academicService.resolveClassId(client, actor.collegeId, params.class_id);
    return academicService.sendClassAlert(client, classId, params.body, { actorUserId: actor.userId, actorRole: actor.role });
  },
});

// Capability Coverage Audit finding: only substitute_duties_list/
// substitute_duty_acknowledge existed — viewing/acknowledging an
// already-made request, never initiating a new one. RS-CLS-007's own
// actor set ("the absent staff member, the department's L3, or the
// class's own L4") is enforced entirely inside
// academicService.requestSubstituteAssignment against the specific
// class/department — same "role list only narrows who reaches the
// tool, the service is the real gate" split every other actor-scoped
// tool here already uses, so allowedRoles is deliberately wide
// (whoever the service actually authorizes decides, not this list).
registerTool({
  name: 'substitute_request_initiate',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Initiates a new substitute-teacher request for one period of a class — the same action as the '
    + 'class\'s Substitute Assignments screen. The acting user must be the absent staff member named, the '
    + "department's HOD, or the class's own Class Tutor; any other caller is rejected.",
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      class_id: { type: 'string', description: 'The class id, or the class name, resolved to an id internally.' },
      timetable_period_id: { type: 'string', description: 'The timetable period (day/hour slot) this substitute covers.' },
      assignment_date: { type: 'string', description: 'The calendar date (YYYY-MM-DD) the substitution covers.' },
      original_staff_user_id: { type: 'string', description: 'The absent staff member being substituted for.' },
      substitute_staff_user_id: { type: 'string', description: 'The staff member covering the period.' },
      reason: { type: 'string', description: 'Optional reason for the request.' },
    },
    required: ['class_id', 'timetable_period_id', 'assignment_date', 'substitute_staff_user_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const classId = await academicService.resolveClassId(client, actor.collegeId, params.class_id);
    return academicService.requestSubstituteAssignment(
      client,
      {
        classId,
        timetablePeriodId: params.timetable_period_id,
        assignmentDate: params.assignment_date,
        originalStaffUserId: params.original_staff_user_id,
        substituteStaffUserId: params.substitute_staff_user_id,
        reason: params.reason,
      },
      { requestedByUserId: actor.userId, requestedByRole: actor.role },
    );
  },
});

const staffService = require('./staffService');

registerTool({
  name: 'staff_roster',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Lists staff in the acting user's own department (HOD) or the whole college (principal). Not "
    + 'available to plain staff — a tutor has no dashboard reason to browse the staff directory.',
  allowedRoles: ['principal', 'hod'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => staffService.listStaffForActor(
    client,
    { actorUserId: actor.userId, actorRole: actor.role, collegeId: actor.collegeId },
  ),
});

const financeService = require('./financeService');

// RS-FIN-001/004 (D4, Stage 4): there is no fee amount or fee-structure
// concept left anywhere in this schema — "there is no amount to
// summarise." Counts only (paid/not_paid/total marked), never a
// collected/outstanding total.
registerTool({
  name: 'finance_status_summary',
  level: 'L1',
  dataClassification: 'Restricted',
  description: "College-wide fee status counts (paid/not_paid) — never an amount, since ARCNAVE tracks no fee "
    + 'amount at all. Principal only — fee data is Restricted, and only the principal role has AI access to '
    + 'Restricted data.',
  allowedRoles: ['principal'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client) => financeService.getFeeStatusSummary(client),
});

const workflowService = require('./workflowService');

// Capability Coverage Audit finding (2026-07-26): Class Tutor is the
// sole approver for the attendance/marks correction chains
// (workflowChainService resolves both to 'tutor'), and the
// Dashboard's "Needs Your Attention" widget depends on this exact
// query — but 'class_tutor' was missing from allowedRoles, so AI
// could never surface a tutor's own pending-approval queue.
// listPendingForApprover is already purely userId-scoped (queries by
// the row's own assigned approver, same as principal/hod use today),
// so no handler change is needed — same "extend the existing tool,
// don't duplicate it" fix as Phase 1's other role-list gaps.
registerTool({
  name: 'workflow_pending_summary',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Workflow requests currently awaiting the acting user's own approval — the same list the Approvals "
    + 'screen shows, not an exhaustive history of every request ever submitted in their department/college.',
  allowedRoles: ['principal', 'hod', 'class_tutor'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => workflowService.listPendingForApprover(client, actor.userId),
});

// Direct-write tools (L1 — skip WorkflowService; verified the human
// dashboard path is already direct for these exact roles) -------------

// assessment_record_mark: mirrors mark_attendance_nl's own carve-out
// exactly. recordMark itself re-verifies assertIsAssignedFaculty(classId,
// subject, actorUserId) — the tool grants no authority the acting
// faculty member didn't already have via POST /assessments/marks.
registerTool({
  name: 'assessment_record_mark',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Records (or updates) one student's mark for the acting user's own class/subject — the same "
    + 'recordMark action available on the dashboard. Fails if the acting user is not the assigned Subject Faculty '
    + 'for that class/subject.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      academic_year: { type: 'string', description: "Academic year, e.g. '2025-2026'." },
      class_id: { type: 'string', description: 'The class id, or the class name (e.g. "3rd Sem · CSE-A"), resolved to an id internally.' },
      subject: { type: 'string', description: 'The subject.' },
      assessment_type_id: { type: 'string', description: 'The assessment type id, or its real name (e.g. "Midterm"), resolved to an id internally.' },
      student_id: { type: 'string', description: 'The student id, or the student\'s roll number, resolved to an id internally.' },
      marks_obtained: { type: 'number', description: 'The mark, stored exactly as given — no grading/weighting is applied.' },
    },
    required: ['academic_year', 'class_id', 'subject', 'assessment_type_id', 'student_id', 'marks_obtained'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const [classId, assessmentTypeId, studentId] = await Promise.all([
      academicService.resolveClassId(client, actor.collegeId, params.class_id),
      assessmentService.resolveAssessmentTypeId(client, actor.collegeId, params.assessment_type_id),
      studentService.resolveStudentId(client, actor.collegeId, params.student_id),
    ]);
    return assessmentService.recordMark(
      client,
      {
        academicYear: params.academic_year,
        classId,
        subject: params.subject,
        assessmentTypeId,
        studentId,
        marksObtained: params.marks_obtained,
      },
      { actorUserId: actor.userId },
    );
  },
});

// calendar_create_event / calendar_update_event: two tools, not one
// "manage" tool with a mode flag — createEvent/updateEvent are two
// distinct Business Service methods, per this section's own naming
// rule (governing principle 0/1), even though they share a domain.
// Both direct — calendarService has no workflow step at all, and both
// are principal-only, matching the human dashboard's own calendar.write
// permission.
registerTool({
  name: 'calendar_create_event',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Creates a college calendar event (semester date, holiday, exam window, etc). Principal only.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Event title.' },
      event_type: { type: 'string', description: "Event type, e.g. 'holiday', 'exam'." },
      start_date: { type: 'string', description: 'ISO date (YYYY-MM-DD).' },
      end_date: { type: 'string', description: 'Optional ISO date (YYYY-MM-DD).' },
      description: { type: 'string', description: 'Optional description.' },
    },
    required: ['title', 'event_type', 'start_date'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => calendarService.createEvent(
    client,
    {
      collegeId: actor.collegeId, title: params.title, eventType: params.event_type, startDate: params.start_date, endDate: params.end_date, description: params.description,
    },
    { actorUserId: actor.userId },
  ),
});

registerTool({
  name: 'calendar_update_event',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Updates an existing college calendar event. Principal only.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      event_id: {
        type: 'string', format: 'uuid', description: 'The calendar event id to update. Must be the exact internal id (from a prior list_calendar_events result) — there is no name to resolve it from, so never guess one.',
      },
      title: { type: 'string', description: 'Optional new title.' },
      event_type: { type: 'string', description: 'Optional new event type.' },
      start_date: { type: 'string', description: 'Optional new ISO date (YYYY-MM-DD).' },
      end_date: { type: 'string', description: 'Optional new ISO date (YYYY-MM-DD).' },
      description: { type: 'string', description: 'Optional new description.' },
    },
    required: ['event_id'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => calendarService.updateEvent(
    client,
    params.event_id,
    {
      title: params.title, eventType: params.event_type, startDate: params.start_date, endDate: params.end_date, description: params.description,
    },
    { actorUserId: actor.userId, collegeId: actor.collegeId },
  ),
});

// finance_record_payment (RS-FIN-002, D5): first-time marking ONLY —
// class_tutor, not principal (the divergence this rule named
// explicitly, now fixed). markFeePayment itself re-verifies the actor
// is the real, verified tutor of the target student's own class — the
// tool grants no authority the acting tutor didn't already have via
// POST /finance/fee-payments. Fails with FeePaymentAlreadyMarkedError
// if the student already has a fee status on record — the AI MUST
// treat that as a signal to use finance_submit_fee_correction instead
// of retrying this tool, never a reason to guess a workaround.
registerTool({
  name: 'finance_record_payment',
  level: 'L1',
  dataClassification: 'Restricted',
  // RS-FIN-006's own named exception — see assertPolicyAllows's
  // comment. Only 'class_tutor' (the effectiveRole an Institutional
  // Identity Context / real Position-resolved tutor carries), never
  // widened to plain 'staff' — that would loosen Restricted access
  // beyond what the rule actually names.
  classificationOverrideRoles: ['class_tutor'],
  description: "Marks a student's fee payment status (paid/not_paid) for the FIRST time only — receipt document "
    + 'required as evidence of record. Class tutor, own class only. If the student already has a fee status on '
    + 'record, this fails; use finance_submit_fee_correction instead, never call this tool again for the same '
    + 'student.',
  // Capability Coverage Audit finding (2026-07-26): plain 'staff' was
  // listed here even though the GUI has no fee-entry path for an
  // ordinary (non-tutor) staff account — "AI has full GUI parity,
  // nothing more" violation. Removed; markFeePayment's own tutor-
  // ownership check meant this was never exploitable, but the
  // allowedRoles list must not claim wider reach than the GUI grants.
  allowedRoles: ['principal', 'hod', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      student_id: { type: 'string', description: 'The student id, or the student\'s roll number, resolved to an id internally.' },
      status: { type: 'string', description: "'paid' or 'not_paid'." },
      receipt_document_id: { type: 'string', description: 'Required id of a previously uploaded receipt document — the evidence of record.' },
    },
    required: ['student_id', 'status', 'receipt_document_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const studentId = await studentService.resolveStudentId(client, actor.collegeId, params.student_id);
    return financeService.markFeePayment(
      client,
      {
        collegeId: actor.collegeId, studentId, status: params.status, receiptDocumentId: params.receipt_document_id,
      },
      { actorUserId: actor.userId, actorRole: actor.role },
    );
  },
});

// students_update_profile: updateStudent itself re-verifies
// assertCanModifyStudent (own class/department/college) — same
// carve-out shape as assessment_record_mark. Lifecycle status is
// deliberately NOT a param here — that always goes through
// students_submit_lifecycle_change (Phase 3) instead, since 4 of its
// values are workflow-gated even for a human and the rest already have
// their own direct route (updateStudentLifecycleStatus) this tool does
// not wrap.
registerTool({
  name: 'students_update_profile',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Updates routine profile fields (phone, address, parent contact, notes — never lifecycle status) "
    + "for a student within the acting user's own scope. Fails if the student is not in the acting user's scope.",
  // 4-login authorization architecture (2026-08-09): 'staff' removed —
  // studentService.assertCanModifyStudent has no plain-'staff' leg at
  // all (only class_tutor/hod/principal), so a personal Staff login
  // would only ever reach a StudentNotAuthorizedError here, exactly
  // matching GUI (middleware/permissions.js's students.update entry no
  // longer lists 'staff' either).
  allowedRoles: ['principal', 'hod', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      student_id: { type: 'string', description: 'The student id, or the student\'s roll number, resolved to an id internally.' },
      phone: { type: 'string', description: "Optional new phone number." },
      address: { type: 'string', description: 'Optional new address.' },
      parent_phone: { type: 'string', description: "Optional new parent phone number." },
      notes: { type: 'string', description: 'Optional new notes.' },
    },
    required: ['student_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const studentId = await studentService.resolveStudentId(client, actor.collegeId, params.student_id);
    return studentService.updateStudent(
      client,
      studentId,
      {
        phone: params.phone, address: params.address, parentPhone: params.parent_phone, notes: params.notes,
      },
      { userId: actor.userId, actorRole: actor.role },
    );
  },
});

// staff_update_profile: updateStaff has no internal per-row scoping
// (routes/staff.js's own `staff.update` permission is already
// principal-only) — same authority as the human dashboard, no more.
registerTool({
  name: 'staff_update_profile',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Updates routine profile fields for any staff member. Principal only — staff.update is a '
    + "principal-only action on the dashboard too, not HOD's.",
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      staff_id: { type: 'string', description: 'The staff id, or the staff member\'s staff code, resolved to an id internally.' },
      phone: { type: 'string', description: 'Optional new phone number.' },
      designation: { type: 'string', description: 'Optional new designation.' },
      qualification: { type: 'string', description: 'Optional new qualification.' },
      department_id: { type: 'string', description: 'Optional new department id.' },
    },
    required: ['staff_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const staffId = await staffService.resolveStaffId(client, actor.collegeId, params.staff_id);
    return staffService.updateStaff(
      client,
      staffId,
      {
        phone: params.phone, designation: params.designation, qualification: params.qualification, departmentId: params.department_id,
      },
      { userId: actor.userId },
    );
  },
});

// Workflow-submitting tools (L3 — create the same request a human
// submission already uses; never mutate the underlying record
// directly) --------------------------------------------------------

// The service functions these wrap each return their OWN shape (a raw
// workflow_requests row, or an object nesting one under
// `workflowRequest`) — never the notification-row shape
// assertL3ResultNotBypassed's `result.workflow_request_id` check
// happens to already match. This tags the real workflow request's
// id/status onto whatever the service returned, satisfying that same
// generic post-check without changing the check itself or any
// existing service function's own return contract.
function withWorkflowRequestId(result, workflowRequest) {
  return { ...result, workflow_request_id: workflowRequest.id, status: workflowRequest.status };
}

// finance_submit_fee_correction (RS-FIN-003, D5): "any later change to
// a fee status already marked once is a correction." Per RS-FIN-003's
// own AI field ("L3 workflow-submitting... routed to L3's own-department
// queue"), the AI tool is deliberately narrower than the human path
// (which also allows L4/class_tutor to submit) — only hod/principal
// may invoke this tool, a higher trust bar for an AI-initiated
// financial correction. Does NOT change the fee status — a hod must
// approve via POST /finance/fee-corrections/:correctionId/approve
// first; getEffectiveFeePaymentForStudent is what reflects an approved
// correction.
registerTool({
  name: 'finance_submit_fee_correction',
  level: 'L3',
  dataClassification: 'Restricted',
  description: "Submits a correction to a student's already-marked fee status for hod approval. Does NOT change "
    + 'the fee status — a hod must approve it first. Hod or principal only.',
  allowedRoles: ['principal', 'hod'],
  params: {
    type: 'object',
    properties: {
      fee_payment_id: {
        type: 'string', format: 'uuid', description: 'The id of the existing fee payment row to correct — from a prior finance read. Must be the exact internal id, there is no name to resolve it from.',
      },
      proposed_status: { type: 'string', description: "The corrected status: 'paid' or 'not_paid'." },
      reason: { type: 'string', description: 'Reason for the correction.' },
    },
    required: ['fee_payment_id', 'proposed_status'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const result = await financeService.requestFeeCorrection(
      client,
      params.fee_payment_id,
      { proposedStatus: params.proposed_status, reason: params.reason },
      { requestedByUserId: actor.userId, origin: 'ai' },
    );
    return withWorkflowRequestId(result.correction, result.workflowRequest);
  },
});

// assessment_submit_mark_correction (RS-ASM-003, D7): "any later write
// to a mark value that already exists is a correction." Per RS-ASM-003's
// own AI field ("L3 workflow-submitting"), the human path names Subject
// Faculty as the submitter (same broad role set assessment_record_mark
// above already uses) — does NOT change the mark itself, a class tutor
// must approve via POST /assessment-marks/corrections/:correctionId/approve
// first; getEffectiveMark is what reflects an approved correction.
registerTool({
  name: 'assessment_submit_mark_correction',
  level: 'L3',
  dataClassification: 'Internal',
  description: "Submits a correction to a student's already-recorded mark for the class tutor's approval. Does "
    + 'NOT change the mark — a class tutor must approve it first.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      assessment_mark_id: {
        type: 'string', format: 'uuid', description: 'The id of the existing assessment mark row to correct — from a prior marks read. Must be the exact internal id, there is no name to resolve it from.',
      },
      proposed_marks_obtained: { type: 'number', description: 'The corrected mark.' },
      reason: { type: 'string', description: 'Reason for the correction.' },
    },
    required: ['assessment_mark_id', 'proposed_marks_obtained'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const result = await assessmentService.requestMarkCorrection(
      client,
      params.assessment_mark_id,
      { proposedMarksObtained: params.proposed_marks_obtained, reason: params.reason },
      { requestedByUserId: actor.userId, origin: 'ai' },
    );
    return withWorkflowRequestId(result.correction, result.workflowRequest);
  },
});

registerTool({
  name: 'staff_submit_registration',
  level: 'L3',
  dataClassification: 'Internal',
  description: 'Submits a pending staff registration for HOD then principal approval. Does NOT activate the '
    + 'staff member — approval must happen via the workflow approvals screen first. HOD (of that staff member\'s '
    + 'own department) or principal.',
  allowedRoles: ['principal', 'hod'],
  params: {
    type: 'object',
    properties: {
      staff_id: { type: 'string', description: 'The id of the pending staff registration to submit for approval, or that staff member\'s staff code, resolved to an id internally.' },
    },
    required: ['staff_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const staffId = await staffService.resolveStaffId(client, actor.collegeId, params.staff_id);
    const workflowRequest = await staffService.submitStaffRegistration(
      client, staffId, { requestedByUserId: actor.userId, origin: 'ai' },
    );
    return withWorkflowRequestId(workflowRequest, workflowRequest);
  },
});

registerTool({
  name: 'students_submit_lifecycle_change',
  level: 'L3',
  dataClassification: 'Internal',
  description: "Submits a student lifecycle status change (Discontinued/Debarred/Dismissed/Graduated) for "
    + 'principal approval. Does NOT change the status — approval must happen via the workflow approvals screen first.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      student_id: { type: 'string', description: 'The student id, or the student\'s roll number, resolved to an id internally.' },
      new_status: { type: 'string', description: 'One of Discontinued, Debarred, Dismissed, Graduated.' },
      reason: { type: 'string', description: 'Reason for the change.' },
      effective_date: { type: 'string', description: 'Optional ISO date (YYYY-MM-DD) the change should take effect.' },
    },
    required: ['student_id', 'new_status', 'reason'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const studentId = await studentService.resolveStudentId(client, actor.collegeId, params.student_id);
    const result = await studentService.requestLifecycleStatusChange(
      client,
      studentId,
      { newStatus: params.new_status, reason: params.reason, effectiveDate: params.effective_date },
      { requestedByUserId: actor.userId, origin: 'ai' },
    );
    return withWorkflowRequestId(result, result.workflowRequest);
  },
});

registerTool({
  name: 'students_submit_transfer',
  level: 'L3',
  dataClassification: 'Internal',
  description: 'Submits an internal (same-college) student transfer request for principal approval. Does NOT '
    + 'move the student — approval must happen via the workflow approvals screen first.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      student_id: { type: 'string', description: 'The student id, or the student\'s roll number, resolved to an id internally.' },
      destination_class_id: { type: 'string', description: 'The class id to transfer to, or its class name, resolved to an id internally.' },
      reason: { type: 'string', description: 'Reason for the transfer.' },
    },
    required: ['student_id', 'destination_class_id', 'reason'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const [studentId, destinationClassId] = await Promise.all([
      studentService.resolveStudentId(client, actor.collegeId, params.student_id),
      academicService.resolveClassId(client, actor.collegeId, params.destination_class_id),
    ]);
    const result = await studentService.requestInternalTransfer(
      client,
      studentId,
      { destinationClassId, reason: params.reason },
      { requestedByUserId: actor.userId, origin: 'ai' },
    );
    return withWorkflowRequestId(result, result.workflowRequest);
  },
});

registerTool({
  name: 'academic_submit_timetable_for_approval',
  level: 'L3',
  dataClassification: 'Internal',
  description: "Submits a class's draft timetable for HOD then principal approval. Does NOT approve it — "
    + 'attendance marking for that class stays locked until a human approves via the workflow approvals screen.',
  allowedRoles: ['principal', 'hod'],
  params: {
    type: 'object',
    properties: {
      class_id: { type: 'string', description: 'The class id whose timetable should be submitted for approval, or its class name, resolved to an id internally.' },
    },
    required: ['class_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const classId = await academicService.resolveClassId(client, actor.collegeId, params.class_id);
    const workflowRequest = await academicService.submitTimetableForApproval(
      client, classId, { requestedByUserId: actor.userId, origin: 'ai' },
    );
    return withWorkflowRequestId(workflowRequest, workflowRequest);
  },
});

// --- 2026-07-26 UAT wiring: "ArcNave AI can do everything the currently
// authenticated account is authorized to do via the GUI — nothing more,
// nothing less — invoked only by an explicit user prompt, never
// automatically." Product principle, not a new gating mechanism: every
// tool below still goes through the same four gates (level, role,
// classification, scope) as every tool above it, and every direct-write
// tool here is a same-actor carve-out (RS-AIG-007/P4) on an action that
// was already a single, un-approved click for that actor on the
// dashboard — acknowledging a substitute duty, writing your own class
// log, your own note, your own preference, your own self-service
// profile field. None of these tools grant the AI anything the human
// could not already do unassisted, and none of them fire without the
// user typing a request first (the same "no autonomous invocation"
// property every other tool in this file already has).
//
// RS-PRF-001 previously read "AI: Prohibited... including the note's
// own owner acting through AI" — written before this principle was
// articulated, on the premise that AI touching personal notes was
// inherently a privacy risk. It is not: the AI acts as the same user
// who already owns the note, never on anyone else's behalf
// (personalNoteService enforces this identically for the AI path and
// the human path). That rule text is corrected alongside this wiring.

const classLogService = require('./classLogService');
const personalNoteService = require('./personalNoteService');
const userPreferenceService = require('./userPreferenceService');
const aiMemoryService = require('./aiMemoryService');
const activityTimelineService = require('./activityTimelineService');
const projectService = require('./projectService');

registerTool({
  name: 'class_log_list',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Lists the acting user's own teaching-journal entries (topic taught, per class/date/subject), "
    + 'optionally filtered to one class. With no class named, returns entries across every class the acting user '
    + 'may see.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      class_id: { type: 'string', description: "Optional class id or class name, resolved to an id internally. Omit to search across every class the acting user may see." },
      subject: { type: 'string', description: 'Optional subject name to filter by.' },
      from_date: { type: 'string', description: 'Optional ISO date, inclusive lower bound on session date.' },
      to_date: { type: 'string', description: 'Optional ISO date, inclusive upper bound on session date.' },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const classId = params.class_id
      ? await academicService.resolveClassId(client, actor.collegeId, params.class_id)
      : undefined;
    // limit: caps this tool's own result at the most recent entries —
    // the query is already ORDER BY session_date DESC, so this is a
    // genuine "recent journal entries" view, not an arbitrary
    // truncation. The human-facing GET /class-logs route is untouched.
    return classLogService.listLogEntries(
      client,
      {
        classId, subject: params.subject, fromDate: params.from_date, toDate: params.to_date, limit: 200,
      },
      { actorUserId: actor.userId, actorRole: actor.role, collegeId: actor.collegeId },
    );
  },
});

registerTool({
  name: 'class_log_create',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Adds a teaching-journal entry (topic taught, optional notes) for a class the acting user may view "
    + "— same-actor direct write, no different from typing it into the Class Log tab. Fails if the acting user "
    + "cannot view the named class.",
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      class_id: { type: 'string', description: "The class id or class name, resolved to an id internally." },
      subject: { type: 'string', description: 'The subject taught in this session.' },
      session_date: { type: 'string', description: 'ISO date the session took place.' },
      topic: { type: 'string', description: 'The topic actually covered.' },
      notes: { type: 'string', description: 'Optional notes (e.g. homework assigned).' },
    },
    required: ['class_id', 'subject', 'session_date', 'topic'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const classId = await academicService.resolveClassId(client, actor.collegeId, params.class_id);
    return classLogService.createLogEntry(
      client,
      {
        classId, subject: params.subject, sessionDate: params.session_date, topic: params.topic, notes: params.notes,
      },
      { actorUserId: actor.userId, actorRole: actor.role, collegeId: actor.collegeId },
    );
  },
});

registerTool({
  name: 'personal_notes_list',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Lists the acting user's own private notes/reminders. Never any other user's — a personal note has "
    + 'no institutional visibility for anyone, AI included.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => personalNoteService.listNotes(client, { actorUserId: actor.userId }),
});

registerTool({
  name: 'personal_notes_create',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Creates a private note/reminder for the acting user only — same-actor direct write, identical to "
    + 'using the Personal Notes panel themselves.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Optional short title.' },
      body: { type: 'string', description: 'The note content.' },
      reminder_at: { type: 'string', description: 'Optional ISO timestamp to remind at.' },
    },
    required: ['body'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => personalNoteService.createNote(
    client,
    { title: params.title, body: params.body, reminderAt: params.reminder_at },
    { actorUserId: actor.userId, collegeId: actor.collegeId },
  ),
});

// Step 6 (Approved Spec §12) AI-parity requirement — same-actor
// carve-out (RS-AIG-007/P4), no different from typing into the
// Project page's own Instructions field or document picker/remove
// button. Both scoped strictly to the acting user's own project
// (projectService's ownership check is the only authority here, same
// as every projects.js route).
registerTool({
  name: 'update_project_instructions',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Replaces the acting user's own project's custom instructions field — same-actor direct write, no "
    + "different from editing the Instructions field on that project's page. Fails if the acting user does not own "
    + 'the named project.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string', format: 'uuid', description: 'The project id to update. Must be the exact internal id — from a project the user is currently chatting inside, or a prior list result. Never guess one.',
      },
      instructions: { type: 'string', description: 'The new instructions text, replacing the previous value entirely.' },
    },
    required: ['project_id', 'instructions'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => projectService.updateProject(
    client, params.project_id, { instructions: params.instructions }, { userId: actor.userId },
  ),
});

registerTool({
  name: 'manage_project_document',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Attaches or detaches a document from the acting user's own project's reference context — "
    + "same-actor direct write, no different from that project page's document picker/remove button. Never "
    + 'deletes the document itself, only the link. The document must already be one the acting user owns.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string', format: 'uuid', description: 'The project id. Must be the exact internal id, never guessed.',
      },
      document_id: {
        type: 'string', format: 'uuid', description: 'The document id. Must be the exact internal id, never guessed.',
      },
      action: {
        type: 'string', enum: ['attach', 'detach'], description: "'attach' to add the document as context, 'detach' to remove it.",
      },
    },
    required: ['project_id', 'document_id', 'action'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => (params.action === 'attach'
    ? projectService.attachProjectDocument(client, params.project_id, { documentId: params.document_id }, { userId: actor.userId })
    : projectService.detachProjectDocument(client, params.project_id, params.document_id, { userId: actor.userId })),
});

registerTool({
  name: 'activity_timeline_read',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Reads the acting user's own activity timeline (attendance marked, marks submitted, corrections "
    + 'requested, admissions performed, and every other audited action they have taken). Self-only — never '
    + "another account's timeline.",
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      limit: { type: 'integer', description: 'Optional max rows to return.' },
    },
    required: [],
    additionalProperties: false,
  },
  handler: (client, params, actor) => activityTimelineService.getOwnActivity(
    client,
    { actorUserId: actor.userId, limit: params.limit },
  ),
});

registerTool({
  name: 'user_preferences_list',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Lists the acting user's own stored preferences (saved filters, dashboard layout, notification "
    + 'channel choices).',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => userPreferenceService.listPreferences(client, { actorUserId: actor.userId }),
});

// Scoped Preference Memory (P2.4, CHECKPOINT.md's Bucket B design) —
// this is the ONE place natural language reaches userPreferenceService,
// so it's the one place the "never freeform facts about a person"
// safety rule has to actually be enforced, not just described. The
// underlying service/table stays genuinely general-purpose (any key,
// any value) for its real intended consumer — a future human-driven
// settings UI hitting routes/userPreferences.js directly, a completely
// separate code path this restriction never touches — because an
// unconstrained key space is fine when a person is choosing it, and
// only becomes a risk when an LLM's own judgment picks the key from
// open conversation. AI_ALLOWED_PREFERENCE_KEYS is enforced in the
// handler itself, not just declared in the JSON schema: aiToolRegistry's
// own assertParamsValid (see its file comment) only checks
// required/array-shape, never `enum`, so a schema-only restriction
// would be a prompt hint an LLM could still be talked past, not a real
// gate.
const AI_ALLOWED_PREFERENCE_KEYS = ['report_format', 'default_chart', 'language'];

registerTool({
  name: 'user_preferences_set',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Sets one of the acting user's own AI-response preferences — same-actor direct write. Only "
    + `${AI_ALLOWED_PREFERENCE_KEYS.join(', ')} may be set through this tool, never a freeform key: this is for `
    + "how the user wants answers presented, never a place to remember facts, notes, or opinions about a "
    + 'student, staff member, or anyone else.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      preference_key: { type: 'string', enum: AI_ALLOWED_PREFERENCE_KEYS, description: 'The preference name.' },
      value: { type: 'string', description: 'The value to store.' },
    },
    required: ['preference_key', 'value'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => {
    if (!AI_ALLOWED_PREFERENCE_KEYS.includes(params.preference_key)) {
      throw new AiToolInvalidParamsError(
        `preference_key must be one of ${AI_ALLOWED_PREFERENCE_KEYS.map((k) => JSON.stringify(k)).join(', ')}, `
        + `got ${JSON.stringify(params.preference_key)}`,
      );
    }
    return userPreferenceService.setPreference(
      client, params.preference_key, params.value, { actorUserId: actor.userId, collegeId: actor.collegeId },
    );
  },
});

// Scoped AI Preference Memory (CHECKPOINT.md's P1 item, deferred out of the
// chat-attachment governance pass) — a bounded, consent-gated version of
// "the AI remembers things you told it," distinct from user_preferences_set
// above (that one is an AI-response *display* setting with no retention
// risk; this one is the AI persisting something a human said in
// conversation, which is exactly the "unbounded/unauditable PII retention"
// risk CHECKPOINT.md's own roadmap flagged). Five tools total (the three
// below plus ai_memory_remember_fact/ai_memory_forget_fact further down,
// general freeform memory added this round) — but still no sixth: there is
// NO ai_memory_consent_set tool. Consent can only be
// granted or revoked by the human directly, through routes/aiMemory.js —
// see aiMemoryService.js's own file comment for why that split is the
// actual safety property here, not a formality.
registerTool({
  name: 'ai_memory_consent_status',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Reads whether the acting user has opted in to AI Memory (the AI remembering their stated "
    + 'preferences across conversations). If false, tell the user they can turn it on in AI Memory settings '
    + '— never claim it is already on, never suggest you can turn it on for them.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => aiMemoryService.getConsent(client, { actorUserId: actor.userId }),
});

registerTool({
  name: 'ai_memory_remember',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Remembers one fact about how the acting user wants to work with the AI, for future "
    + `conversations. Only ${aiMemoryService.ALLOWED_MEMORY_TYPES.join(', ')} may be set — never a freeform `
    + 'type, and never a fact, note, or opinion about a student, staff member, or anyone other than the '
    + 'acting user themselves. Fails if the user has not opted in to AI Memory yet — if it fails for that '
    + 'reason, tell them where to turn it on, do not retry.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      memory_type: { type: 'string', enum: aiMemoryService.ALLOWED_MEMORY_TYPES, description: 'The kind of preference being remembered.' },
      value: { type: 'string', description: 'The preference itself, in the user\'s own words (short).' },
    },
    required: ['memory_type', 'value'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => {
    if (!aiMemoryService.ALLOWED_MEMORY_TYPES.includes(params.memory_type)) {
      throw new AiToolInvalidParamsError(
        `memory_type must be one of ${aiMemoryService.ALLOWED_MEMORY_TYPES.map((t) => JSON.stringify(t)).join(', ')}, `
        + `got ${JSON.stringify(params.memory_type)}`,
      );
    }
    return aiMemoryService.rememberPreference(
      client, params.memory_type, params.value, { actorUserId: actor.userId, collegeId: actor.collegeId },
    );
  },
});

registerTool({
  name: 'ai_memory_forget',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Deletes one previously remembered AI Memory fact for the acting user. Always allowed, even '
    + 'if AI Memory is currently turned off.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      memory_type: { type: 'string', enum: aiMemoryService.ALLOWED_MEMORY_TYPES, description: 'The kind of preference to forget.' },
    },
    required: ['memory_type'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => {
    if (!aiMemoryService.ALLOWED_MEMORY_TYPES.includes(params.memory_type)) {
      throw new AiToolInvalidParamsError(
        `memory_type must be one of ${aiMemoryService.ALLOWED_MEMORY_TYPES.map((t) => JSON.stringify(t)).join(', ')}, `
        + `got ${JSON.stringify(params.memory_type)}`,
      );
    }
    return aiMemoryService.forgetPreference(client, params.memory_type, { actorUserId: actor.userId });
  },
});

// General freeform AI Memory (product decision, this round) — the four
// bounded types above only ever cover a fixed set of named categories; a
// user telling the AI something worth remembering that doesn't fit one of
// those (e.g. "I mostly work with the placement cell data") had nowhere to
// go. Same consent gate, same per-user account scope, same "never a fact
// about anyone but the acting user" boundary as ai_memory_remember — see
// that boundary spelled out in this tool's own description below, since
// there is no allowlist-of-types here to enforce it structurally the way
// the bounded tool's enum does. aiMemoryService.rememberFact still enforces
// what a schema-level enum can't: a hard MAX_GENERAL_FACTS cap, and a
// narrow deterministic rejection of anything containing a bare identifier-
// shaped number (roll/EMIS/admission/phone number) as a backstop under
// this instruction, not a replacement for it.
registerTool({
  name: 'ai_memory_remember_fact',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Remembers one freeform fact about the acting user themselves — their own role, working '
    + 'context, standing instructions, or preferences not covered by ai_memory_remember\'s fixed categories '
    + '(e.g. "I mostly handle the placement cell", "always double-check attendance numbers before reporting '
    + 'them to me"). NEVER a fact, note, opinion, or observation about a student, staff member, or anyone '
    + 'other than the acting user themselves — that is a hard line, not a style preference, regardless of how '
    + 'the user phrases the request; if asked to remember something about someone else, decline and explain '
    + 'why rather than rephrasing it to slip through. NEVER an identifier number (roll number, EMIS number, '
    + 'admission number, phone number) even about the acting user themselves. Fails if the user has not opted '
    + 'in to AI Memory yet, or if they are already remembering the maximum — in either case tell them plainly '
    + 'and do not retry.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      fact: { type: 'string', description: 'The fact itself, in the user\'s own words (short, one sentence).' },
    },
    required: ['fact'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => aiMemoryService.rememberFact(
    client, params.fact, { actorUserId: actor.userId, collegeId: actor.collegeId },
  ),
});

registerTool({
  name: 'ai_memory_forget_fact',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Deletes one previously remembered general fact (ai_memory_remember_fact), by its id. Fact ids '
    + 'are only ever visible in the "Remembered preferences" background context this same acting user\'s own '
    + 'session already carries — never guess or invent one. Always allowed, even if AI Memory is currently '
    + 'turned off.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      fact_id: { type: 'string', description: 'The id of the fact to forget, exactly as given in the background context.' },
    },
    required: ['fact_id'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => aiMemoryService.forgetFact(client, params.fact_id, { actorUserId: actor.userId }),
});

// A live-caught gap: a user typed "now i need it as pdf" inside an
// artifact's own revision chat and the model correctly said it couldn't —
// there was no tool for it at all, only artifactService.publishArtifact
// (backend) and artifactsApi.publish (frontend), neither ever called from
// anywhere. Same self-owned-write shape as user_preferences_set above
// (L1, not humanOnly, broad allowedRoles): publishing only ever touches
// the acting user's own artifact and produces one markdown document under
// their own Documents/AI Artifacts folder, nothing institutional. Needs
// the artifact's real id, which the LLM has no way to know on its own —
// WorkspaceProvider.jsx's sendMessage now sends focusContext
// { entityType: 'artifact', id } for exactly this scope, the same
// mechanism buildFocusHint already renders as a "Context:" line for every
// other entity type; this tool's description tells the model to read the
// id from there rather than asking the user to repeat it.
const artifactService = require('./artifactService');
const imageGenerationService = require('./imageGenerationService');

// A deeper gap behind the same live-caught moment: the model's replies
// inside an artifact's revision chat ("Here is a one-page draft on
// Nature...") were only ever chat text — nothing ever wrote that draft
// into the artifact's own `content` (artifactRepository.js), which is what
// export_artifact above actually publishes and what ArtifactEditor.jsx's
// canvas is meant to show. Without this tool the two were completely
// disconnected: a user could see a full draft in chat, ask to export it,
// and get a document containing only the original placeholder heading.
// Same shape/reasoning as export_artifact (self-owned write, needs the
// same focusContext-supplied id) — see that tool's own comment.
registerTool({
  name: 'update_artifact_content',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Replaces the full body of the artifact currently open in this workspace (see the "Context:" line '
    + "naming its id) with new markdown content — the actual mechanism behind drafting or revising the document "
    + 'itself, not just describing it in chat. Call this whenever the user asks you to write, draft, generate, or '
    + 'revise the artifact\'s own content (e.g. "write a notice about the holiday," "make the deadline 5 '
    + 'September instead") — pass the complete new document text, not a diff or just the changed part, since this '
    + "replaces the whole body. Only works on an artifact the acting user owns and hasn't already published.",
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      artifact_id: {
        type: 'string', format: 'uuid', description: "The exact internal id of the artifact currently open, from this conversation's own \"Context:\" line — never guess or invent one.",
      },
      content: { type: 'string', description: "The complete new document body, in markdown, replacing what's there now." },
    },
    required: ['artifact_id', 'content'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => artifactService.updateArtifact(
    client, params.artifact_id, { content: params.content }, { userId: actor.userId },
  ),
});

// Shared by export_artifact/generate_document/export_artifact_as below —
// one format vocabulary, matching markdownFormatConverter.FORMATS exactly
// so a value that validates here is guaranteed to convert successfully
// (modulo the csv/xlsx-needs-a-table content rule, which surfaces as its
// own honest ArtifactValidationError, not a schema failure).
const EXPORT_FORMAT_PARAM = {
  type: 'string',
  enum: ['markdown', 'docx', 'pdf', 'txt', 'csv', 'xlsx', 'pptx'],
  description: 'Output file format. Defaults to markdown if omitted. csv/xlsx only work when the content actually '
    + 'contains a table — if it does not, this fails with a clear message rather than producing an empty file; tell '
    + 'the user plainly and suggest docx/pdf/txt/pptx instead of retrying the same format. pptx turns the content '
    + 'into a real slide deck (one slide per major heading) — use it for requests like "make this a presentation" '
    + 'or "N slides on X".',
};

registerTool({
  name: 'export_artifact',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Publishes the artifact currently open in this workspace (see the \"Context:\" line naming its id) "
    + "into the acting user's own Documents, as a downloadable file — the actual answer to a request like \"export "
    + 'this as a document/PDF/Word/docx file\" or "save this." Pass `format` when the user names one (e.g. "as a '
    + 'docx", "as PDF") — defaults to markdown otherwise. Only works on an artifact the acting user owns, and only '
    + 'once — an already-published artifact cannot be published again; use export_artifact_as for a second format.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      artifact_id: {
        type: 'string', format: 'uuid', description: "The exact internal id of the artifact currently open, from this conversation's own \"Context:\" line — never guess or invent one.",
      },
      format: EXPORT_FORMAT_PARAM,
    },
    required: ['artifact_id'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => artifactService.publishArtifact(
    client, params.artifact_id, { userId: actor.userId, collegeId: actor.collegeId, format: params.format },
  ),
});

// The retroactive "now give me that AS docx too" tool — the live-caught
// gap this round: a user who already got a report as markdown, then asked
// for docx afterward, had no tool that could answer without re-publishing
// (impossible — publish is terminal) or losing the artifact's identity.
// Unlike export_artifact above, this does NOT require the artifact to be
// the one currently open — artifact_id can come from list_own_artifacts
// (below) when the model needs to resolve "that report from earlier" by
// title/recency across turns.
registerTool({
  name: 'export_artifact_as',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Creates a NEW downloadable document from an existing artifact in a different format than it was '
    + 'already saved as — the answer to a follow-up like "now give me that as docx" or "I need it as PDF too," '
    + 'asked after the artifact was already published (or even while still a draft). Works any number of times; '
    + "each call adds a new document, never replaces or deletes what's already there. Requires the real "
    + 'artifact_id — if it is not already known from this conversation\'s own "Context:" line, call '
    + 'list_own_artifacts first to resolve it by title, never guess one.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      artifact_id: {
        type: 'string', format: 'uuid', description: 'The exact internal id of the artifact to export, from the "Context:" line or from list_own_artifacts — never guess or invent one.',
      },
      format: EXPORT_FORMAT_PARAM,
    },
    required: ['artifact_id', 'format'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => artifactService.exportArtifactAs(
    client, params.artifact_id, params.format, { userId: actor.userId, collegeId: actor.collegeId },
  ),
});

// A thin, read-only wrap of the existing ArtifactService.listOwnArtifacts
// — no new business logic. Exists specifically so export_artifact_as
// (above) can resolve an artifact created in an earlier turn (e.g. by
// generate_document below) by title/recency, the same way the model would
// look up any other entity it doesn't already have an id for — never a
// reason to invent/guess an id.
registerTool({
  name: 'list_own_artifacts',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Lists the acting user's own AI artifacts (documents/reports the AI has created or saved for them), "
    + 'most recent first, with each one\'s id/title/status — use this to resolve "that report from earlier" or '
    + '"the ECE comparison" to a real artifact_id before calling export_artifact_as, never guess or invent one.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object', properties: {}, required: [], additionalProperties: false,
  },
  handler: (client, params, actor) => artifactService.listOwnArtifacts(
    client, { userId: actor.userId, limit: 20 },
  ),
});

// A live-caught gap one layer up from export_artifact: a user asked "give
// this as word document" from an ORDINARY chat (no artifact open at all —
// focusContext is only ever sent for scope 'artifact', WorkspaceProvider.jsx's
// own sendMessage), so export_artifact had no artifact_id to work with and
// the model correctly said it couldn't export anything — genuinely true for
// it specifically, but the underlying capability (documentService.
// uploadPersonalDocument) it would have used is the exact same one
// export_artifact already calls indirectly (via artifactService.
// publishArtifact); there was simply no tool exposing it outside an
// artifact. This is that same mechanism, without requiring an artifact to
// already exist — the actual answer whenever an ordinary chat gets asked to
// save/export/download something as a document/PDF/Word file.
//
// Now creates a real Artifact first (createArtifact + publishArtifact),
// instead of calling documentService.uploadPersonalDocument directly —
// closes a pre-existing CLAUDE.md rule 2 gap (AI-generated structured
// content must be ArtifactService-owned, not written to DocumentService
// as a bare file) as a side effect, and is what makes a report created
// this way re-exportable in another format later via export_artifact_as
// (a bare, artifact-less document has no such path — list_own_artifacts
// wouldn't even find it). Same external behavior otherwise: still lands
// in the acting user's Documents, "AI Artifacts" folder.
registerTool({
  name: 'generate_document',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Saves markdown content as a real, downloadable document in the acting user\'s own Documents — '
    + 'the actual mechanism behind a request like "give me this as a document/Word file/PDF/download" made in an '
    + 'ordinary chat. Pass `format` when the user names one (e.g. "as a docx report", "as a PDF") — defaults to '
    + 'markdown otherwise. Use what was already discussed in this conversation as the content when the user is '
    + 'asking to save something already written, rather than re-asking them to restate it.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'A short, descriptive title for the document.' },
      content: { type: 'string', description: 'The full document content, in markdown.' },
      format: EXPORT_FORMAT_PARAM,
    },
    required: ['title', 'content'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const artifact = await artifactService.createArtifact(
      client,
      { title: params.title, content: params.content },
      { userId: actor.userId, collegeId: actor.collegeId },
    );
    return artifactService.publishArtifact(
      client, artifact.id, { userId: actor.userId, collegeId: actor.collegeId, format: params.format },
    );
  },
});

// Image generation (RS-AIG-025) — thin wrapper over imageGenerationService,
// the same one-Business-Service-method-per-tool shape every other tool
// in this file follows. Registered L2 (Generate) per RS-AIG-001's own
// table — an artifact-producing tool with no effect reaching outside the
// system, same class as generate_document above. (generate_document
// itself is registered L1 in this file — a pre-existing discrepancy
// against RS-AIG-001's table this pass does not resolve, the same class
// of finding round 20's "AI capability reconciliation" flagged once
// already for a different tool, not silently copied here.) Off by
// default per college — imageGenerationService.generateImage itself
// throws ImageGenerationNotEnabledError at call time, mirroring
// fetch_trusted_web_page's own real precedent (verified against that
// registration, not assumed): the tool stays listed, the Business
// Service is the actual gate.
registerTool({
  name: 'generate_image',
  level: 'L2',
  dataClassification: 'Internal',
  description: 'Generates an image from a text prompt and saves it as a real, downloadable file in the acting '
    + 'user\'s own Documents. Only available if this college has opted into image generation and the configured '
    + 'AI provider supports it — if not, say so plainly rather than pretending an image was created.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'A clear description of the image to generate.' },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => imageGenerationService.generateImage(
    client, { prompt: params.prompt }, { collegeId: actor.collegeId, actorUserId: actor.userId },
  ),
});

registerTool({
  name: 'substitute_duties_list',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Lists every substitute-teaching assignment where the acting user IS the substitute, across every "
    + 'class, with acknowledgement status.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => academicService.listMySubstituteAssignments(
    client, { substituteStaffUserId: actor.userId },
  ),
});

registerTool({
  name: 'substitute_duty_acknowledge',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Acknowledges a substitute-teaching assignment — same-actor direct write, identical to pressing '
    + 'Acknowledge on the dashboard. Only the named substitute may acknowledge their own assignment.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      assignment_id: { type: 'string', format: 'uuid', description: 'The substitute assignment id to acknowledge. Must be the exact internal id, e.g. from substitute_duties_list — never guess one.' },
    },
    required: ['assignment_id'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => academicService.acknowledgeSubstituteAssignment(
    client, params.assignment_id, { actorUserId: actor.userId, collegeId: actor.collegeId },
  ),
});

registerTool({
  name: 'staff_self_profile_get',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Reads the acting user's own staff profile.",
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => staffService.getOwnProfile(client, { userId: actor.userId }),
});

registerTool({
  name: 'staff_self_profile_update',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Updates the acting user's own self-service profile fields only (phone, address, emergency "
    + 'contact) — same-actor direct write, identical to the My Profile screen. Administrative fields '
    + '(designation, qualification, bank/PF, etc.) are principal-only and NOT reachable through this tool — use '
    + 'staff_update_profile for those, as a principal.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      phone: { type: 'string', description: 'Optional new phone number.' },
      address: { type: 'string', description: 'Optional new address.' },
      emergency_contact_name: { type: 'string', description: 'Optional emergency contact name.' },
      emergency_contact_phone: { type: 'string', description: 'Optional emergency contact phone.' },
      emergency_contact_relation: { type: 'string', description: 'Optional emergency contact relation.' },
    },
    required: [],
    additionalProperties: false,
  },
  handler: (client, params, actor) => staffService.updateOwnProfile(
    client,
    {
      phone: params.phone,
      address: params.address,
      emergencyContactName: params.emergency_contact_name,
      emergencyContactPhone: params.emergency_contact_phone,
      emergencyContactRelation: params.emergency_contact_relation,
    },
    { userId: actor.userId },
  ),
});

// --- 2026-07-26 UAT wiring, second pass: student flag (a manual
// watchlist marker with a required remark) — same ownership boundary
// as students_update_profile above (assertCanModifyStudent: the
// class's own L4, HOD's own department, or Principal college-wide),
// not a same-actor-only tool the way the personal-workspace tools are.

registerTool({
  name: 'students_flag',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Raises a manual flag on a student within the acting user's own scope, with a required remark "
    + '(e.g. a behavioral or attendance concern). Fails if the student is not in the acting user\'s scope.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      student_id: { type: 'string', description: "The student id, or the student's roll number, resolved to an id internally." },
      remark: { type: 'string', description: 'Required reason for the flag.' },
    },
    required: ['student_id', 'remark'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const studentId = await studentService.resolveStudentId(client, actor.collegeId, params.student_id);
    return studentService.flagStudent(
      client, studentId, { remark: params.remark }, { actorUserId: actor.userId, actorRole: actor.role },
    );
  },
});

registerTool({
  name: 'students_flag_clear',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Clears the active flag on a student within the acting user's own scope. Fails if the student has "
    + 'no active flag, or is not in the acting user\'s scope.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      student_id: { type: 'string', description: "The student id, or the student's roll number, resolved to an id internally." },
    },
    required: ['student_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const studentId = await studentService.resolveStudentId(client, actor.collegeId, params.student_id);
    return studentService.clearStudentFlag(client, studentId, { actorUserId: actor.userId, actorRole: actor.role });
  },
});

// Capability Coverage Audit finding (cross-role #2): no AI tool
// existed for reports/exports at all, for any role — reports.generate/
// reports.student_export were GUI-only. Four thin wrappers, one per
// existing Business Service call (no dispatcher — see this file's own
// governing-principle comment further up), matching reportService's
// own four report types and routes/reports.js's own permission split
// (student-export has its own wider permission key; the other three
// share reports.generate, principal-only).
const reportService = require('./reportService');

registerTool({
  name: 'reports_student_export',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Generates a student export report (CSV/Excel) scoped to the acting user's own visible students "
    + "(own class as tutor, own department as HOD, or college-wide as principal) — the same action as the "
    + 'Reports → Student Export screen. Returns the generated_reports row; the file itself is stored as a '
    + 'document.',
  allowedRoles: ['principal', 'hod', 'staff'],
  params: {
    type: 'object',
    properties: {
      format: { type: 'string', description: "'csv' or 'xlsx'. Defaults to 'csv'." },
      student_ids: { type: 'array', items: { type: 'string' }, description: 'Optional — restrict the export to these specific student ids. Omit to export every visible student.' },
    },
    required: [],
    additionalProperties: false,
  },
  handler: (client, params, actor) => reportService.generateStudentExportReport(
    client,
    { collegeId: actor.collegeId, format: params.format, studentIds: params.student_ids },
    { actorUserId: actor.userId, actorRole: actor.role },
  ),
});

registerTool({
  name: 'reports_generate_attendance',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Generates a college-wide attendance report (CSV/Excel) — the same action as the Reports → '
    + 'Attendance screen. Principal only.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      format: { type: 'string', description: "'csv' or 'xlsx'. Defaults to 'csv'." },
    },
    required: [],
    additionalProperties: false,
  },
  handler: (client, params, actor) => reportService.generateAttendanceReport(
    client,
    { collegeId: actor.collegeId, format: params.format },
    { actorUserId: actor.userId },
  ),
});

registerTool({
  name: 'reports_generate_finance',
  level: 'L1',
  dataClassification: 'Restricted',
  description: 'Generates a college-wide finance report (CSV/Excel) — the same action as the Reports → Finance '
    + 'screen. Principal only — fee data is Restricted, and only the principal role has AI access to Restricted '
    + 'data.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      format: { type: 'string', description: "'csv' or 'xlsx'. Defaults to 'csv'." },
    },
    required: [],
    additionalProperties: false,
  },
  handler: (client, params, actor) => reportService.generateFinanceReport(
    client,
    { collegeId: actor.collegeId, format: params.format },
    { actorUserId: actor.userId },
  ),
});

registerTool({
  name: 'reports_generate_assessment_marks',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Generates an assessment marks report (CSV/Excel), optionally filtered by academic year/department/'
    + 'class/subject/assessment type — the same action as the Reports → Assessment Marks screen. Principal only.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      format: { type: 'string', description: "'csv' or 'xlsx'. Defaults to 'csv'." },
      academic_year: { type: 'string', description: "Optional academic year filter, e.g. '2025-2026'." },
      department_id: { type: 'string', description: 'Optional department id filter.' },
      class_id: { type: 'string', description: 'Optional class id, or class name, resolved to an id internally.' },
      subject: { type: 'string', description: 'Optional subject filter.' },
      assessment_type_id: { type: 'string', description: 'Optional assessment type id, or its name, resolved to an id internally.' },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const [classId, assessmentTypeId] = await Promise.all([
      params.class_id ? academicService.resolveClassId(client, actor.collegeId, params.class_id) : null,
      params.assessment_type_id ? assessmentService.resolveAssessmentTypeId(client, actor.collegeId, params.assessment_type_id) : null,
    ]);
    return reportService.generateAssessmentMarksReport(
      client,
      {
        collegeId: actor.collegeId,
        format: params.format,
        filters: {
          academicYear: params.academic_year,
          departmentId: params.department_id,
          classId,
          subject: params.subject,
          assessmentTypeId,
        },
      },
      { actorUserId: actor.userId },
    );
  },
});

// --- Phase 8 (ROLE-COVERAGE "Intentionally Deferred" remediation) -----
// Three real, acknowledged gaps closed here — see
// docs/bka/20-matrices/ROLE-COVERAGE.md's "Intentionally Deferred"
// section. Each tool is a thin wrapper over the exact same Business
// Service function its own existing REST route already calls (never
// new business logic), reusing that route's own permission key rather
// than inventing a new one.

const classTutorService = require('./classTutorService');

// HOD -> Assign Class Tutor: classes.assign_tutor (['hod']) already
// gates routes/classes.js's POST /classes/:id/tutor
// (classTutorService.assignClassTutor). Reassignment (PUT, ['hod'])
// is deliberately NOT covered here — the ROLE-COVERAGE gap named only
// first-time assignment, and reassignment is a distinct GUI action
// this pass wasn't asked to close. Not humanOnly: this is a plain role
// (HOD, own department) + row-state (no existing occupant) gate,
// immediately executed the same way the GUI's own tutor-assignment
// action already is today — no different in kind from
// students_update_profile/staff_update_profile/calendar_create_event
// above, none of which are humanOnly either. L1: an internal record
// write with no external dispatch (contrast upload_institutional_document/
// class_send_alert, both humanOnly because they put something in front
// of a document repository or a real recipient outside this system).
registerTool({
  name: 'class_assign_tutor',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Assigns a Class Tutor to a class that does not have one yet — the same action as the class\'s own '
    + 'Assign Tutor action. Fails if the acting user is not this department\'s HOD, or if the class already has an '
    + 'active Class Tutor (use a reassignment instead, not exposed here).',
  allowedRoles: ['hod'],
  params: {
    type: 'object',
    properties: {
      class_id: { type: 'string', description: 'The class id, or the class name, resolved to an id internally.' },
      new_tutor_user_id: { type: 'string', description: 'The user id of the staff member to assign as Class Tutor.' },
    },
    required: ['class_id', 'new_tutor_user_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const classId = await academicService.resolveClassId(client, actor.collegeId, params.class_id);
    return classTutorService.assignClassTutor(
      client,
      classId,
      { newTutorUserId: params.new_tutor_user_id, actorUserId: actor.userId },
    );
  },
});

// Principal -> Department CRUD: departments.create/update/delete
// (['principal']) already gate routes/departments.js's own POST/PUT/
// DELETE /departments(/:id) (collegeProfileService.createDepartment/
// updateDepartment/removeDepartment). Create/update are plain L1
// record writes, same reasoning as class_assign_tutor above. Delete is
// different: this file's own standing rule for the Copilot tools above
// is explicit — "Delete is never a direct tool, full stop." — so
// departments_delete is humanOnly: true (the LLM may explain what a
// delete would do, but only the user's own explicit confirm action in
// the chat UI reaches the handler), matching the
// upload_institutional_document/class_send_alert pattern for an
// action with real, non-undoable-by-another-write consequences
// (cascading department removal) rather than the "record write you
// can just write again" shape create/update have.
registerTool({
  name: 'departments_create',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Creates a new department — the same action as the Institution -> Departments -> Add Department '
    + 'screen. Immediately generates that department\'s classes from courseDuration/defaultSections (same as the '
    + 'GUI action).',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The department name, e.g. "ECE".' },
      approved_intake: { type: 'number', description: 'Optional approved student intake for this department.' },
      course_duration: { type: 'number', description: 'Course duration in years (integer, at least 2).' },
      default_sections: { type: 'number', description: 'Default number of sections per year (positive integer).' },
    },
    required: ['name', 'course_duration', 'default_sections'],
    additionalProperties: false,
  },
  // Second optimization pass, finding #4: course_duration × default_sections
  // is the exact, deterministic number of classes this call cascades
  // into creating (one class per year × section) — not a proxy, the
  // real count, computable directly from the two required params with
  // no DB call. confirmAt sits above what any real department's own
  // course structure needs; rejectAt guards against a malformed/
  // injected huge duration or section count triggering a runaway
  // class-creation cascade.
  maxAffectedRows: {
    estimate: (params) => (Number(params.course_duration) || 0) * (Number(params.default_sections) || 0),
    confirmAt: 30,
    rejectAt: 100,
  },
  handler: (client, params, actor) => collegeProfileService.createDepartment(
    client,
    {
      collegeId: actor.collegeId,
      name: params.name,
      approvedIntake: params.approved_intake,
      courseDuration: params.course_duration,
      defaultSections: params.default_sections,
    },
    { actorUserId: actor.userId },
  ),
});

registerTool({
  name: 'departments_update',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Updates an existing department\'s name/approved intake/course duration/default sections — the same '
    + 'action as the Institution -> Departments -> Edit Department screen. Only the fields actually passed are '
    + 'changed.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      department_id: { type: 'string', description: 'The department id, or the department name, resolved to an id internally.' },
      name: { type: 'string', description: 'New department name, if changing.' },
      approved_intake: { type: 'number', description: 'New approved student intake, if changing.' },
      course_duration: { type: 'number', description: 'New course duration in years, if changing.' },
      default_sections: { type: 'number', description: 'New default number of sections per year, if changing.' },
    },
    required: ['department_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const departmentId = await collegeProfileService.resolveDepartmentId(client, actor.collegeId, params.department_id);
    const fields = {};
    if (params.name !== undefined) fields.name = params.name;
    if (params.approved_intake !== undefined) fields.approvedIntake = params.approved_intake;
    if (params.course_duration !== undefined) fields.courseDuration = params.course_duration;
    if (params.default_sections !== undefined) fields.defaultSections = params.default_sections;
    return collegeProfileService.updateDepartment(client, departmentId, fields, { actorUserId: actor.userId });
  },
});

registerTool({
  name: 'departments_delete',
  level: 'L2',
  dataClassification: 'Internal',
  humanOnly: true,
  description: 'Deletes a department — the same action as the Institution -> Departments -> Delete Department '
    + 'screen. Never called by the AI on its own — only reachable via the user\'s own explicit confirm action in '
    + 'the chat UI, after being shown what will be removed.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      department_id: { type: 'string', description: 'The department id, or the department name, resolved to an id internally.' },
    },
    required: ['department_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const departmentId = await collegeProfileService.resolveDepartmentId(client, actor.collegeId, params.department_id);
    return collegeProfileService.removeDepartment(client, departmentId, { actorUserId: actor.userId, collegeId: actor.collegeId });
  },
});

// Principal -> Academic Year lifecycle: academic_years.create/
// activate/complete (['principal']) already gate
// routes/academicYears.js's own POST /academic-years(/:id/activate,
// /:id/complete) (academicYearService.createAcademicYear/
// activateAcademicYear/completeAcademicYear). RS-ACA-002's own
// lifecycle is Draft -> Active -> Completed only — there is no
// separate archive action to cover (academicYearService exports only
// these three; record archival is a different mechanism entirely, per
// RS-DAT-003, already out of AI tool scope like every other Archived
// Records action). Create is a plain L1 record write (same reasoning
// as departments_create above). Activate/complete are humanOnly: true
// — both are one-way, college-wide lifecycle transitions with no
// undo (activate closes out whichever year was previously Active;
// complete is terminal per RS-ACA-002), the same "real, not-undoable-
// by-another-write consequences" reasoning departments_delete above
// uses, even though neither is literally a SQL DELETE.
registerTool({
  name: 'academic_year_create',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Creates a new academic year in Draft status — the same action as the Academic Year -> Add Academic '
    + 'Year screen. Does not activate it; use academic_year_activate separately once ready.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      year_label: { type: 'string', description: 'The academic year label, e.g. "2026-2027".' },
      start_date: { type: 'string', description: 'Optional start date (YYYY-MM-DD).' },
      end_date: { type: 'string', description: 'Optional end date (YYYY-MM-DD).' },
    },
    required: ['year_label'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => academicYearService.createAcademicYear(
    client,
    {
      collegeId: actor.collegeId, yearLabel: params.year_label, startDate: params.start_date, endDate: params.end_date,
    },
    { actorUserId: actor.userId },
  ),
});

registerTool({
  name: 'academic_year_activate',
  level: 'L2',
  dataClassification: 'Internal',
  humanOnly: true,
  description: 'Activates a Draft academic year, making it the college\'s one Active academic year — the same '
    + 'action as the Academic Year -> Activate screen. Never called by the AI on its own — only reachable via the '
    + "user's own explicit confirm action in the chat UI. Fails if another academic year is already Active, or if "
    + 'this one is not currently Draft.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      academic_year_id: { type: 'string', description: 'The academic year id, or its year_label, resolved to an id internally.' },
    },
    required: ['academic_year_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const academicYearId = await academicYearService.resolveAcademicYearId(client, actor.collegeId, params.academic_year_id);
    return academicYearService.activateAcademicYear(client, academicYearId, { actorUserId: actor.userId });
  },
});

registerTool({
  name: 'academic_year_complete',
  level: 'L2',
  dataClassification: 'Internal',
  humanOnly: true,
  description: 'Marks the currently Active academic year as Completed (terminal, no further transitions) — the '
    + 'same action as the Academic Year -> Complete screen. Never called by the AI on its own — only reachable via '
    + "the user's own explicit confirm action in the chat UI. Fails if this academic year is not currently Active.",
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      academic_year_id: { type: 'string', description: 'The academic year id, or its year_label, resolved to an id internally.' },
    },
    required: ['academic_year_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const academicYearId = await academicYearService.resolveAcademicYearId(client, actor.collegeId, params.academic_year_id);
    return academicYearService.completeAcademicYear(client, academicYearId, { actorUserId: actor.userId });
  },
});

module.exports = {
  AiToolNotFoundError,
  AiToolLevelNotSupportedError,
  AiToolTenantMismatchError,
  AiToolRoleNotPermittedError,
  AiToolDataClassificationError,
  AiToolDepartmentScopeError,
  AiToolL3BypassError,
  AiToolInvalidParamsError,
  AiToolAnalyticsLevelViolationError,
  AiToolBulkOperationRejectedError,
  registerTool,
  getTool,
  listTools,
  filterToolsByRelevance,
  invokeTool,
  checkToolPreconditions,
  computeRiskLevel,
  buildActionManifest,
};
