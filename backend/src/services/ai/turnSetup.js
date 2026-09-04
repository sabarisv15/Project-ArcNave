'use strict';

// askAgent's ROUTE + tool-fetch + decision-context-assembly phases
// (P3 1.16 explicit phase-pipeline rewrite) — resolveTurnContext (turn
// setup: attachments, hints, guardrail input screening), fetchTools
// (role/relevance-filtered tool selection, greeting fast-path, Tool
// Search), and buildDecisionContext (the ADL-050-governed system-segment
// assembly reused by reference for every completeWithTools call in the
// turn — see this function's own comment for the invariant). Split out
// of aiService.js — see that file's own header comment for the full
// split; moved verbatim, no behavior change. ADL-050
// (bka/30-decisions/ledger.md#adl-050) governs buildDecisionContext:
// the system segments it builds must be constructed exactly once per
// turn and reused BY REFERENCE by every subsequent completeWithTools
// call (services/ai/agentLoop.js's decide/act) — never independently
// reconstructed. This file only ever builds those segments once, in
// this one function; agentLoop.js consumes the returned object by
// reference, so moving these phases into their own file changes
// nothing about that guarantee (object identity is a JS runtime
// property, not a function-location one).

const config = require('../../config');
const aiToolRegistry = require('../aiToolRegistry');
const aiToolSearchService = require('../aiToolSearchService');
const aiGreetingClassifier = require('../aiGreetingClassifier');
const aiExplicitCache = require('../aiExplicitCache');
const aiActorContext = require('../aiActorContext');
const aiPolicyAssembly = require('../aiPolicyAssembly');
const aiContextAssembly = require('../aiContextAssembly');
const configurationService = require('../configurationService');
const aiCostControlService = require('../aiCostControlService');
const aiPromptVersionRegistry = require('../aiPromptVersionRegistry');
const aiGuardrailService = require('../aiGuardrailService');
const { FILE_TOOL_NAMES } = require('./sharedConstants');
const {
  resolveChatAttachments,
  buildAttachmentHint,
  buildAttachmentMetadataHint,
  buildImageUnavailableNote,
  buildMediaUnavailableNote,
} = require('./attachments');
const {
  buildFocusHint,
  buildHistoryTurns,
  buildProjectContextHint,
  buildMemoryHint,
  buildToolCatalogueOmittedNote,
} = require('./hints');
const {
  buildPlanMetaTool,
  buildSchemaMetaTool,
  buildToolCatalogueForExperiment,
  buildFullInstructionsDocument,
} = require('./workflowPlan');
const { resolveMediaSupport, logAttachmentTokenPreflight, logLlmCall } = require('./llmCall');

