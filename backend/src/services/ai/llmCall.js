'use strict';

// LLM-call plumbing for aiService.js's askAgent/askAboutTool pipeline —
// audit-log + usage-counter telemetry (logLlmCall), the paused-DB-
// connection wrapper around a provider call (withPausedConnection),
// streaming/non-streaming dispatch (completeMaybeStreaming(Inner)),
// fast-model routing (selectModelForPurpose), and the post-tool-call
// answer-synthesis step (summarizeToolResult) plus its media-capability
// (resolveMediaSupport) and token-preflight (logAttachmentTokenPreflight)
// helpers. Split out of aiService.js — see that file's own header comment
// for the full split; moved verbatim, no behavior change.

const aiPromptSafetyLayer = require('../aiPromptSafetyLayer');
const aiPolicyAssembly = require('../aiPolicyAssembly');
const aiContextAssembly = require('../aiContextAssembly');
const aiCostControlService = require('../aiCostControlService');
const aiUsageCounterRepository = require('../../repositories/aiUsageCounterRepository');
const auditLogRepository = require('../../repositories/auditLogRepository');
const tracer = require('../../tracing/tracer');
const { logWarn, logError } = require('../../logging/logger');
const { TOOL_RESULT_ANSWER_SYSTEM_PROMPT, FILE_TOOL_NAMES } = require('./sharedConstants');

