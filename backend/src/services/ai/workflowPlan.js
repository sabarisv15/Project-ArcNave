'use strict';

// Bounded multi-step workflow engine (P0.3 of the AI capability roadmap,
// CHECKPOINT.md) — the run_workflow_plan/describe_tools meta-tool
// builders offered to the LLM (buildPlanMetaTool/buildSchemaMetaTool),
// the tool-catalogue text variants (buildToolCatalogueHybrid/Keywords/
// ForExperiment/FullInstructionsDocument), plan-step validation/
// resolution (validatePlanSteps/resolvePlanSteps), and the Parallel Read
// Workers plan executor (runPlanStep/groupStepsByParallelizability/
// executeWorkflowPlan). Split out of aiService.js — see that file's own
// header comment for the full split; moved verbatim, no behavior change.
// Required by both services/ai/turnSetup.js (offers the meta-tools) and
// services/ai/agentLoop.js (handles the LLM actually picking one).

const config = require('../../config');
const aiToolRegistry = require('../aiToolRegistry');
const aiPromptSafetyLayer = require('../aiPromptSafetyLayer');
const aiActorContext = require('../aiActorContext');
const aiPolicyAssembly = require('../aiPolicyAssembly');
const aiContextAssembly = require('../aiContextAssembly');
const configurationService = require('../configurationService');
const aiExperienceLayer = require('../aiExperience');
const { AiWorkflowPlanValidationError } = require('./errors');
const { TOOL_RESULT_ANSWER_SYSTEM_PROMPT, FILE_TOOL_NAMES } = require('./sharedConstants');
const { buildEvidence, buildEvidenceTrail, verifyNumericClaims } = require('./evidence');
const { invokeTool } = require('./toolInvocation');
const { completeMaybeStreaming, selectModelForPurpose } = require('./llmCall');

const MAX_PLAN_STEPS = 6;
const PLAN_TOOL_NAME = 'run_workflow_plan';

// ADR-030 P2(c) — bounds TOOL EXECUTIONS in askAgent's single-tool_call
// loop (below), not LLM calls: a turn at the cap can cost cap+1
// completeWithTools calls (one decision call plus one continuation per
// executed tool). config.maxToolCallsPerTurn defaults to 1 —
// "compatibility mode," where the loop's first iteration hits the cap
// immediately and falls back to the same old-shape synthesis call the
// pre-loop code always made. This is entirely separate from
// executeWorkflowPlan's own MAX_PLAN_STEPS above — that's a pre-planned,
// LLM-proposed-once sequence; this loop is adaptive, one tool at a time,
// re-deciding after each result. Read LIVE from config.maxToolCallsPerTurn
// at the point of use inside askAgent below, never cached into a
// module-level const at require-time — same reasoning as every other
// config.*/config.openai.fastModel read in this file: tests toggle these
// values at runtime (withOpenAiConfig, fastModel), and a load-time
// snapshot would silently stop responding to that.

// ai-tool-catalogue-approved-spec.md / ADL-055.
//
// Semantic retrieval shortlists TOP_K=8 of a role's ~69 tools, and measurably
// excludes ones the question genuinely needs — including for
// ai-chat-result-sheet-evidence.md's OWN canonical example, "consolidate
// arrears for serial 818 to 872". A model that was never offered a tool does
// not say "I have no tool for this"; it answers anyway. Round 39 fixed that
// for ONE tool by pinning; nothing protected the other 68.
//
// The catalogue makes a retrieval miss non-fatal rather than making retrieval
// better: every permitted tool's NAME is always visible, so the model can
// recognise a capability and fetch its schema. Retrieval is demoted from
// deciding what is possible to deciding what is pre-loaded.
//
// Measured with Vertex countTokens on gemini-3.7-flash, 69 principal tools:
// all full schemas 11,514 tok; today's 8 retrieved 1,423; this catalogue
// 2,176; bare names 424. So this COSTS roughly +2,176 tok/turn — it is a
// correctness change, never a cost saving, and must not be re-justified as
// one.
const SCHEMA_TOOL_NAME = 'describe_tools';
// Loop backstop, not a functional limit: a turn genuinely needing more than
// this many separate lookups is a plan, not a lookup.
const MAX_SCHEMA_FETCHES = 3;

