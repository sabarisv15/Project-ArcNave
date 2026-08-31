'use strict';

// Vertex AI MaaS (Model-as-a-Service) adapter — third-party open models
// (Qwen3-Next, MiniMax M2, Kimi K2, GLM, etc.) hosted by Google on
// Vertex AI's OWN infrastructure, reached through ONE unified
// OpenAI-compatible endpoint that differs only by the `model` string in
// the request body — not a per-model publisher path the way gemini.js's
// modelUrl() needs. Confirmed live shape (WebSearch + a working curl
// example the project owner supplied this session):
//   https://{location}-aiplatform.googleapis.com/v1/projects/{projectId}
//     /locations/{location}/endpoints/openapi/chat/completions
//   body: { model: "qwen/qwen3-next-80b-a3b-thinking-maas", messages: [...] }
//
// Auth is Application Default Credentials via google-auth-library — the
// exact same mechanism gemini.js already uses for the same GCP project
// (no new credential system, per this session's plan). Request/response
// SHAPE, however, is the OpenAI-compatible convention selfHosted.js and
// openai.js already speak (messages/tools/tool_choice,
// choices[0].message, usage.prompt_tokens/completion_tokens) — Vertex's
// MaaS "openapi" route is documented as OpenAI-compatible, unlike
// Gemini's own native generateContent shape.
//
// This adapter exists for ARCNAVE's Tool Search step (Priority 1 Phase
// 1) — it is deliberately narrow: complete()/completeWithTools() are
// real, embed()/generateImage() throw AiProviderCapabilityError because
// this endpoint has no such capability, the same honest-limitation
// pattern selfHosted.js already uses for its own missing
// generateImage(). NOT live-verified end to end against a real GCP
// project from this environment — the request shape is the documented/
// demonstrated convention, not fabricated, but exercise it against a
// real project before trusting it in a live turn.

const crypto = require('crypto');
const { GoogleAuth } = require('google-auth-library');
const { LlmNotConfiguredError, LlmRequestError, AiProviderCapabilityError } = require('./errors');
const { withRetry } = require('./retry');
const {
  fetchWithTimeout,
  parseJsonResponse,
  extractOpenAiCompatibleUsage,
  buildOpenAiCompatiblePriorTurnMessages,
} = require('./openAiCompatibleUtils');
const { flattenToPrompts } = require('../aiContextAssembly');
const vertexCapabilityRegistry = require('../vertexCapabilityRegistry');

const REQUEST_TIMEOUT_MS = 30000;
const MAX_TOTAL_LATENCY_MS = 30000;
// Same non-regional Vertex host gemini.js already relies on (a real,
// live-verified exception to Vertex's usual per-region-subdomain
// pattern for that adapter) — used as the default here too, since MaaS
// endpoints live on the same Vertex AI surface. Override via cfg.location
// if a specific MaaS model turns out to need a real region.
const DEFAULT_LOCATION = 'global';
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
// Was 1024 (matching selfHosted.js/openai.js's own default, on the
// reasoning that Tool Search's own output is small) — WRONG for a
// "thinking" model (qwen3-next-80b-a3b-thinking-maas): its
// reasoning_content shares this same budget with the real answer, and a
// live-caught failure (this session) showed it spending the ENTIRE 1024
// tokens on internal reasoning for a TRIVIAL single-tool question,
// finish_reason: "length", zero tool call, zero content — every real
// call was silently falling back before ever reaching this service's
// schema/coverage logic. Exact same failure class gemini.js's own
// MAX_OUTPUT_TOKENS comment already documents for Gemini 3.x's hybrid
// reasoning, and the same fix: raise the ceiling so reasoning never
// crowds out the answer. 65536 chosen to match Gemini's own ceiling on
// this same Vertex AI surface — live-probed this session (real API
// call, max_tokens: 65536) and confirmed accepted (status 200,
// finish_reason: "tool_calls", not rejected the way a value past a
// real per-model ceiling would 400).
//
// NOT paired with a lowered "thinking level" the way gemini.js's
// GENERATION_CONFIG.thinkingConfig is: also live-probed this session
// (reasoning_effort: 'low' in the request body) and it made no
// measurable difference — the model still burned its entire budget
// reasoning on a three-word answer, finish_reason: "length" again. This
// MaaS OpenAI-compatible endpoint does not appear to expose a working
// reasoning-depth control for this model; a large MAX_TOKENS ceiling is
// the only lever confirmed to actually work.
const MAX_TOKENS = 65_536;