// Generates the natural-language answer for a successful tool call —
// askAgent's tool_call branch only (askAboutTool already has its own
// equivalent, unchanged, driven by the caller's explicit follow-up
// question rather than a fixed instruction). Reuses
// aiPromptSafetyLayer.renderForLlm's own systemPrompt/userPrompt
// exactly as askAboutTool does (the untrusted-data boundary framing is
// never touched here); TOOL_RESULT_ANSWER_SYSTEM_PROMPT and the tool's
// own registry description are appended to the systemPrompt only —
// both are this codebase's own trusted, developer-authored text, never
// retrieved/caller content, so neither needs rule 9's boundary
// wrapping the tool DATA itself still gets.
//
// `promptQuestion` (not `question`) is passed in here — askAgent below
// prepends the Workspace Focus hint (if any) to the raw question for
// every LLM-facing use, while the plain `question` field returned to
// the caller/UI stays exactly what the user typed.
// Streaming (P0.5) — used only for the final natural-language answer
// (this function, executeWorkflowPlan's synthesis, askAboutTool's
// answer), never the tool-select/plan-decision call (that needs the
// whole structured decision before anything downstream can run, so
// there's nothing meaningful to stream). `onDelta`, when given AND the
// resolved adapter actually implements completeStream, switches to the
// real per-chunk streaming call; every existing caller that never
// passes onDelta (every caller before this) is byte-for-byte
// unaffected — same adapter.complete() call as before.
// Token/cost telemetry (P1.1) — one audit_log row per non-streaming
// answer-generation call, additive metadata (JSONB, no migration).
// Deliberately scoped to the non-streaming path only this pass:
// capturing usage from an SSE stream needs a vendor-specific final
// event (OpenAI-compatible: an opt-in `stream_options.include_usage`
// chunk; Claude: message_delta's own usage; Gemini: not consistently
// present in-stream) — real, per-vendor work, not a corner cut for
// convenience. $ cost estimation is also deliberately not computed
// here — pricing changes per model/vendor faster than this file should
// hardcode a table; a later pass can derive cost from these raw token
// counts plus a maintained pricing config, not from a guess baked in.
// systemPromptChars/toolCount (ADR-030 P0) are per-call context-size
// telemetry, not vendor usage — always computable locally (the exact
// string/array the caller already built), unlike inputTokens/
// outputTokens which depend on a vendor actually returning a usage
// block. This is what P0's "measure before optimizing" needs: a
// baseline for what a fresh, unmodularized systemPrompt costs today
// (e.g. a bare "hi"), to compare against P1's module-split and P3's
// caching later — without either, "did it get smaller/cheaper" is a
// guess, not a measurement.
// Review Finding #13 (2026-08-30) — attempted/completed/fallbackTriggered
// are optional, purpose-specific lifecycle signals (currently only ever
// passed by the tool_search call site below). Every other existing call
// site omits them, so `undefined` is what they carry there — and
// JSON.stringify drops an `undefined`-valued key entirely, meaning every
// non-tool_search audit row's metadata shape is byte-for-byte unchanged.
// Their one job is fixing a real omission: a genuine Tool Search provider
// call that completed with no usage block previously produced NO audit
// row at all (indistinguishable from "never attempted"), because the
// guard below only ever kept a row alive via usage/imageCount/
// systemPromptChars/toolCount, none of which the tool_search call site
// ever had. `attempted: true` is a fifth, purpose-agnostic reason to keep
// the row — a real provider call happened and deserves a telemetry
// record even when every other signal is empty.
async function logLlmCall(
  client,
  {
    identityContext,
    adapter,
    aiConfig,
    purpose,
    usage,
    latencyMs,
    imageCount,
    systemPromptChars,
    toolCount,
    attempted,
    completed,
    fallbackTriggered,
    providerFallbackTriggered,
    providerFallbackReason,
  },
) {
  if (!usage && !imageCount && systemPromptChars === undefined && toolCount === undefined && !attempted) return;
  // ARCNAVE modernization P1 (PDF 1.9: "monitoring writes... 2-4
  // writes per turn, each waited on. Fix: fire and forget"). Not
  // awaited — the caller (completeMaybeStreaming) continues
  // immediately rather than blocking on this INSERT's round trip.
  // Deliberately still the SAME `client`/connection (not a separate
  // pool connection): node-postgres serializes queries per connection
  // in submission order regardless of whether the caller awaits, so
  // this can never reorder against a later COMMIT/pauseForExternalCall
  // on the same client, and every existing test's fake-client query
  // capture (client.queries) still sees this call synchronously —
  // only the actual DB round-trip latency moves off the turn's
  // critical path, not the write itself. Errors are swallowed+logged
  // rather than thrown, since nothing downstream awaits this promise
  // to report to.
  auditLogRepository
    .createAuditLogEntry(client, {
      collegeId: identityContext.collegeId,
      userId: identityContext.userId,
      action: 'ai_llm_call',
      entity: 'ai_llm',
      entityId: null,
      metadata: {
        provider: adapter.name,
        model: aiConfig.model,
        purpose,
        inputTokens: usage ? usage.inputTokens : undefined,
        outputTokens: usage ? usage.outputTokens : undefined,
        // ADR-030 P3 — only ever populated by gemini.js today (Vertex AI's
        // automatic implicit context caching, see that adapter's own
        // extractUsage comment); undefined for every other provider/purpose,
        // never coerced to 0, so a `NULL`/absent value in a query genuinely
        // means "no signal," not "confirmed zero cache hit."
        cachedTokens: usage ? usage.cachedTokens : undefined,
        // Only populated when a caller passes `attempted` (currently
        // tool_search only) — an explicit false/null signal, never a
        // fabricated 0, distinguishing "provider responded but reported no
        // usage" from "usage present" for a purpose where a completed call
        // can legitimately carry no usage block at all.
        usageAvailable: attempted !== undefined ? Boolean(usage) : undefined,
        latencyMs,
        imageCount: imageCount || undefined,
        systemPromptChars,
        toolCount,
        attempted,
        completed,
        fallbackTriggered,
        // CEO Vertex/Gemini audit #40 (2026-08-30) — deliberately a
        // DIFFERENT field from `fallbackTriggered` above, which already
        // means "Tool Search fell back to keyword routing" (an unrelated
        // concept that happens to share the word "fallback"). This one
        // means "this specific call's cross-provider fallback fired" —
        // aiProviderFallbackService's own onFallback callback.
        providerFallbackTriggered,
        providerFallbackReason,
      },
    })
    .catch((err) => {
      logError('ai_llm_call_audit_write_failed', { collegeId: identityContext.collegeId, error: err.message });
    });

  // ARCNAVE modernization P2 (PDF D4) — a SECOND fire-and-forget write
  // alongside the audit_log INSERT above, never a replacement for it:
  // audit_log stays the append-only source of truth/timeline; this
  // keeps aiCostControlService's monthly-quota read an O(1) primary-key
  // lookup instead of a full-month scan. Same connection, same
  // "errors swallowed+logged, nothing downstream awaits this" posture as
  // the audit write above — a failed increment must never fail or
  // retroactively distort the turn that already completed. periodMonth
  // uses aiCostControlService's own startOfCurrentMonth so the boundary
  // an increment writes against is always identical to the one a read
  // later queries against.
  const tokensDelta = usage ? (usage.inputTokens || 0) + (usage.outputTokens || 0) : 0;
  aiUsageCounterRepository
    .incrementUsage(client, identityContext.collegeId, aiCostControlService.startOfCurrentMonth(), {
      tokensDelta,
      callsDelta: 1,
    })
    .catch((err) => {
      logError('ai_usage_counter_increment_failed', { collegeId: identityContext.collegeId, error: err.message });
    });
}