// Budget-exempt lookup tools (F15, bka/90-appendix/consumer-adaptation-flags.md).
//
// These are REGISTERED tools with real handlers — unlike SCHEMA_TOOL_NAME
// above, they run through the Policy Gate, audit and sanitisation
// unchanged, and they DO count as a tool use for reporting. The only
// thing this list changes is the BUDGET: they do not consume
// config.maxToolCallsPerTurn.
//
// The criterion is exactly the one the describe_tools exemption already
// uses (see the tool-use loop's own comment): a call that answers "what
// could I do / how should I do it" rather than doing it. Verified per
// tool at the time this list was written — every one of these six is
// handed the `client` and never uses it: no Business Service, no
// repository, no tenant data, nothing mutated.
//
//   list_skills                  -> skillService.listSkills()
//   describe_skill               -> skillService.getSkill(name)
//   decide_output_format         -> aiOutputFormatService.decideOutputFormat()
//   decide_image_route           -> aiOutputFormatService.decideImageRoute()
//   describe_diagram_constraints -> aiDiagramService.describeConstraints()
//   capability_search            -> registry metadata for the actor's role
//
// capability_explain is deliberately NOT here: it reads real per-college
// configuration through a Business Service to decide whether a capability
// is enabled for this tenant, so it is a data read, not a pure lookup.
//
// Why this exists: F15 measured a live turn where the model spent its
// only tool call on list_skills, got back a list of names, and then told
// the user it had no data — with the document attached to that same
// turn. That is precisely the failure the describe_tools comment below
// predicted ("the feature would be worse than useless"); the skills
// subsystem and the output-format policy tools shipped without the
// exemption that reasoning already justified.
//
// A hardcoded set here rather than a `budgetExempt` flag on the tool: an
// exemption from a safety budget should be auditable in one place, and a
// registry flag would let any future tool grant itself unlimited calls.
const BUDGET_EXEMPT_LOOKUP_TOOLS = new Set([
  'list_skills',
  'describe_skill',
  'decide_output_format',
  'decide_image_route',
  'describe_diagram_constraints',
  'capability_search',
]);
// Same backstop reasoning as MAX_SCHEMA_FETCHES: free of the tool budget
// is not free of cost. Every lookup still spends a completeWithTools
// round-trip, and F13 already measured the decision call running near its
// 45s ceiling — an unbounded lookup loop would push it over.
const MAX_LOOKUP_CALLS = 3;

// ADL-064 (2026-08-30) — the Gemini-native catalogue routing experiment
// (Priority 1 follow-up to the Tool Search NO-GO) is resolved. It tested
// whether Gemini itself can route from shorter catalogue text than the
// original full-description default, across several mechanically-derived
// shortenings plus two hand-authored documents. 'keywords' and 'hybrid'
// were the two live-measured finalists (backend/scripts/pdf-tool-
// confusion-live-test.js's own VARIANTS list was already narrowed to
// exactly these two before this decision) — the original full-description
// default and the 'oneLine'/'category'/'spec' variants are retired, and
// config.experimentalCatalogueVariant can no longer select any of them
// (falls back to the new default below instead of crashing). 'keywords'
// ships as the default: role-filtered from the same `roleTools` the
// retired default always used, so ai-tool-catalogue-approved-spec.md's
// "never names a tool the actor's role cannot use" guarantee still holds
// unconditionally. 'hybrid' stays selectable
// (config.experimentalCatalogueVariant = 'hybrid') for the still-open
// keywords-vs-hybrid comparison — deliberately NOT role-filtered (see
// buildToolCatalogueHybrid's own comment below), a disclosed, already-
// accepted simplification while that comparison continues, not something
// the shipped default ever does.
const CATALOGUE_VARIANT_C_MAX = 32;
const CATALOGUE_LEADING_VERB_RE =
  /^(records?|returns?|lists?|shows?|fetches?|gets?|retrieves?|generates?|creates?|updates?|marks?|finds?|resolves?|drafts?)\s+(the\s+|a\s+|an\s+|one\s+)?/i;