// A MaaS deployment's vision support varies per underlying model and
// isn't documented uniformly across them — no vision-capable convention
// is assumed here, same reasoning selfHosted.js's own supportsVision=false
// already carries for a vendor-unspecified deployment. This adapter is
// not used for multimodal turns in Phase 1 regardless (Tool Search only
// ever sees the question text — see aiToolSearchService.js).
const supportsVision = false;
// See claude.js's identical comment — audio/video is scoped to Gemini
// only for now; this adapter has no media-part construction.
const supportsAudioVideo = false;

function isConfigured(cfg) {
  // No sane default model exists here (unlike gemini.js's DEFAULT_MODEL)
  // — a MaaS model string always names a specific third-party vendor's
  // model, so an unset cfg.model must mean "not configured," never a
  // silent fallback to some arbitrary model.
  return Boolean(cfg && cfg.projectId && cfg.model);
}

function location(cfg) {
  return cfg.location || DEFAULT_LOCATION;
}

// Phase 8 — Vertex Capability Layer, same additive wiring as gemini.js's
// own getCapabilityProfile/supportsCapability. Every MaaS model (Qwen3-
// Next, MiniMax M2, Kimi K2, GLM, ...) is a third-party vendor model this
// registry has no curated entry for — a lookup here always returns
// unsupported-for-everything until/unless one is added, which correctly
// matches this adapter's own static supportsVision=false/
// supportsAudioVideo=false rather than contradicting it. cfg.model has no
// DEFAULT_MODEL fallback (isConfigured() above already requires an
// explicit cfg.model for this adapter), so an unconfigured cfg here
// simply produces a null-modelId lookup a caller should not make without
// isConfigured() first — same discipline every other cfg-consuming
// function in this file already expects.
function getCapabilityProfile(cfg = {}) {
  return vertexCapabilityRegistry.getCapabilityProfile({
    projectId: cfg.projectId,
    location: location(cfg),
    modelId: cfg.model,
    modelVersion: cfg.modelVersion,
  });
}

function supportsCapability(cfg = {}, capability) {
  return vertexCapabilityRegistry.hasCapability(
    {
      projectId: cfg.projectId,
      location: location(cfg),
      model: cfg.model,
      modelVersion: cfg.modelVersion,
    },
    capability,
  );
}