// Returns { text, usage } — usage undefined when genuinely unknown
// (adapter has no completeWithMeta/completeStream-with-onUsage, or the
// vendor's own response never carried a usage block). Every call site
// threads usage into its own returned result so the frontend can render
// it per-message (P1.6/ADL-048), the same way evidence/verification
// already ride alongside `answer`.
// ARCNAVE modernization P0 (PDF 4.1 / clash C5): this is the single
// choke point every LLM provider network call in this file funnels
// through, which is what makes it the one place that needs to pause
// the DB connection — see db/tenantConnection.js's module comment for
// the full rationale and the atomicity trade-off the owner approved.
// `client` may be a plain object (some test doubles / the non-request
// call sites in this file) as well as a real TenantConnection — only
// pause/resume when the capability is actually present, so this stays
// a no-op everywhere else, byte-identical to before this existed.
async function withPausedConnection(client, fn) {
  const canPause = client && typeof client.pauseForExternalCall === 'function' && typeof client.resume === 'function';
  if (!canPause) return fn();
  await client.pauseForExternalCall();
  try {
    return await fn();
  } finally {
    await client.resume();
  }
}

// ARCNAVE modernization P1 (PDF 1.15/4.4) — every LLM provider call in
// this file funnels through this one function (see the P0 comment
// just above it), which makes it the other natural span boundary
// alongside invokeTool's own 'ai_tool_call' span — together, one AI
// turn's spans (however many tool calls + LLM calls it made) all
// share the request's traceId and form one real tree.
async function completeMaybeStreaming(client, identityContext, adapter, aiConfig, arcnaveContext, purpose, onDelta) {
  return tracer.withSpan('ai_llm_call', { purpose, provider: adapter.name, model: aiConfig.model }, () =>
    completeMaybeStreamingInner(client, identityContext, adapter, aiConfig, arcnaveContext, purpose, onDelta),
  );
}

async function completeMaybeStreamingInner(
  client,
  identityContext,
  adapter,
  aiConfig,
  arcnaveContext,
  purpose,
  onDelta,
) {
  const startedAt = Date.now();
  // ADR-030 P2(a): arcnaveContext no longer carries a top-level
  // systemPrompt string (only .segments) — flattened once here, purely
  // for this telemetry field. Cheap/pure, and keeps this file decoupled
  // from each adapter's own internal flattening.
  const { systemPrompt: flatSystemPrompt } = aiContextAssembly.flattenToPrompts(arcnaveContext);
  if (onDelta && typeof adapter.completeStream === 'function') {
    // Streaming path — closes the gap this comment used to flag as
    // deliberately deferred: onUsage (per-vendor, see each adapter's own
    // completeStream comment) now lets this call be audited exactly like
    // the non-streaming branch below, not a second, drifting mechanism.
    let usage;
    const text = await withPausedConnection(client, () =>
      adapter.completeStream(aiConfig, arcnaveContext, onDelta, (u) => {
        usage = u;
      }),
    );
    await logLlmCall(client, {
      identityContext,
      adapter,
      aiConfig,
      purpose,
      usage,
      latencyMs: Date.now() - startedAt,
      systemPromptChars: flatSystemPrompt ? flatSystemPrompt.length : undefined,
    });
    return { text, usage };
  }
  if (typeof adapter.completeWithMeta === 'function') {
    const { text, usage } = await withPausedConnection(client, () =>
      adapter.completeWithMeta(aiConfig, arcnaveContext),
    );
    await logLlmCall(client, {
      identityContext,
      adapter,
      aiConfig,
      purpose,
      usage,
      latencyMs: Date.now() - startedAt,
      systemPromptChars: flatSystemPrompt ? flatSystemPrompt.length : undefined,
    });
    return { text, usage };
  }
  const text = await withPausedConnection(client, () => adapter.complete(aiConfig, arcnaveContext));
  return { text, usage: undefined };
}