async function resolveTurnContext(
  client,
  question,
  { identityContext, focusContext, projectContext, history, attachmentIds },
) {
  // CEO Vertex/Gemini audit #42/C20/C21 (2026-08-30) — Per-Tenant Cost/
  // Quota Control and Rate Limits, both real, "urgent" gaps ADL-066
  // found with zero mitigation today. Checked first, before any other
  // work (attachment resolution, memory hints, config resolution) — an
  // over-quota/rate-limited college is refused as cheaply as possible,
  // never after already paying for the rest of this turn's own setup.
  // Covers BOTH modes (askGeneralChat is only ever reached through
  // askAgent, see its call site) with one check, not two.
  // AiQuotaExceededError/AiRateLimitExceededError propagate unchanged to
  // routes/ai.js, which maps both to a clean HTTP 429.
  await aiCostControlService.checkUsageLimits(client, identityContext.collegeId);

  // Chat attachments (resolveChatAttachments' own comment for the full
  // authorization chain) — resolved up front so the attachment hint can
  // join the others below, and so the provider-capability check further
  // down and the decision call itself can use the same
  // already-validated images array. buildAttachmentHint is called with no
  // providerName here — it always applies the conservative
  // DEFAULT_ATTACHMENT_TOTAL_CHAR_BUDGET, which safely fits every
  // configured provider including Gemini's much larger one.
  const { images, documents, media } = await resolveChatAttachments(client, attachmentIds, identityContext);
  const attachmentHint = buildAttachmentHint(documents);
  // ARCNAVE modernization P2 / 1.6 — history no longer joins the
  // hints/promptQuestion text blobs below: real prior turns now travel
  // structurally via historyTurns, computed once per turn and passed
  // unchanged to every buildContext call this turn and in every function
  // this turn calls.
  const historyTurns = buildHistoryTurns(history);
  const focusHint = await buildFocusHint(focusContext, client, identityContext);
  const projectHint = buildProjectContextHint(projectContext);
  const memoryHint = await buildMemoryHint(client, identityContext);
  const hints = [projectHint, focusHint, memoryHint, attachmentHint].filter(Boolean).join('\n\n');
  const promptQuestion = hints ? `${hints}\n\nQuestion: ${question}` : question;
  // Review Finding #2 — same hints as promptQuestion above, minus the raw
  // attachment text (buildAttachmentMetadataHint instead of
  // buildAttachmentHint): used for every completeWithTools call in the
  // CURRICULUM decision loop after the first one (schema-fetch retries,
  // budget-exempt-lookup retries, post-tool continuations), which
  // otherwise resent the full document on every iteration of the same
  // turn.
  const attachmentMetadataHint = buildAttachmentMetadataHint(documents);
  const compactHints = [projectHint, focusHint, memoryHint, attachmentMetadataHint].filter(Boolean).join('\n\n');
  const compactPromptQuestion = compactHints ? `${compactHints}\n\nQuestion: ${question}` : question;
  // The ANSWER-call variant: identical, minus the attachment hint. Once a
  // deterministic tool has run, its bounded result is already present as
  // boundary-wrapped evidence, and leaving the raw document text beside it
  // re-opens the exact failure the routing slice closed. See
  // ai-chat-attachment-hint-answer-call-approved-spec.md.
  const answerHints = [projectHint, focusHint, memoryHint].filter(Boolean).join('\n\n');
  const answerPromptQuestion = answerHints ? `${answerHints}\n\nQuestion: ${question}` : question;

  return {
    images,
    documents,
    media,
    historyTurns,
    attachmentHint,
    promptQuestion,
    compactPromptQuestion,
    answerPromptQuestion,
  };
}

// Phase 2 — FETCH TOOLS. Role-permitted tools, semantic shortlisting,
// the greeting fast-path, and the two config/identity promises kicked off
// early because neither depends on the other (Review Finding #16).
async function fetchTools(
  client,
  identityContext,
  question,
  { images, documents, media, focusContext, projectContext, modelChoice },
) {
  // excludeHumanOnly: true — upload_institutional_document is
  // deliberately never in this list: the LLM may propose+resolve a
  // destination (resolve_document_destination, a normal L1 tool, stays in
  // this list) but must never autonomously execute the actual write in
  // the same turn.
  const roleTools = aiToolRegistry.listTools({ excludeHumanOnly: true, role: identityContext.role });
  // Review Finding #16 — this call, describeIdentityContext, and
  // resolveAiConfig below are all started here, back to back, before any
  // of the three is awaited. Each is still awaited at the exact point its
  // result was already being consumed before this change, so call order,
  // call count, and error propagation for each individual operation are
  // unchanged — only the wall-clock overlap between them is new.
  const identityBlockPromise = aiActorContext.describeIdentityContext(client, identityContext);
  const aiConfigPromise = configurationService.resolveAiConfig(client, identityContext.collegeId, {
    allowExperimentalFallback: true,
    modelChoice,
  });
  // A rejection here is only ever surfaced via the real `await` further
  // down — this empty handler exists solely so Node never logs an
  // "unhandled rejection" warning for the window between creating these
  // two promises and actually awaiting them.
  identityBlockPromise.catch(() => {});
  aiConfigPromise.catch(() => {});
  // ARCNAVE modernization P2 (PDF 1.3 / 1.10 / clash C1) — greeting /
  // small-talk fast path. A deterministic whitelist match (no model
  // call), and only when this turn carries nothing that could need a
  // tool. Clash C1: this decides TOOLS ONLY — decisionPolicy/buildPolicy
  // is untouched, so rule/instruction-chunk selection is byte-identical
  // to any other turn.
  const conversationalTurn =
    config.aiGreetingFastPath &&
    !images.length &&
    !documents.length &&
    !media.length &&
    !(focusContext && focusContext.entityType) &&
    !projectContext &&
    aiGreetingClassifier.classify(question).isConversational;
  const {
    tools: retrievedTools,
    viaToolSearch,
    usage: toolSearchUsage,
    provider: toolSearchProvider,
    model: toolSearchModel,
    coverageStatus: toolCoverageStatus,
    uncoveredRequirements: toolUncoveredRequirements,
    attempted: toolSearchAttempted,
    completed: toolSearchCompleted,
  } = conversationalTurn
    ? {
        tools: [],
        viaToolSearch: false,
        usage: null,
        provider: null,
        model: null,
        coverageStatus: 'skipped_conversational',
        uncoveredRequirements: [],
        attempted: false,
        completed: false,
      }
    : await aiToolSearchService.discoverRelevantTools(client, { roleTools, question });
  // ADR-030 P0/P1 telemetry — a no-op when toolSearchAttempted is false
  // (Tool Search disabled, or no call was ever attempted).
  await logLlmCall(client, {
    identityContext,
    adapter: { name: toolSearchProvider },
    aiConfig: { model: toolSearchModel },
    purpose: 'tool_search',
    usage: toolSearchUsage,
    attempted: toolSearchAttempted,
    completed: toolSearchCompleted,
    fallbackTriggered: toolSearchAttempted ? !viaToolSearch : undefined,
  });
  const tools = retrievedTools;
  // ADR-030 P3 follow-up — computed once, here, and reused by both the
  // tool-catalogue segment and offeredTools, so the two can never
  // disagree about whether this turn is in the fast path.
  const zeroToolFastPathActive =
    (config.experimentalZeroToolFastPath || conversationalTurn) && !viaToolSearch && tools.length === 0;
  // The bounded-plan meta-tool (P0.3) is gated on tools.length >= 2
  // (ADR-030 P0): its own params schema requires >= 2 steps and
  // validatePlanSteps rejects any step naming a tool outside `tools`.
  const toolsWithPlan = tools.length >= 2 ? [...tools, buildPlanMetaTool()] : tools;
  const identityBlock = await identityBlockPromise;
  const { adapter, config: aiConfig, fallbackState } = await aiConfigPromise;

  return {
    roleTools,
    tools,
    toolsWithPlan,
    viaToolSearch,
    zeroToolFastPathActive,
    toolCoverageStatus,
    toolUncoveredRequirements,
    identityBlock,
    adapter,
    aiConfig,
    fallbackState,
  };
}