function toWhenToUse(description, maxLen) {
  const text = String(description || '').trim();
  const searchWindow = text.slice(0, Math.floor(maxLen * 1.5));
  const boundary = searchWindow.search(/[,.;—(]/);
  if (boundary !== -1 && boundary <= maxLen) return text.slice(0, boundary).trim();
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 10 ? cut.slice(0, lastSpace) : cut).trim();
}
function toKeywords(description) {
  const shortened = toWhenToUse(description, CATALOGUE_VARIANT_C_MAX + 25).replace(CATALOGUE_LEADING_VERB_RE, '');
  return toWhenToUse(shortened, CATALOGUE_VARIANT_C_MAX);
}
// Role-filtered, mechanically derived from the real registry `description`
// field — never hand-authored per tool. The shipped default (see
// buildToolCatalogueForExperiment below).
//
// Cached per role, same lazy idiom as cachedHybridText right below —
// roleTools is a pure function of (the registry, role) and the registry
// is static for the process lifetime (registerTool calls all run once at
// require-time), so the built text can never change for a given role
// without a restart. Without this, every askAgent call on the shipped
// default path rebuilt this from scratch (a map + 2 regex passes per
// role-permitted tool, up to ~100 tools for principal) on every single
// chat turn. `role` is whatever identityContext.role is, undefined
// included — Map handles undefined as a key fine, and listTools() itself
// already treats a falsy role as "no role filter" consistently, so
// caching under that same key is safe.
const cachedKeywordsByRole = new Map();
function buildToolCatalogueKeywords(roleTools, role) {
  if (cachedKeywordsByRole.has(role)) return cachedKeywordsByRole.get(role);
  const lines = roleTools.map((t) => `${t.name} — ${toKeywords(t.description)}`).join('\n');
  const text = 'Tool routing keywords. If nothing below fits the question, say so plainly.\n\n' + lines;
  cachedKeywordsByRole.set(role, text);
  return text;
}

// 'hybrid' variant — a hand-authored document (scripts/
// experimental-catalogue-hybrid.md), verified (real diff against the live
// registry: all 101 Principal tools covered, zero fabricated names — the
// one flagged token, "submit", is a naming-convention reference in the
// Rules section, not a tool). NOT role-filtered: sent as-is regardless of
// role — for Principal this is exact (Principal already has ~101/101
// tools); for HOD/Tutor/Staff it overstates real cost slightly (a handful
// of admin-only tool NAMES they can't call are still in the text, though
// the Policy Gate still blocks calling them same as always) — a disclosed
// simplification, accepted for the duration of the still-open keywords-
// vs-hybrid comparison ADL-064 records. Not the shipped default's
// behavior for exactly this reason.
let cachedHybridText = null;
function buildToolCatalogueHybrid() {
  if (cachedHybridText === null) {
    cachedHybridText = require('fs').readFileSync(
      `${__dirname}/../../../scripts/experimental-catalogue-hybrid.md`,
      'utf8',
    );
  }
  return cachedHybridText;
}

// Testing-phase only (config.experimentalFullInstructionsDocument) —
// the user-supplied AI_OPERATING_INSTRUCTIONS_1.md wired in verbatim, no
// condensing, per explicit instruction after being told the real
// token-cost/content tradeoffs (see config.js's own comment). Same
// lazy-read-and-cache pattern as buildToolCatalogueHybrid above.
let cachedFullInstructionsText = null;
function buildFullInstructionsDocument() {
  if (cachedFullInstructionsText === null) {
    cachedFullInstructionsText = require('fs').readFileSync(
      `${__dirname}/../../../scripts/experimental-ai-operating-instructions.md`,
      'utf8',
    );
  }
  return cachedFullInstructionsText;
}

// ADL-064: 'hybrid' is the one still-open opt-in; every other/unset/
// invalid value (including the retired 'current'/'oneLine'/'category'/
// 'spec') resolves to the shipped default, 'keywords' — never a crash,
// never a silently different unlisted variant.
function buildToolCatalogueForExperiment(roleTools, role) {
  if (config.experimentalCatalogueVariant === 'hybrid') return buildToolCatalogueHybrid();
  return buildToolCatalogueKeywords(roleTools, role);
}