// Model routing (P1.3) — only ever applied to the SYNTHESIS call
// (natural-language description of a tool result already fetched),
// never the tool-select call (round 2's own finding, preserved above
// the fast_model migration's comment: call #1 has no risk signal yet
// and must never be downgraded). `riskLevel` is the tool's own
// deterministically-computed R0-R5 value (RISK_MATRIX) — R0/R1 is
// exactly the L1-read set (get_college_profile, students_roster, ...),
// a pure "describe already-safe, already-fetched data" task that a
// smaller model handles fine. No fastModel configured -> no routing,
// byte-for-byte the same single-model behavior as before this existed.
const FAST_MODEL_MAX_RISK_LEVEL = 1;

function selectModelForPurpose(aiConfig, riskLevel) {
  if (!aiConfig.fastModel || riskLevel === undefined || riskLevel > FAST_MODEL_MAX_RISK_LEVEL) {
    return aiConfig;
  }
  return { ...aiConfig, model: aiConfig.fastModel };
}

// ADR-030 P2(c) — renders one tool invocation's sanitized entries into the
// boundary-wrapped text a `priorTurns` tool-result message carries, same
// untrusted-data framing every tool result already gets (mirrors
// aiPromptSafetyLayer.renderForLlm's own dataBlock/boundary construction,
// minus the trailing "Question:" — that only applies to the ONE real user
// question, never to a synthetic continuation turn).
function renderToolResultText(sanitizedContext) {
  const dataBlock = sanitizedContext.entries
    .map(
      (entry) =>
        `[tool: ${entry.toolName}, classification: ${entry.dataClassification}, retrievedAt: ${entry.retrievedAt}]\n${entry.data}`,
    )
    .join('\n\n');
  return `${sanitizedContext.boundaryStart}\n${dataBlock}\n${sanitizedContext.boundaryEnd}`;
}

// ADR-030 P2(c) — sums usage across every completeWithTools/synthesis
// call made in one askAgent turn, so the response's own `usage` field
// reflects the true per-turn cost once a turn can span more than one LLM
// call, not just whichever single call happened to run last.
function addUsage(total, usage) {
  if (!usage) return total;
  if (!total) return { ...usage };
  return {
    inputTokens: (total.inputTokens || 0) + (usage.inputTokens || 0),
    outputTokens: (total.outputTokens || 0) + (usage.outputTokens || 0),
  };
}

// ADR-030 P2(c): generalized from a single `tool` to a `tools` array so
// this can serve as the tool-use loop's fallback synthesis call (cap
// reached, or a confirmation-gated tool appeared at iteration > 0) as
// well as the true single-tool compatibility-mode case (MAX_TOOL_CALLS_
// PER_TURN=1) — for exactly one tool this is INTENDED to collapse back to
// the original single-tool call shape (see the explicit synthesis-request
// regression test in ai-service.test.js; not assumed byte-identical from
// the algorithm's shape alone). `blockedActionNote`, when given, is an
// extra system segment surfacing a mid-loop tool that needed confirmation
// and was NOT run — same "say so plainly, never silently omit" idiom
// executeWorkflowPlan's own failureText already uses for failed steps.
async function summarizeToolResult(
  client,
  identityContext,
  sanitizedContext,
  promptQuestion,
  tools,
  adapter,
  aiConfig,
  identityBlock,
  hasHistory,
  historyTurns,
  onDelta,
  blockedActionNote,
) {
  const { systemPrompt, userPrompt } = aiPromptSafetyLayer.renderForLlm(sanitizedContext, promptQuestion);
  // ADR-030 P2(a): builds an ARCNAVE Context instead of flat strings —
  // representation change only, byte-identical output. identityBlock
  // stays last — ADR-030 P0 (see executeWorkflowPlan's own comment).
  const hasFileTool = tools.some((t) => FILE_TOOL_NAMES.has(t.name));
  const policy = aiPolicyAssembly.buildPolicy({
    mode: 'curriculum',
    hasHistory,
    toolCount: tools.length,
    hasFileTool,
    focusEntityType: null,
  });
  const toolDescriptionNote =
    tools.length === 1
      ? `The tool that was called: ${tools[0].name} — ${tools[0].description}`
      : `The tools that were called, in order:\n${tools.map((t) => `${t.name}: ${t.description}`).join('\n')}`;
  const segments = [
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
      source: 'tool-description-note',
      stability: aiContextAssembly.STABILITY.TURN,
      target: 'system',
      content: toolDescriptionNote,
    }),
  ];
  if (blockedActionNote) {
    segments.push(
      aiContextAssembly.segment({
        source: 'blocked-action-note',
        stability: aiContextAssembly.STABILITY.TURN,
        target: 'system',
        content: blockedActionNote,
      }),
    );
  }
  segments.push(
    aiContextAssembly.segment({
      source: 'identity',
      stability: aiContextAssembly.STABILITY.CONVERSATION,
      target: 'system',
      content: identityBlock,
    }),
    // ADR-030 P1: TOOL_RESULT_ANSWER_SYSTEM_PROMPT's turn-specific
    // guidance (₹ formatting, scope/action-substitution disclosure) lives
    // in the message stream, not the system segments — same text, same
    // content, unchanged from P1.
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
  );
  const arcnaveContext = aiContextAssembly.buildContext(segments, { historyTurns });
  // Model routing (P1.3), mirroring executeWorkflowPlan's own maxRiskLevel
  // reduce — routed on the HIGHEST riskLevel across every tool that ran,
  // never an average or the first tool's alone.
  const maxRiskLevel = tools.reduce((max, t) => Math.max(max, t.riskLevel), 0);
  const routedConfig = selectModelForPurpose(aiConfig, maxRiskLevel);
  return completeMaybeStreaming(client, identityContext, adapter, routedConfig, arcnaveContext, 'tool_answer', onDelta);
}