// Phase 3 — BUILD DECISION CONTEXT. The most sensitive phase: builds the
// system segments exactly once and the two context variants
// (decisionContext for the first call, continuationContext for every call
// after it) that both reuse those same segment objects by reference. See
// this file's own top comment and ADL-050
// (bka/30-decisions/ledger.md#adl-050).
async function buildDecisionContext({
  identityContext,
  identityBlock,
  focusContext,
  question,
  promptQuestion,
  compactPromptQuestion,
  images,
  documents,
  media,
  historyTurns,
  roleTools,
  tools,
  toolsWithPlan,
  viaToolSearch,
  zeroToolFastPathActive,
  toolCoverageStatus,
  toolUncoveredRequirements,
  adapter,
  aiConfig,
  attachmentHint,
  thinkingLevel,
}) {
  // Honest degradation (never a blanket ignore-flag): the deterministic
  // capability check happens here, once, and the LLM can never bypass it.
  const { imagesSupported, imageAnalysisUnavailable, mediaSupported, mediaAnalysisUnavailable, supportedMedia } =
    resolveMediaSupport(adapter, aiConfig, images, media);
  logAttachmentTokenPreflight({
    adapter,
    aiConfig,
    identityContext,
    attachmentHint,
    images,
    media,
  });
  // Correctness fix (2026-08-30) — gated on `roleTools` (this role's full
  // permitted set, fixed for the process lifetime) instead of `tools`
  // (this turn's semantic-retrieval SHORTLIST). `documents.length` stays
  // turn-scoped on purpose — an attachment present THIS turn is real turn
  // content, not retrieval noise.
  const hasFileTool = roleTools.some((t) => FILE_TOOL_NAMES.has(t.name)) || documents.length > 0;
  const policyState = {
    mode: 'curriculum',
    hasHistory: historyTurns.length > 0,
    toolCount: tools.length,
    hasFileTool,
    focusEntityType: focusContext && focusContext.entityType,
  };
  const decisionPolicy = aiPolicyAssembly.buildPolicy(policyState);
  // ARCNAVE modernization P5 ("prompt and model version registry") — the
  // exact module set buildPolicy just assembled into `decisionPolicy`,
  // tagged with each module's own version. Reused (never re-derived) by
  // `decide` below to log alongside aiModelVersionService's own model-
  // version observation, so one log line carries both halves of "same
  // input and tools give the same result."
  const promptVersionTag = aiPromptVersionRegistry.computePromptVersionTag(
    aiPolicyAssembly.getActiveModuleNames(policyState),
  );
  // Review Finding #2 — built once and shared, unmodified, by BOTH
  // decisionSegments (the initial call) and continuationSegments (every
  // call after it): the two context variants must never differ in their
  // system content, only in which user 'question' segment they carry.
  // Held in a const and REUSED by identity on every rebuild below. ADL-050
  // measured that re-packaging this governance-bearing system content
  // weakened a hard rule's live compliance 3/3 -> 2/7, so the constraint
  // is absolute: across every iteration of a turn the system segments
  // stay byte-identical, and only the `tools` array may grow. Reusing the
  // same segment objects (not equivalent copies) is what makes that
  // guarantee structural rather than a promise.
  const sharedSystemSegments = [
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
      content: decisionPolicy,
    }),
    // Role-scoped for the shipped 'keywords' default, so it can never name
    // a tool this actor may not use. CONVERSATION, not STATIC: stable for
    // a role, not across roles. Omitted entirely when viaToolSearch is
    // true — replaced by a short honesty note instead of nothing.
    // config.experimentalZeroToolFastPath: a THIRD case, omitting the
    // catalogue entirely rather than replacing it.
    ...(viaToolSearch
      ? [
          aiContextAssembly.segment({
            source: 'tool-catalogue-omitted-note',
            stability: aiContextAssembly.STABILITY.CONVERSATION,
            target: 'system',
            content: buildToolCatalogueOmittedNote(toolCoverageStatus, toolUncoveredRequirements || []),
          }),
        ]
      : zeroToolFastPathActive
        ? []
        : [
            aiContextAssembly.segment({
              source: 'tool-catalogue',
              stability: aiContextAssembly.STABILITY.CONVERSATION,
              target: 'system',
              content: buildToolCatalogueForExperiment(roleTools, identityContext.role),
            }),
          ]),
    // Priority 3 follow-up (config.experimentalAttachmentDiscipline, off
    // by default). Superseded by the full raw document
    // (config.experimentalFullInstructionsDocument, testing-phase only)
    // when that flag is on.
    ...(config.experimentalFullInstructionsDocument
      ? [
          aiContextAssembly.segment({
            source: 'full-instructions-document',
            stability: aiContextAssembly.STABILITY.STATIC,
            target: 'system',
            content: buildFullInstructionsDocument(),
          }),
        ]
      : config.experimentalAttachmentDiscipline && documents.length > 0
        ? [
            aiContextAssembly.segment({
              source: 'attachment-discipline',
              stability: aiContextAssembly.STABILITY.TURN,
              target: 'system',
              content:
                'Before computing any count/sum/comparison from an attached document, confirm which section, ' +
                "course, or scope the data actually belongs to (check the document's own header/label text near the " +
                'rows you are about to use) — never assume a user-supplied range or name is correct without checking ' +
                'it against the document itself; never estimate from a partial read of a large document. If asked to ' +
                'compare or consolidate, state which sections/ranges you actually used in the answer, so a wrong ' +
                'assumption is visible rather than silent.',
            }),
          ]
        : []),
    // P3 1.16 — the FLAG-tier guardrail reinforcement note
    // (aiGuardrailService.js's own comment on REINFORCEMENT_NOTE).
    // screenInput(question) is called exactly once per request, here,
    // before any provider call — never re-screened on a continuation —
    // so this segment (present or absent) is decided once and then part
    // of sharedSystemSegments for the rest of the turn, same ADL-050
    // construction-once/reuse-by-reference guarantee every other segment
    // in this array already holds. The BLOCK tier is enforced at the
    // route layer (routes/ai.js) before aiService.js is ever reached;
    // only the FLAG tier's additive note is this file's job, since it
    // means touching this segment list. STABILITY.TURN, not
    // CONVERSATION: it's a function of this question, not the whole
    // conversation — same precedent as the attachment-discipline segment
    // above. Ordinary (non-FLAG) questions add nothing here — byte-
    // identical to before this note existed.
    ...(aiGuardrailService.screenInput(question).verdict === 'flag'
      ? [
          aiContextAssembly.segment({
            source: 'guardrail-reinforcement-note',
            stability: aiContextAssembly.STABILITY.TURN,
            target: 'system',
            content: aiGuardrailService.REINFORCEMENT_NOTE,
          }),
        ]
      : []),
    aiContextAssembly.segment({
      source: 'identity',
      stability: aiContextAssembly.STABILITY.CONVERSATION,
      target: 'system',
      content: identityBlock,
    }),
  ];
  // Shared by both variants below — an image-unavailable note is not
  // attachment-text-sized and carries no per-call cost concern.
  const imageUnavailableSegment = imageAnalysisUnavailable
    ? aiContextAssembly.segment({
        source: 'image-unavailable-note',
        stability: aiContextAssembly.STABILITY.TURN,
        target: 'user',
        content: buildImageUnavailableNote(images.length),
      })
    : null;
  const mediaUnavailableSegment = mediaAnalysisUnavailable
    ? aiContextAssembly.segment({
        source: 'media-unavailable-note',
        stability: aiContextAssembly.STABILITY.TURN,
        target: 'user',
        content: buildMediaUnavailableNote(media.length),
      })
    : null;
  const decisionUserSegments = [
    aiContextAssembly.segment({
      source: 'question',
      stability: aiContextAssembly.STABILITY.TURN,
      target: 'user',
      content: promptQuestion,
    }),
    ...(imageUnavailableSegment ? [imageUnavailableSegment] : []),
    ...(mediaUnavailableSegment ? [mediaUnavailableSegment] : []),
  ];
  // Review Finding #2 — the ONLY difference from decisionUserSegments is
  // this list's 'question' segment (compactPromptQuestion instead of
  // promptQuestion): every system segment above is shared by reference,
  // so the ADL-050 guarantee holds automatically, by construction, for
  // this variant too.
  const continuationUserSegments = [
    aiContextAssembly.segment({
      source: 'question',
      stability: aiContextAssembly.STABILITY.TURN,
      target: 'user',
      content: compactPromptQuestion,
    }),
    ...(imageUnavailableSegment ? [imageUnavailableSegment] : []),
    ...(mediaUnavailableSegment ? [mediaUnavailableSegment] : []),
  ];
  const decisionSegments = [...sharedSystemSegments, ...decisionUserSegments];
  const continuationSegments = [...sharedSystemSegments, ...continuationUserSegments];
  const decisionImages = imagesSupported ? images : undefined;
  const decisionMedia = supportedMedia.length ? supportedMedia : undefined;
  // decisionContext is used for exactly ONE call — the initial decision —
  // and never rebuilt or reused after it. zeroToolFastPathActive: no
  // catalogue segment above means no names for describe_tools to resolve
  // against.
  let offeredTools = zeroToolFastPathActive ? [] : [...toolsWithPlan, buildSchemaMetaTool()];
  // CEO Vertex/Gemini audit #27 (2026-08-30) — process-level flag, not a
  // per-college DB read.
  const includeThoughts = config.experimentalThinkingTraceVisibility;
  // ARCNAVE modernization P2 / clash C2 — explicit Vertex prompt caching.
  // Resolved ONCE here, from this turn's stable system prefix, and handed
  // to every completeWithTools call in the loop below, so the ADL-050
  // "system prefix byte-identical across the whole turn" guarantee holds
  // structurally.
  const cachedSystemInstructionName =
    adapter.name === 'gemini'
      ? await aiExplicitCache.resolveCachedSystemInstruction(
          aiConfig,
          decisionSegments
            .filter((s) => s.target === 'system')
            .map((s) => s.content)
            .join('\n\n'),
        )
      : null;
  const decisionContext = aiContextAssembly.buildContext(decisionSegments, {
    tools: offeredTools,
    images: decisionImages,
    media: decisionMedia,
    thinkingLevel,
    includeThoughts,
    cachedSystemInstructionName,
    historyTurns,
  });
  let continuationContext = aiContextAssembly.buildContext(continuationSegments, {
    tools: offeredTools,
    images: decisionImages,
    media: decisionMedia,
    thinkingLevel,
    includeThoughts,
    cachedSystemInstructionName,
    historyTurns,
  });

  return {
    decisionContext,
    continuationSegments,
    // A small mutable holder for values that genuinely evolve during the
    // act loop (schema-fetch tool grants) — not a god-object for the
    // whole request, just these two.
    holder: { offeredTools, continuationContext },
    decisionImages,
    decisionMedia,
    includeThoughts,
    cachedSystemInstructionName,
    imagesSupported,
    imageAnalysisUnavailable,
    promptVersionTag,
  };
}

// Phase 4 — DECIDE. The single initial completeWithTools call plus its
// telemetry.

module.exports = {
  resolveTurnContext,
  fetchTools,
  buildDecisionContext,
};
