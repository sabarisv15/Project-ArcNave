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

const { GoogleAuth } = require('google-auth-library');
const {
  LlmNotConfiguredError, LlmRequestError, AiProviderCapabilityError,
} = require('./errors');
const { withRetry } = require('./retry');
const { flattenToPrompts } = require('../aiContextAssembly');

const REQUEST_TIMEOUT_MS = 30000;
const MAX_TOTAL_LATENCY_MS = 30000;
// Same non-regional Vertex host gemini.js already relies on (a real,
// live-verified exception to Vertex's usual per-region-subdomain
// pattern for that adapter) — used as the default here too, since MaaS
// endpoints live on the same Vertex AI surface. Override via cfg.location
// if a specific MaaS model turns out to need a real region.
const DEFAULT_LOCATION = 'global';
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
// Tool Search's own output is small (a short list of tool names) — no
// business reason for a large ceiling the way gemini.js's chat answers
// need MAX_OUTPUT_TOKENS=65536. Matches selfHosted.js/openai.js's own
// MAX_TOKENS=1024 default for the same reason.
const MAX_TOKENS = 1024;

// A MaaS deployment's vision support varies per underlying model and
// isn't documented uniformly across them — no vision-capable convention
// is assumed here, same reasoning selfHosted.js's own supportsVision=false
// already carries for a vendor-unspecified deployment. This adapter is
// not used for multimodal turns in Phase 1 regardless (Tool Search only
// ever sees the question text — see aiToolSearchService.js).
const supportsVision = false;

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
    throw new LlmRequestError('Google ADC did not return an access token — run `gcloud auth application-default login` or set GOOGLE_APPLICATION_CREDENTIALS');
  }
  return token;
}

async function postJson(cfg, body) {
  const token = await getAccessToken(cfg);
  const deadline = Date.now() + (cfg.maxTotalLatencyMs || MAX_TOTAL_LATENCY_MS);
  const response = await withRetry(async () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new LlmRequestError('Vertex AI MaaS request exceeded its overall time budget before a response was received');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, remaining));
    try {
      return await fetch(chatCompletionsUrl(cfg), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new LlmRequestError(`request to Vertex AI MaaS failed: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new LlmRequestError(`Vertex AI MaaS returned ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  try {
    return await response.json();
  } catch (err) {
    throw new LlmRequestError(`Vertex AI MaaS returned a non-JSON response: ${err.message}`);
  }
}

// Token/cost telemetry — OpenAI-compatible `usage` block, same shape
// openai.js/selfHosted.js already read.
function extractUsage(usage) {
  if (!usage) return undefined;
  return { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens };
}

async function completeWithMeta(cfg, arcnaveContext) {
  const { systemPrompt, userPrompt } = flattenToPrompts(arcnaveContext);
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no Vertex AI MaaS provider is configured for this college (missing projectId or model)');
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
  const answer = choice && choice.message ? choice.message.content : undefined;
  if (typeof answer !== 'string') {
    throw new LlmRequestError('Vertex AI MaaS response did not contain choices[0].message.content');
  }

  return { text: answer, usage: extractUsage(payload && payload.usage) };
}

async function complete(cfg, prompts) {
  const { text } = await completeWithMeta(cfg, prompts);
  return text;
}

// ADR-030 P2(c)-equivalent continuation shape — identical to
// selfHosted.js's own buildPriorTurnMessages, same OpenAI-compatible
// wire convention this adapter targets.
function buildPriorTurnMessages(priorTurns) {
  return priorTurns.flatMap((turn) => [
    {
      role: 'assistant',
      content: null,
      tool_calls: [turn.rawToolCall || {
        id: turn.callId, type: 'function', function: { name: turn.toolName, arguments: JSON.stringify(turn.arguments || {}) },
      }],
    },
    { role: 'tool', tool_call_id: turn.callId, content: turn.resultText },
  ]);
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
    throw new LlmNotConfiguredError('no Vertex AI MaaS provider is configured for this college (missing projectId or model)');
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
    return {
      type: 'tool_call', toolName: fn.name, arguments: toolArguments, callId: toolCalls[0].id, rawToolCall: toolCalls[0], usage,
    };
  }

  const fallbackCall = extractToolCallFromContent(message.content);
  if (fallbackCall) {
    return {
      type: 'tool_call', toolName: fallbackCall.name, arguments: fallbackCall.arguments, callId: undefined, rawToolCall: undefined, usage,
    };
  }

  if (typeof message.content !== 'string') {
    throw new LlmRequestError('Vertex AI MaaS response contained neither a tool call nor message content');
  }
  return { type: 'answer', text: message.content, usage };
}

// No embeddings/image-generation endpoint on this MaaS chat-completions
// route — honest limitation, same AiProviderCapabilityError shape
// selfHosted.js's own missing generateImage() already uses. This
// adapter's only real job (Phase 1) is Tool Search, which never calls
// either.
async function embed() {
  throw new AiProviderCapabilityError('the Vertex AI MaaS adapter has no embeddings endpoint — configure a different provider for embeddings');
}

async function generateImage() {
  throw new AiProviderCapabilityError('the Vertex AI MaaS adapter has no image-generation endpoint — configure a different provider for this feature');
}

module.exports = {
  name: 'vertex_maas',
  supportsVision,
  isConfigured,
  complete,
  completeWithMeta,
  completeWithTools,
  embed,
  generateImage,
};