function buildSchemaMetaTool() {
  return {
    name: SCHEMA_TOOL_NAME,
    level: 'L1',
    dataClassification: 'Internal',
    description:
      'Get the full parameters of one or more tools listed in the catalogue but not yet described ' +
      'above. Use this when the catalogue names a capability that fits the question better than anything ' +
      'already described. After this returns, those tools become callable in this same turn.',
    params: {
      type: 'object',
      required: ['names'],
      properties: {
        names: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          items: { type: 'string', description: 'an exact tool name from the catalogue' },
        },
      },
    },
  };
}

function buildPlanMetaTool() {
  return {
    name: PLAN_TOOL_NAME,
    level: 'L1',
    dataClassification: 'Internal',
    description:
      'Run an ORDERED sequence of the tools above (2 to ' +
      `${MAX_PLAN_STEPS} steps) when ONE tool alone cannot answer the question — e.g. "find students below ` +
      '75% attendance, then check which of them also have pending fee corrections" needs two separate tools. ' +
      'Do NOT use this for a question one tool alone can answer — call that tool directly instead (this exists ' +
      'for genuine multi-step requests only, never as a default). Each step names one of the tools above by its ' +
      "exact name plus that tool's own params.",
    params: {
      type: 'object',
      required: ['steps'],
      properties: {
        steps: {
          type: 'array',
          minItems: 2,
          maxItems: MAX_PLAN_STEPS,
          items: {
            type: 'object',
            required: ['tool'],
            properties: {
              tool: { type: 'string', description: 'the exact name of one of the tools offered above' },
              params: { type: 'object' },
            },
          },
        },
      },
    },
  };
}

// `offeredTools` — the same role-filtered + relevance-filtered list
// this call actually showed the LLM (askAgent's own `tools` array) —
// a plan step naming anything outside it is rejected here, before any
// step runs, rather than letting the Policy Gate discover it one step
// at a time. This is a plan-shape check, not a second authorization
// system: invokeTool's own Policy Gate still re-validates every step
// for real (role/tenant/classification/department) regardless of this
// check passing.
function validatePlanSteps(steps, offeredTools) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new AiWorkflowPlanValidationError('a workflow plan must include at least one step');
  }
  if (steps.length > MAX_PLAN_STEPS) {
    throw new AiWorkflowPlanValidationError(
      `a workflow plan may have at most ${MAX_PLAN_STEPS} steps, got ${steps.length} — narrow the request`,
    );
  }
  const offeredNames = new Set(offeredTools.map((t) => t.name));
  for (const step of steps) {
    if (!step || typeof step.tool !== 'string' || !offeredNames.has(step.tool)) {
      throw new AiWorkflowPlanValidationError(
        `workflow plan step named ${JSON.stringify(step && step.tool)}, which is not one of the tools offered for this question`,
      );
    }
  }
}

// Resolves each step against checkToolPreconditions (the same
// Policy-Gate-plus-param-validation check invokeTool itself runs) to
// get its real safeParams/estimatedAffectedRows, then decides whether
// the WHOLE plan needs one confirmation before anything executes — an
// L3 step or a bulk-guarded step over its own confirmAt threshold, same
// per-tool rule askAgent's single-tool path already uses, just OR'd
// across every step so one pause covers the whole plan (round 6/7:
// "plan-level confirmation... not per-step").
async function resolvePlanSteps(steps, { client, identityContext }) {
  const resolved = [];
  let needsConfirmation = false;
  const confirmationLines = [];
  for (const step of steps) {
    const tool = aiToolRegistry.getTool(step.tool);
    // eslint-disable-next-line no-await-in-loop
    const { safeParams, estimatedAffectedRows } = await aiToolRegistry.checkToolPreconditions(step.tool, {
      client,
      identityContext,
      params: step.params || {},
    });
    const isL3 = tool.level === 'L3';
    const overConfirmThreshold =
      Boolean(tool.maxAffectedRows) && estimatedAffectedRows > tool.maxAffectedRows.confirmAt;
    if (isL3 || overConfirmThreshold) {
      needsConfirmation = true;
      confirmationLines.push(
        isL3
          ? `- ${tool.description} (submits for approval)`
          : `- ${tool.description} (affects approximately ${estimatedAffectedRows} record(s))`,
      );
    }
    resolved.push({ toolName: step.tool, params: safeParams });
  }
  return { resolved, needsConfirmation, confirmationLines };
}

