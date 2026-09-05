'use strict';

// Module 9 (AI) — Tool Registry + Policy Gate engine. Split out of
// aiToolRegistry.js (was ~4,982 lines) into services/aiTools/* — same
// split-file pattern services/academic/ and services/ai/ already
// established (barrel + cohesive submodules). This file owns the
// registry/Policy-Gate MACHINERY only: {name, level, dataClassification,
// description, handler} registration/lookup, the Policy Gate (tenant/
// role/data-classification/department-scope checks run before any
// handler executes), param sanitization/validation, and invokeTool
// itself. See aiToolRegistry.js's own header comment for the two-jobs-
// in-one-file reasoning this engine still follows.
//
// The actual TOOL DEFINITIONS (~104 registerTool({...}) calls) live in
// services/aiTools/tools*.js, grouped by registration era (this file's
// own original chronological section comments — "Real tool #1",
// "Institutional Documents Phase 2/3", "Role-aware ERP Copilot tools",
// "2026-07-26 UAT wiring", "Phase 8", etc. — preserved verbatim, not
// re-sorted into an invented domain taxonomy that doesn't match how
// this file actually grew) — each requires {registerTool} from this
// file and calls it purely for its registration side effect at module
// load time; none of them export anything meaningful themselves.
// aiToolRegistry.js (the barrel) requires every one of those files
// (for that side effect) alongside this engine, and re-exports this
// engine's own public API unchanged.

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

const auditLogRepository = require('../../repositories/auditLogRepository');
const aiClassificationAccess = require('../aiClassificationAccess');
const { isUuid } = require('../../identifierResolution');
// formatPipNamesForDescription's require (originally here) moved to
// services/aiTools/tools09.js — the only batch that actually calls it
// (execute_code's own sandbox description text); the engine never uses
// it.
// Phase 4 Group (b)'s aiActorContext require (originally here) moved to
// services/aiTools/tools01.js and tools03.js — the only two batches
// that actually call aiActorContext.buildActorContextForIdentity; the
// engine itself never uses it.

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
  return tools.map(({ name, level, dataClassification, riskLevel, description, params }) => ({
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
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'to',
  'of',
  'in',
  'on',
  'for',
  'and',
  'or',
  'my',
  'me',
  'i',
  'you',
  'your',
  'what',
  'how',
  'who',
  'whom',
  'when',
  'where',
  'which',
  'this',
  'that',
  'with',
  'do',
  'does',
  'did',
  'can',
  'could',
  'please',
  'show',
  'tell',
  'give',
  'about',
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

// ARCNAVE modernization P3 (D3 — "meaning-search only -> blend with
// keyword search + re-ranking"; the plan's own bullet list tags this
// "1.5", but 1.5's own table row is about prompt-caching reuse order,
// unrelated to search — D3's row is the unambiguous match, so this
// slice is built against D3's description). Extracted out of
// filterToolsByRelevance (below) unchanged in scoring logic, so
// aiToolRetrievalService.js's new hybrid blend can rank by keyword
// overlap WITHOUT filterToolsByRelevance's own RANK_CAP/zero-overlap-
// fill policy, which exists for a different purpose (a hard ceiling on
// a fallback-tier RESULT, not a ranking signal to feed into fusion with
// another ranking). Zero-overlap tools are deliberately EXCLUDED here
// (unlike filterToolsByRelevance's own fallback, which pads them back
// in) — a tool contributing no lexical signal at all must not receive
// undeserved rank credit just to pad out a list a fusion algorithm will
// combine with a real semantic ranking.
function rankToolsByKeywordOverlap(tools, question) {
  const questionWords = new Set(significantWords(question));
  if (questionWords.size === 0) return [];
  return tools
    .map((tool) => ({ tool, overlap: toolKeywordOverlap(tool, questionWords) }))
    .filter((r) => r.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap);
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
//
// Rewritten (P3 D3) to build on rankToolsByKeywordOverlap above instead
// of duplicating the same scoring inline — behavior byte-identical to
// before (same tests pass unchanged): `ranked` here already excludes
// zero-overlap tools, so `ranked.length === 0` now covers BOTH the old
// "no question words" and "no tool overlapped" early-returns in one
// branch, and the zero-overlap fill re-derives its candidates from the
// ORIGINAL `tools` array (not a re-sorted copy), preserving the exact
// same relative order Array.prototype.sort's stability gave those
// zero-overlap entries before.
function filterToolsByRelevance(tools, question) {
  if (tools.length <= RANK_CAP) return tools;
  const ranked = rankToolsByKeywordOverlap(tools, question);
  if (ranked.length === 0) return tools.slice(0, RANK_CAP);
  if (ranked.length >= RANK_CAP) return ranked.slice(0, RANK_CAP).map((r) => r.tool);

  const rankedNames = new Set(ranked.map((r) => r.tool.name));
  const zeroOverlapFill = tools.filter((t) => !rankedNames.has(t.name)).slice(0, RANK_CAP - ranked.length);
  return [...ranked.map((r) => r.tool), ...zeroOverlapFill];
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
      `tool ${JSON.stringify(tool.name)} is level ${JSON.stringify(tool.level)}, which is not a supported ` +
        `authority level (expected one of ${JSON.stringify(SUPPORTED_LEVELS)} — AI-Governance.md §1)`,
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
      `role ${JSON.stringify(identityContext.role)} is not permitted to access ` +
        `${JSON.stringify(tool.dataClassification)} data (tool ${JSON.stringify(tool.name)})`,
    );
  }

  if (tool.departmentScoped) {
    const departmentId = params && params.departmentId;
    if (!departmentId || departmentId !== identityContext.departmentId) {
      throw new AiToolDepartmentScopeError(
        `caller's department ${JSON.stringify(identityContext.departmentId)} does not match requested ` +
          `departmentId ${JSON.stringify(departmentId)} (tool ${JSON.stringify(tool.name)})`,
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
        `tool ${JSON.stringify(tool.name)}'s parameter ${JSON.stringify(key)} must be a real internal id, ` +
          `not ${JSON.stringify(params[key])} — there is no name to resolve it from`,
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
      `L3 tool ${JSON.stringify(tool.name)}'s handler returned a result with no workflow_request_id — ` +
        'an L3 handler must only ever submit something for approval (AI-Governance.md §1), never act directly',
    );
  }
  if (L3_BYPASS_STATUSES.includes(result.status)) {
    throw new AiToolL3BypassError(
      `L3 tool ${JSON.stringify(tool.name)}'s handler returned status ${JSON.stringify(result.status)}, which looks ` +
        'like a completed dispatch/send — an L3 handler must only ever submit for approval (AI-Governance.md §1), ' +
        'never dispatch/send directly',
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
        `tool ${JSON.stringify(name)} would affect approximately ${estimatedAffectedRows} record(s), ` +
          `above the safety ceiling of ${tool.maxAffectedRows.rejectAt} — narrow the request and try again`,
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
  rankToolsByKeywordOverlap,
  invokeTool,
  checkToolPreconditions,
  computeRiskLevel,
  buildActionManifest,
};