// The tool-selection entry point (routes/ai.js's POST /ai/ask): the
// caller names no tool, only a question — the LLM picks one (or none)
// from the registry's own list. Whatever it picks is never trusted
// directly; it's re-run through the exact same invokeTool (Policy Gate
// -> handler -> Context Builder -> Prompt Safety Layer, including its
// own ai_tool_invoked audit log) any other caller of this pipeline
// uses — no new gate, no special path. A hallucinated/unknown tool
// name fails exactly like any other caller naming a bad tool would
// (AiToolNotFoundError out of aiToolRegistry.invokeTool) — a clean,
// existing rejection, not a crash, and not a case this function needs
// to special-case (AI-Governance.md §3: tool invocation is only ever
// triggered by the authenticated user's own request; the LLM's
// suggestion carries no authority of its own).
//
// `focusContext` (optional, { entityType, id }) is the Workspace Focus
// hint — see buildFocusHint above. It never changes what this function
// returns structurally and creates no new state; it only changes the
// wording of the prompt(s) sent to the LLM for THIS call.
// `onDelta` (P0.5, optional) — streams the final natural-language
// answer chunk-by-chunk if given; never changes what this function
// returns (the full answer is still assembled and returned exactly as
// before), only how the caller can additionally observe it arriving.
// The tool-select/plan-decision call itself is never streamed — see
// completeMaybeStreaming's own comment.
//
// Research mode — the composer toggle's broad side (see AskActToggle.jsx's
// own rename), a deliberate second axis alongside the Policy Gate rather
// than a loosening of it: Curriculum mode is completely unchanged (same
// role/relevance-filtered tool list, same per-call Policy Gate), General
// mode instead offers the model NO tool at all (askGeneralChat below
// never builds a tools array), so there is nothing for invokeTool/the
// Policy Gate to re-fire against — the boundary is structural (no tool
// exists to call), not just a prompt instruction a model could ignore.
// Exists because staff research/coursework/new-tech questions have
// nothing to do with any college record and shouldn't be constrained by
// a tool-selection prompt built for exactly that. No tool is ever
// offered to the model, so this reuses completeMaybeStreaming directly
// (the same plain-completion path askAboutTool's answer and every
// synthesis call already goes through) instead of
// adapter.completeWithTools, which exists specifically to let a model
// pick FROM a tool list that here is deliberately empty.
// Phase 8 — Vertex Capability Layer. The two call sites below both need
// the same "can this adapter actually accept what's attached" check.
// When the resolved adapter is one of the Vertex-backed ones (gemini,
// vertex_maas — both now export supportsCapability(cfg, capability), see
// each adapter's own comment), the check is a real per-project/region/
// model lookup through vertexCapabilityRegistry instead of a flat,
// vendor-wide guess; every other adapter (claude/openai/self_hosted)
// keeps its existing static supportsVision/supportsAudioVideo behavior
// unchanged — this is additive, never a behavior change for a college
// not on a Vertex-backed provider. images/media capability are checked
// separately (never OR'd together) so an unverified modality — e.g. this
// registry's own multimodal_video note — cannot silently ride on a
// verified one's `true`.
function resolveMediaSupport(adapter, aiConfig, images, media) {
  const supportsImage =
    typeof adapter.supportsCapability === 'function'
      ? adapter.supportsCapability(aiConfig, 'multimodal_image')
      : Boolean(adapter.supportsVision);
  const supportsAudioOrVideo =
    typeof adapter.supportsCapability === 'function'
      ? adapter.supportsCapability(aiConfig, 'multimodal_audio') ||
        adapter.supportsCapability(aiConfig, 'multimodal_video')
      : Boolean(adapter.supportsAudioVideo);
  // P2 2.1 — native PDF attachments (resolveChatAttachments) are tagged
  // capability: 'multimodal_pdf' and travel through this same `media`
  // array, but are gated independently from audio/video: a PDF's own
  // text-extraction fallback already ran unconditionally (2.1 is
  // additive, never a replacement — RS-AIG-019/the file-intelligence-
  // router spec bars touching that deterministic path), so an
  // unsupported PDF item is dropped silently below, never surfaced via
  // buildMediaUnavailableNote (that note's wording is audio/video-
  // specific and implies total unavailability, which isn't true here).
  const supportsDocument =
    typeof adapter.supportsCapability === 'function'
      ? adapter.supportsCapability(aiConfig, 'multimodal_pdf')
      : Boolean(adapter.supportsDocument);
  const audioVideoMedia = media.filter((item) => item.capability !== 'multimodal_pdf');
  const documentMedia = media.filter((item) => item.capability === 'multimodal_pdf');
  const mediaSupported = audioVideoMedia.length > 0 && supportsAudioOrVideo;
  const documentsSupported = documentMedia.length > 0 && supportsDocument;
  const imagesSupported = images.length > 0 && supportsImage;
  const supportedMedia = [...(mediaSupported ? audioVideoMedia : []), ...(documentsSupported ? documentMedia : [])];
  return {
    imagesSupported,
    imageAnalysisUnavailable: images.length > 0 && !imagesSupported,
    mediaSupported,
    mediaAnalysisUnavailable: audioVideoMedia.length > 0 && !mediaSupported,
    supportedMedia,
  };
}