async function runPlanStep(client, identityContext, step, adapter, aiConfig) {
  try {
    const result = await invokeTool(client, step.toolName, step.params || {}, {
      identityContext,
      provider: adapter && adapter.name,
      model: aiConfig && aiConfig.model,
    });
    const tool = aiToolRegistry.getTool(step.toolName);
    // Evidence scaffolding (feeds P0.4) — a lightweight, deterministic
    // record count derived from this step's own already-wrapped data,
    // not a fresh query: how many rows/records this step's tool
    // actually returned, and when. JSON.parse here is the inverse of
    // aiPromptSafetyLayer.wrapEntry's JSON.stringify, not a new
    // untrusted-data read — this is this same request's own,
    // already-Policy-Gated tool result.
    const parsedData = JSON.parse(result.entries[0].data);
    const recordCount = Array.isArray(parsedData) ? parsedData.length : undefined;
    return {
      ok: true,
      stepResult: {
        toolName: step.toolName,
        tool,
        entries: result.entries,
        retrievedAt: result.entries[0].retrievedAt,
        recordCount,
        // result.document (invokeTool's own extractDocumentAttachment) —
        // a real downloadable file a generate_document/export_artifact
        // step just produced. Carried through so a plan combining that
        // step with others (e.g. "pull my attendance, then give it to
        // me as a PDF") surfaces the same download card the single-tool
        // path already gets, instead of silently dropping it once the
        // file is folded into a multi-step plan.
        document: result.document,
      },
    };
  } catch (err) {
    return { ok: false, failure: { toolName: step.toolName, message: err.message } };
  }
}

// Splits `resolvedSteps` into runs of consecutive same-kind steps
// (read-only vs. not), preserving original order across runs — a plan
// [read, read, write, read] becomes [[read,read], [write], [read]],
// never reordered relative to how the LLM/user specified it.
// R0/R1 on RISK_MATRIX is exactly the L1 (pure-read) set — this
// happens to be the same numeric threshold selectModelForPurpose uses
// for model routing below, but it's a deliberately separate constant:
// those are two unrelated dimensions (safe-to-parallelize vs.
// safe-to-downgrade-the-model) that coincide today only because of how
// RISK_MATRIX assigns L1 its two risk levels — tying them to the same
// name would silently couple a future change to one concern into the
// other.
const PARALLEL_SAFE_MAX_RISK_LEVEL = 1;

function groupStepsByParallelizability(resolvedSteps) {
  const groups = [];
  for (const step of resolvedSteps) {
    const tool = aiToolRegistry.getTool(step.toolName);
    const isReadOnly = Boolean(tool) && tool.riskLevel <= PARALLEL_SAFE_MAX_RISK_LEVEL;
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.isReadOnly === isReadOnly) {
      lastGroup.steps.push(step);
    } else {
      groups.push({ isReadOnly, steps: [step] });
    }
  }
  return groups;
}