// The one fixed MaaS route — every model shares this same URL, selected
// entirely by the `model` field in the request body, unlike gemini.js's
// per-publisher-model modelUrl().
function chatCompletionsUrl(cfg) {
  const loc = location(cfg);
  const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${cfg.projectId}/locations/${loc}/endpoints/openapi/chat/completions`;
}

// One GoogleAuth instance reused across calls, same caching precedent
// gemini.js's own getAuth() already established for this same GCP
// project — a separate instance here, not a shared import, since each
// adapter file owns its own auth lifecycle (matches this folder's
// existing per-adapter-file convention).
let sharedAuth = null;
function getAuth() {
  if (!sharedAuth) {
    sharedAuth = new GoogleAuth({ scopes: CLOUD_PLATFORM_SCOPE });
  }
  return sharedAuth;
}

// cfg.accessToken: same test-only bearer-token override precedent as
// gemini.js's own getAccessToken() (this repo's Docker image is Node 20,
// too old for node:test's module-mocking).
async function getAccessToken(cfg) {
  if (cfg.accessToken) {
    return cfg.accessToken;
  }
  const client = await getAuth().getClient();
  const { token } = await client.getAccessToken();
  if (!token) {
    throw new LlmRequestError(
      'Google ADC did not return an access token — run `gcloud auth application-default login` or set GOOGLE_APPLICATION_CREDENTIALS',
    );
  }
  return token;
}

// Review Finding #15 — the single-attempt transport (AbortController from
// a timeout, fetch, network-error wrapping) and the response validation/
// JSON-parse below are shared mechanics (openAiCompatibleUtils.js),
// identical to selfHosted.js/openai.js's own postJson. The deadline
// budget/shrinking-per-attempt-timeout wrapped around it is NOT shared —
// selfHosted/openai have no equivalent concept — and stays local here.
async function postJson(cfg, body) {
  const token = await getAccessToken(cfg);
  const deadline = Date.now() + (cfg.maxTotalLatencyMs || MAX_TOTAL_LATENCY_MS);
  const response = await withRetry(async () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new LlmRequestError(
        'Vertex AI MaaS request exceeded its overall time budget before a response was received',
      );
    }
    return fetchWithTimeout({
      url: chatCompletionsUrl(cfg),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body,
      timeoutMs: Math.min(REQUEST_TIMEOUT_MS, remaining),
      providerLabel: 'Vertex AI MaaS',
    });
  });

  return parseJsonResponse(response, 'Vertex AI MaaS');
}

// Token/cost telemetry — OpenAI-compatible `usage` block, same shape
// openai.js/selfHosted.js already read. Review Finding #15 — this exact
// mapping was duplicated three times; extractOpenAiCompatibleUsage is the
// shared one, aliased here so every existing call site below is unchanged.
const extractUsage = extractOpenAiCompatibleUsage;

// Review Finding #4 (2026-08-29) — some Vertex MaaS models (the same
// reasoning models extractToolCallFromContent below already accommodates)
// emit their internal reasoning inline as <think>...</think> rather than
// through a separate structured field. extractToolCallFromContent already
// strips COMPLETE think blocks, but only as a means to isolate a tool-call
// JSON payload — its output is never returned as user-visible text, and it
// does not handle an UNCLOSED <think> tag at all (a truncated
// reasoning-model response left mid-thought). Every text value this file
// hands back as an "answer" must go through this instead, which is the one
// place responsible for making sure raw internal reasoning never reaches a
// user. Deliberately narrow — only <think> tags, nothing else — per this
// finding's own scope.
const THINK_BLOCK_PATTERN = /<think>[\s\S]*?<\/think>/gi;
// No matching close tag remains after the pass above — the tag opened but
// the response was truncated before it closed. Everything from that point
// on is unfinished internal reasoning, never visible text that happens to
// follow it, so it is removed to the end of the string rather than left in
// place.
const UNCLOSED_OPEN_THINK_PATTERN = /<think>[\s\S]*$/i;
// A stray closing tag with no opener left in the string (e.g. the opener
// was already consumed by a complete-block match earlier in the content) —
// removed on its own rather than left dangling in the visible answer.
const STRAY_CLOSE_THINK_PATTERN = /<\/think>/gi;

// content: whatever a provider response's message.content actually was.
// Non-string input (null/undefined/a structured value) is handed back
// unchanged — this function's only job is stripping think-tag noise from
// real text, never validating shape; every existing call site already has
// its own typeof/undefined check for that, before or after sanitizing, and
// must keep it.
function sanitizeModelOutput(content) {
  if (typeof content !== 'string') return content;
  return content
    .replace(THINK_BLOCK_PATTERN, '')
    .replace(UNCLOSED_OPEN_THINK_PATTERN, '')
    .replace(STRAY_CLOSE_THINK_PATTERN, '')
    .trim();
}

// Review Finding #9 (2026-08-30) — a response can be cut off by the
// output-length limit (finish_reason: "length") while still holding
// visible text, or even a syntactically-parseable partial tool call.
// Neither may ever be trusted as a genuine completed answer/tool call: a
// truncated student list ("Arun, Bala, and...") returned as complete is
// a wrong-data bug, not a formatting one, and a truncated tool-call JSON
// that happens to parse cleanly (e.g. missing a trailing argument) would
// execute with fabricated/missing arguments. Checked in both
// completeWithMeta and completeWithTools BEFORE any content/tool_calls
// parsing runs, so a truncated response is refused up front — it never
// reaches, and can never bypass, the parsing logic below it.
const FINISH_REASON = {
  COMPLETE: 'complete',
  TOOL_CALL: 'tool_call',
  TRUNCATED: 'truncated',
  CONTENT_FILTER: 'content_filter',
  UNKNOWN: 'unknown',
};

// Real values observed live this session against the actual endpoint
// (qwen/qwen3-next-80b-a3b-thinking-maas, during MAX_TOKENS's own
// incident above): "length" on a truncated response, "tool_calls" on a
// genuinely completed tool call — both consistent with this file's own
// header-comment claim that the wire shape is the OpenAI-compatible
// convention selfHosted.js/openai.js already speak, whose documented
// normal-completion value is "stop". "max_tokens"/"content_filter" are
// that same convention's other documented values, included defensively
// even though never directly observed against this specific endpoint —
// same "accommodate documented vendor behavior without assuming it's
// exercised yet" precedent extractToolCallFromContent's own comment
// already sets for this file. A missing or unrecognized reason
// normalizes to UNKNOWN, never COMPLETE or TRUNCATED by guesswork — the
// existing content/tool_calls-shape checks already downstream of this
// are what continue to gate a genuinely reason-less response, exactly as
// they did before this finding (a provider that omits finish_reason on
// an otherwise-valid response must not have that response rejected).
function normalizeFinishReason(rawFinishReason) {
  const reason = typeof rawFinishReason === 'string' ? rawFinishReason.toLowerCase() : null;
  if (reason === 'length' || reason === 'max_tokens') return FINISH_REASON.TRUNCATED;
  if (reason === 'tool_calls' || reason === 'function_call') return FINISH_REASON.TOOL_CALL;
  if (reason === 'content_filter') return FINISH_REASON.CONTENT_FILTER;
  if (reason === 'stop' || reason === 'end_turn') return FINISH_REASON.COMPLETE;
  return FINISH_REASON.UNKNOWN;
}

// Shared by completeWithMeta and completeWithTools — both throw the
// SAME LlmRequestError shape every other malformed-response case in
// this file already throws (e.g. "tool call arguments were not valid
// JSON" a few lines below), never a distinct `type: "truncated"` return
// value. Deliberately NOT a new return shape: completeWithMeta's return
// contract ({text, usage}) is shared verbatim across every provider
// adapter with no `type` field precedent to extend, and
// completeWithTools's decision.type IS locally extensible, but
// aiService.js's own "no tool was picked" answer path (the final block
// of askAgent) reads decision.text unconditionally with no type check at
// all — a new trusted-looking type value would silently reach it. A
// thrown error, by contrast, can never be silently rendered as a
// completed answer by any existing caller — every caller of
// completeWithMeta/completeWithTools already has to handle this class of
// throw today, for the exact "call failed" reason (rule 9 in spirit
// again: even the PROVIDER's own claimed length/cut-off state is
// re-verified here — the finish_reason field is trusted, not the
// content that follows it).
function truncationError(rawFinishReason) {
  return new LlmRequestError(
    `Vertex AI MaaS response was cut off before completion (finish_reason: ${rawFinishReason}) — ` +
      'refusing to treat partial text or a partial tool call as a completed result',
  );
}

async function completeWithMeta(cfg, arcnaveContext) {
  const { systemPrompt, userPrompt } = flattenToPrompts(arcnaveContext);
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError(
      'no Vertex AI MaaS provider is configured for this college (missing projectId or model)',
    );
  }

  const payload = await postJson(cfg, {
    model: cfg.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: MAX_TOKENS,
    temperature: 0.2,
  });

  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const finishReason = normalizeFinishReason(choice && choice.finish_reason);
  if (finishReason === FINISH_REASON.TRUNCATED || finishReason === FINISH_REASON.CONTENT_FILTER) {
    throw truncationError(choice.finish_reason);
  }
  const rawAnswer = choice && choice.message ? choice.message.content : undefined;
  if (typeof rawAnswer !== 'string') {
    throw new LlmRequestError('Vertex AI MaaS response did not contain choices[0].message.content');
  }
  const answer = sanitizeModelOutput(rawAnswer);
  if (!answer) {
    throw new LlmRequestError('Vertex AI MaaS response contained only internal reasoning, no visible answer text');
  }

  return { text: answer, usage: extractUsage(payload && payload.usage) };
}

async function complete(cfg, prompts) {
  const { text } = await completeWithMeta(cfg, prompts);
  return text;
}

// Review Finding #11 (2026-08-30) — a native tool_calls entry always
// carries the provider's own `id`, preserved unchanged (just trimmed —
// never a business decision, only whitespace hygiene). A
// content-embedded call (extractToolCallFromContent below) has no ID at
// all: MiniMax M2/Qwen3-Next both emit a tool call this way when they
// don't populate the structured message.tool_calls field (see that
// function's own comment), and an `undefined` callId silently vanishes
// under JSON.stringify — the key is OMITTED, not serialized as null —
// so the eventual `{ role: 'tool', tool_call_id: undefined, ... }`
// continuation message would reach the wire with no tool_call_id at
// all, leaving the model no way to associate the result with its own
// prior call. Called once per parsed tool call, at the earliest stable
// parsing boundary (inside completeWithTools, immediately where each
// path already builds its return value) — never re-derived later, so
// the same ID a caller sees in the returned `callId` is guaranteed to
// be the exact one buildPriorTurnMessages uses below on the next turn.
// No second "existingCallId" fallback tier: unlike some adapters, this
// one has no notion of a previously-known ID to fall back to before
// generating a fresh one — a native call always has the provider's own
// id, and a content-embedded call never has any id at all, so there is
// nothing meaningful to pass as a second tier.
function resolveToolCallId(rawId) {
  if (typeof rawId === 'string' && rawId.trim().length > 0) {
    return rawId.trim();
  }
  return `local_${crypto.randomUUID()}`;
}

// ADR-030 P2(c)-equivalent continuation shape — identical to
// selfHosted.js's own buildPriorTurnMessages, same OpenAI-compatible
// wire convention this adapter targets.
// Review Finding #15 — the actual message-pair construction below is
// shared (buildOpenAiCompatiblePriorTurnMessages, byte-identical to
// selfHosted.js/openai.js). The validation loop in front of it is NOT
// shared — it is Vertex-specific compatibility handling (Review Finding
// #11) that has no equivalent in the other two adapters, run first so an
// invalid turn throws before any message is built, exactly as before.
function buildPriorTurnMessages(priorTurns) {
  // Defense in depth only (Review Finding #11) — completeWithTools below
  // already normalizes every returned callId via resolveToolCallId before
  // a caller can ever construct a priorTurns entry from it, so this
  // should never actually fire. Deliberately NOT a silent regeneration
  // here: turn.rawToolCall (used for the assistant tool_calls entry, when
  // present) may carry its OWN id — generating a fresh replacement ID
  // only for tool_call_id while rawToolCall.id stays whatever it already
  // was would create a NEW mismatch between the two messages, worse than
  // the one this finding exists to fix. A thrown, existing-convention
  // LlmRequestError is the safe choice for a state normalization itself
  // already rules out.
  priorTurns.forEach((turn) => {
    if (typeof turn.callId !== 'string' || turn.callId.trim().length === 0) {
      throw new LlmRequestError(
        'Vertex AI MaaS: a prior tool turn has no valid call ID to associate its result with — refusing to send an unassociated tool-result message',
      );
    }
  });
  return buildOpenAiCompatiblePriorTurnMessages(priorTurns);
}

// Some Vertex MaaS models — measured live this session against the
// real endpoint, not documented/assumed — don't populate the standard
// OpenAI `message.tool_calls` field even when they DID decide to call
// a tool: MiniMax M2 (minimaxai/minimax-m2-maas) consistently embeds
// the call as text inside `message.content` instead, wrapped in a
// <think>...</think> reasoning block followed by a bare JSON array
// (`[{"name":"select_relevant_tools","parameters":{"names":[...]}}]`);
// Qwen3-Next-Thinking, on the rare call that didn't exhaust its whole
// token budget on reasoning_content first, used a similar but distinct
// `<tool_call>{"name":...,"arguments":{...}}</tool_call>` shape. Not a
// documented contract this codebase can rely on continuing to hold —
// a real, disclosed accommodation for real observed vendor behavior on
// this specific endpoint, checked ONLY as a fallback when the
// structured field is genuinely empty.
function extractToolCallFromContent(content) {
  if (typeof content !== 'string') return null;
  const withoutThinking = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!withoutThinking) return null;
  const tagMatch = withoutThinking.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
  const jsonText = tagMatch ? tagMatch[1].trim() : withoutThinking;
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  const call = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!call || typeof call.name !== 'string') return null;
  return { name: call.name.trim(), arguments: call.parameters || call.arguments || {} };
}

async function completeWithTools(cfg, arcnaveContext, priorTurns = []) {
  const { systemPrompt, userPrompt, tools } = flattenToPrompts(arcnaveContext);
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError(
      'no Vertex AI MaaS provider is configured for this college (missing projectId or model)',
    );
  }

  const payload = await postJson(cfg, {
    model: cfg.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
      ...buildPriorTurnMessages(priorTurns),
    ],
    tools: tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.params },
    })),
    tool_choice: 'auto',
    max_tokens: MAX_TOKENS,
    temperature: 0.2,
  });

  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const message = choice ? choice.message : null;
  if (!message) {
    throw new LlmRequestError('Vertex AI MaaS response did not contain choices[0].message');
  }

  // Checked before ANY parsing below — native tool_calls, the
  // content-embedded <tool_call>/bare-JSON fallback, and the plain-text
  // answer path all skip entirely once a truncated/filtered finish
  // reason is seen, so a cut-off response can never reach, and never
  // execute through, any of them (Review Finding #9).
  const finishReason = normalizeFinishReason(choice.finish_reason);
  if (finishReason === FINISH_REASON.TRUNCATED || finishReason === FINISH_REASON.CONTENT_FILTER) {
    throw truncationError(choice.finish_reason);
  }

  // Only toolCalls[0] is ever read here — this adapter's return contract
  // ({type: 'tool_call', toolName, ...}, a single call) has never
  // supported multiple simultaneous tool calls, native or
  // content-embedded (extractToolCallFromContent below also only ever
  // returns parsed[0]). Pre-existing scope, not something Review Finding
  // #11 changes or extends — that finding is about the ONE call this
  // path already returns always having a valid, stable ID, not about
  // adding multi-call support.
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const usage = extractUsage(payload && payload.usage);
  if (toolCalls.length > 0) {
    const fn = toolCalls[0].function || {};
    let toolArguments;
    try {
      toolArguments = fn.arguments ? JSON.parse(fn.arguments) : {};
    } catch (err) {
      throw new LlmRequestError(`Vertex AI MaaS tool call arguments were not valid JSON: ${err.message}`);
    }
    // toolCalls[0].id is the provider's own native ID — resolveToolCallId
    // preserves it unchanged (trimmed) whenever it's a valid non-empty
    // string; a native response missing even this would be unusual, but
    // is still covered rather than assumed impossible.
    return {
      type: 'tool_call',
      toolName: fn.name,
      arguments: toolArguments,
      callId: resolveToolCallId(toolCalls[0].id),
      rawToolCall: toolCalls[0],
      usage,
    };
  }

  const fallbackCall = extractToolCallFromContent(message.content);
  if (fallbackCall) {
    // No provider ID exists for a content-embedded call at all (see
    // extractToolCallFromContent's own comment) — resolveToolCallId(undefined)
    // always generates a fresh local_<uuid> here, exactly the case
    // Review Finding #11 exists to fix. rawToolCall stays undefined
    // (unchanged from before this finding): there is no real native
    // tool_calls entry to replay verbatim on the next turn, so
    // buildPriorTurnMessages's own `turn.rawToolCall ||` fallback
    // constructs a synthetic one FROM this same resolved callId instead.
    return {
      type: 'tool_call',
      toolName: fallbackCall.name,
      arguments: fallbackCall.arguments,
      callId: resolveToolCallId(undefined),
      rawToolCall: undefined,
      usage,
    };
  }

  if (typeof message.content !== 'string') {
    throw new LlmRequestError('Vertex AI MaaS response contained neither a tool call nor message content');
  }
  const sanitizedText = sanitizeModelOutput(message.content);
  if (!sanitizedText) {
    throw new LlmRequestError('Vertex AI MaaS response contained only internal reasoning, no visible answer text');
  }
  return { type: 'answer', text: sanitizedText, usage };
}

// No embeddings/image-generation endpoint on this MaaS chat-completions
// route — honest limitation, same AiProviderCapabilityError shape
// selfHosted.js's own missing generateImage() already uses. This
// adapter's only real job (Phase 1) is Tool Search, which never calls
// either.
async function embed() {
  throw new AiProviderCapabilityError(
    'the Vertex AI MaaS adapter has no embeddings endpoint — configure a different provider for embeddings',
  );
}

async function generateImage() {
  throw new AiProviderCapabilityError(
    'the Vertex AI MaaS adapter has no image-generation endpoint — configure a different provider for this feature',
  );
}

module.exports = {
  name: 'vertex_maas',
  supportsVision,
  supportsAudioVideo,
  getCapabilityProfile,
  supportsCapability,
  isConfigured,
  complete,
  completeWithMeta,
  completeWithTools,
  embed,
  generateImage,
  // Exported for direct unit testing only (same precedent as sse.js's
  // iterateSseLines) — not part of the adapter-wide provider contract
  // other files should import.
  sanitizeModelOutput,
  normalizeFinishReason,
  FINISH_REASON,
  resolveToolCallId,
  buildPriorTurnMessages,
};