// CEO Vertex/Gemini audit #34 (2026-08-30) — "Token Counting Preflight",
// a real gap ADL-055 had only ever measured from a standalone script,
// never wired into a live request path. Purely advisory telemetry, never
// a gate: a measurement failure (unsupported provider, network error)
// is caught and logged, never allowed to affect the real turn. Only
// gemini/vertex_maas export countTokens today (Phase 8) — every other
// provider silently skips this, same "additive, no behavior change for
// a provider with no native support" posture #12/RS-AIG-028 already
// established. Not tuned against a real measured cost ceiling yet —
// first real threshold, adjust once production data exists.
const TOKEN_PREFLIGHT_WARN_THRESHOLD = 100_000;

function logAttachmentTokenPreflight({ adapter, aiConfig, identityContext, attachmentHint, images, media }) {
  if (typeof adapter.countTokens !== 'function') return;
  if (!attachmentHint && images.length === 0 && media.length === 0) return;

  adapter
    .countTokens(
      aiConfig,
      aiContextAssembly.contextFromFlatPrompts({
        systemPrompt: "token preflight — attachment-derived content only, not the real turn's full context",
        userPrompt: attachmentHint || '(attachment only, no text hint)',
        images,
        media,
      }),
    )
    .then(({ totalTokens }) => {
      if (totalTokens >= TOKEN_PREFLIGHT_WARN_THRESHOLD) {
        logWarn('ai_attachment_token_preflight_large', {
          collegeId: identityContext.collegeId,
          totalTokens,
          threshold: TOKEN_PREFLIGHT_WARN_THRESHOLD,
        });
      }
    })
    .catch((err) => {
      logWarn('ai_attachment_token_preflight_failed', { collegeId: identityContext.collegeId, error: err.message });
    });
}

module.exports = {
  logLlmCall,
  withPausedConnection,
  completeMaybeStreaming,
  selectModelForPurpose,
  renderToolResultText,
  addUsage,
  summarizeToolResult,
  resolveMediaSupport,
  logAttachmentTokenPreflight,
  TOKEN_PREFLIGHT_WARN_THRESHOLD,
};