async function executeWorkflowPlan(
  client,
  resolvedSteps,
  question,
  {
    identityContext,
    identityBlock: precomputedIdentityBlock,
    adapter: precomputedAdapter,
    aiConfig: precomputedAiConfig,
    hasHistory,
    historyTurns = [],
  },
  onDelta,
  onStep = () => {},
) {
  // Resolved up front now (used to happen after the step loop, only for
  // the synthesis call) so every step's own ai_tool_invoked audit row
  // can also carry provider/model — see runPlanStep's new params. Pure
  // config resolution, no dependency on step results, so moving it
  // earlier changes nothing about what runs or in what order.
  const identityBlock =
    precomputedIdentityBlock || (await aiActorContext.describeIdentityContext(client, identityContext));
  let adapter = precomputedAdapter;
  let aiConfig = precomputedAiConfig;
  if (!adapter || !aiConfig) {
    ({ adapter, config: aiConfig } = await configurationService.getAiConfig(client, identityContext.collegeId));
  }

  const stepResults = [];
  const failures = [];
  const totalSteps = resolvedSteps.length;
  let stepsStarted = 0;
  for (const group of groupStepsByParallelizability(resolvedSteps)) {
    // Real-time step visibility (the frontend's own "running X" status,
    // not a business decision) — emitted right before each step's tools
    // actually run, one event per step even when a read-only group runs
    // its steps concurrently, so the UI can show every tool name rather
    // than collapsing a parallel batch into one label.
    group.steps.forEach((step, i) => {
      onStep({
        phase: 'running_tool',
        toolName: step.toolName,
        stepIndex: stepsStarted + i,
        totalSteps,
      });
    });
    stepsStarted += group.steps.length;
    // eslint-disable-next-line no-await-in-loop
    const outcomes = group.isReadOnly
      ? await Promise.all(group.steps.map((step) => runPlanStep(client, identityContext, step, adapter, aiConfig)))
      : await group.steps.reduce(async (prevPromise, step) => {
          const acc = await prevPromise;
          acc.push(await runPlanStep(client, identityContext, step, adapter, aiConfig));
          return acc;
        }, Promise.resolve([]));
    for (const outcome of outcomes) {
      if (outcome.ok) stepResults.push(outcome.stepResult);
      else failures.push(outcome.failure);
    }
  }

  const mergedSanitizedContext = {
    preamble: aiPromptSafetyLayer.SAFETY_PREAMBLE,
    boundaryStart: aiPromptSafetyLayer.BOUNDARY_START,
    boundaryEnd: aiPromptSafetyLayer.BOUNDARY_END,
    entries: stepResults.flatMap((r) => r.entries),
  };

  const failureText =
    failures.length > 0
      ? `\n\nThe following step(s) could NOT be completed — say so plainly in the answer, never silently omit them: ${failures
          .map((f) => `${f.toolName} (${f.message})`)
          .join('; ')}`
      : '';
  const stepDescriptions = stepResults.map((r) => `${r.toolName}: ${r.tool.description}`).join('\n');
  const { systemPrompt, userPrompt } = aiPromptSafetyLayer.renderForLlm(mergedSanitizedContext, question);
  // ADR-030 P2(a): builds an ARCNAVE Context instead of flat strings —
  // representation change only, byte-identical output. The plan-summary
  // note (stepDescriptions/failureText) is per-request but still far more
  // stable than identityBlock (per-user/per-college) — ADR-030 P0:
  // identityBlock stays the LAST segment, so a stable prefix boundary
  // exists for a future caching layer to find.
  const hasFileTool = stepResults.some((r) => FILE_TOOL_NAMES.has(r.toolName));
  const policy = aiPolicyAssembly.buildPolicy({
    mode: 'curriculum',
    hasHistory,
    toolCount: stepResults.length,
    hasFileTool,
    focusEntityType: null,
  });
  const arcnaveContext = aiContextAssembly.buildContext(
    [
      aiContextAssembly.segment({
        source: 'safety-preamble',
        stability: aiContextAssembly.STABILITY.STATIC,
        target: 'system',
        content: systemPrompt,
      }),
      aiContextAssembly.segment({
        source: 'mode-prefix',
        stability: aiContextAssembly.STABILITY.STATIC,
        target: 'system',
        content: aiPolicyAssembly.MODE_PREFIX.curriculum,
      }),
      aiContextAssembly.segment({
        source: 'policy-modules',
        stability: aiContextAssembly.STABILITY.CONVERSATION,
        target: 'system',
        content: policy,
      }),
      aiContextAssembly.segment({
        source: 'plan-summary-note',
        stability: aiContextAssembly.STABILITY.TURN,
        target: 'system',
        content: `This answer combines the results of ${stepResults.length} tool(s), run as one plan:\n${stepDescriptions}${failureText}`,
      }),
      aiContextAssembly.segment({
        source: 'identity',
        stability: aiContextAssembly.STABILITY.CONVERSATION,
        target: 'system',
        content: identityBlock,
      }),
      // ADR-030 P1: TOOL_RESULT_ANSWER_SYSTEM_PROMPT's turn-specific
      // guidance lives in the message stream, not the system segments —
      // same text, same content, unchanged from P1.
      aiContextAssembly.segment({
        source: 'tool-result-data',
        stability: aiContextAssembly.STABILITY.VOLATILE,
        target: 'user',
        content: userPrompt,
      }),
      aiContextAssembly.segment({
        source: 'tool-result-answer-guidance',
        stability: aiContextAssembly.STABILITY.STATIC,
        target: 'user',
        content: TOOL_RESULT_ANSWER_SYSTEM_PROMPT,
      }),
    ],
    { historyTurns },
  );

  // Model routing (P1.3) — routed on the HIGHEST riskLevel across every
  // step, never an average or the first step's alone: a plan combining
  // one L1 read with one L2/L3 write is only as low-risk as its riskiest
  // step, and downgrading the model that describes a write action's
  // outcome is not the same low-stakes case a pure-read plan is.
  const maxRiskLevel = stepResults.reduce((max, r) => Math.max(max, r.tool.riskLevel), 0);
  const routedConfig = selectModelForPurpose(aiConfig, maxRiskLevel);
  // Every plan step has already run by this point — this is the single
  // synthesis call combining them into an answer, not another tool. See
  // the single-tool path's identical onStep('synthesizing') call for why.
  onStep({ phase: 'synthesizing' });
  const { text: answer, usage } = await completeMaybeStreaming(
    client,
    identityContext,
    adapter,
    routedConfig,
    arcnaveContext,
    'plan_synthesis',
    onDelta,
  );

  const presentation = aiExperienceLayer.buildPresentation({
    sanitizedContext: mergedSanitizedContext,
    question,
    answer,
    toolUsed: PLAN_TOOL_NAME,
    tool: null,
    actorRole: identityContext.role,
  });

  const evidence = buildEvidence(mergedSanitizedContext);
  // A plan step's own document (see runPlanStep's comment) — at most one
  // step in a real plan is ever generate_document/export_artifact/
  // export_artifact_as, so the first non-null one found is the plan's
  // document, same single value shape askAgent's single-tool path
  // already returns.
  const document = stepResults.map((r) => r.document).find(Boolean) || undefined;
  return {
    ...mergedSanitizedContext,
    question,
    toolUsed: PLAN_TOOL_NAME,
    answer,
    usage,
    presentation,
    document,
    plan: stepResults.map((r) => ({ toolName: r.toolName, recordCount: r.recordCount, retrievedAt: r.retrievedAt })),
    failures,
    evidence,
    evidenceTrail: buildEvidenceTrail(evidence),
    verification: verifyNumericClaims(answer, evidence),
  };
}

// Same pipeline as invokeTool, plus the LLM step: the tool still runs
// and still gets its own ai_tool_invoked audit row (invokeTool's own,
// unchanged) regardless of what happens next — the tool call and the
// LLM call are two distinct events, and a downstream LLM failure
// (unconfigured provider, a network error) must not retroactively make
// the already-completed, already-audited tool invocation look like it
// never happened.

module.exports = {
  buildPlanMetaTool,
  buildSchemaMetaTool,
  buildToolCatalogueHybrid,
  buildToolCatalogueKeywords,
  buildToolCatalogueForExperiment,
  buildFullInstructionsDocument,
  validatePlanSteps,
  resolvePlanSteps,
  runPlanStep,
  groupStepsByParallelizability,
  executeWorkflowPlan,
  MAX_PLAN_STEPS,
  PLAN_TOOL_NAME,
  SCHEMA_TOOL_NAME,
  MAX_SCHEMA_FETCHES,
  BUDGET_EXEMPT_LOOKUP_TOOLS,
  MAX_LOOKUP_CALLS,
  PARALLEL_SAFE_MAX_RISK_LEVEL,
};
