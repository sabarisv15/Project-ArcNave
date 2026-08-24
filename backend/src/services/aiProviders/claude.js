'use strict';

// Anthropic Claude adapter — two real, independently-verified transports
// behind one module, selected by which credential shape `cfg` carries:
//
//   cfg.apiKey    -> direct Anthropic Messages API (api.anthropic.com).
//                    Request/response shapes are real, per Anthropic's
//                    documented REST API, but NOT live-verified against a
//                    real key (none exists in this environment).
//   cfg.projectId -> Claude on Vertex AI (same ADC/project pattern
//                    gemini.js uses — a server-level GCP credential, not a
//                    per-college secret). URL/body shape and the "global"
//                    location's plain aiplatform.googleapis.com host (no
//                    region prefix, same real exception gemini.js already
//                    documents) were live-verified against a real project
//                    (project-8bcf740a-a7bd-4aea-974, claude-sonnet-5): a
//                    429 RESOURCE_EXHAUSTED naming the real base model
//                    confirms the request reached and was correctly
//                    routed by the real endpoint — this project's Vertex
//                    quota for Claude is 0 pending a Google-reviewed
//                    increase, not a shape/auth problem.
//
// If both are present, projectId wins — Vertex is configurationService's
// only mechanism for this provider today (see its own globalClaudeConfig
// comment: like Gemini, this is a global env-configured block, not a
// per-college college_ai_config row, because ADC is server-level).
//
// No embed(): Anthropic has no first-party embeddings endpoint on either
// transport. This is a real, structural limitation of the vendor, not
// something this adapter chose to skip — it throws
// AiProviderCapabilityError loudly rather than silently returning a fake
// vector, so a college that picks 'claude' as its provider and then tries
// to use a RAG/search feature gets a clear error naming the actual cause,
// not a wrong answer.

const { GoogleAuth } = require('google-auth-library');
const { LlmNotConfiguredError, LlmRequestError, AiProviderCapabilityError } = require('./errors');
const { withRetry } = require('./retry');
const { iterateSseLines } = require('./sse');
const { flattenToPrompts } = require('../aiContextAssembly');

const REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 1024;

// Vertex's own required body field naming this API version — a real,
// distinct constant from ANTHROPIC_VERSION above (that one's a header,
// direct-API-only; this one's a body field, Vertex-only), not a typo.
const ANTHROPIC_VERTEX_VERSION = 'vertex-2023-10-16';
// Same 'global' exception gemini.js's own DEFAULT_LOCATION comment
// documents — live-verified here too, not assumed by analogy.
const DEFAULT_VERTEX_LOCATION = 'global';
const DEFAULT_VERTEX_MODEL = 'claude-sonnet-5';
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

const supportsVision = true;

function isVertexMode(cfg) {
  return Boolean(cfg && cfg.projectId);
}

function isConfigured(cfg) {
  return Boolean(cfg && (cfg.projectId || cfg.apiKey));
}

// One GoogleAuth instance reused across calls, same caching rationale as
// gemini.js's own getAuth() (not a fresh ADC handshake every request).
// A separate instance from gemini.js's — different adapters, no shared
// module-level state assumed between them.
let sharedAuth = null;
function getAuth() {
  if (!sharedAuth) {
    sharedAuth = new GoogleAuth({ scopes: CLOUD_PLATFORM_SCOPE });
  }
  return sharedAuth;
}

async function getAccessToken(cfg) {
  if (cfg.accessToken) {
    return cfg.accessToken;
  }
  const client = await getAuth().getClient();
  const { token } = await client.getAccessToken();
  if (!token) {
    throw new LlmRequestError('Google ADC did not return an access token for Claude-on-Vertex — run `gcloud auth application-default login` or set GOOGLE_APPLICATION_CREDENTIALS');
  }
  return token;
}

// Vertex's publisher-model base path — the 'anthropic' publisher's own
// mirror of gemini.js's modelUrl for the 'google' publisher. Verb is
// 'rawPredict' (non-streaming) or 'streamRawPredict' (streaming) —
// Anthropic-on-Vertex's own verbs, not Gemini's generateContent/
// streamGenerateContent.
function vertexModelUrl(cfg, verb) {
  const location = cfg.location || DEFAULT_VERTEX_LOCATION;
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  const model = cfg.model || DEFAULT_VERTEX_MODEL;
  return `https://${host}/v1/projects/${cfg.projectId}/locations/${location}/publishers/anthropic/models/${model}:${verb}`;
}

// Builds the user message's `content` — a plain string when no images
// are attached (unchanged shape every existing caller/test expects),
// or Anthropic's real multipart vision shape (image blocks first, text
// block last) when images are present. Real Anthropic Messages API
// image-block shape: base64 source, not a URL.
function buildUserContent(userPrompt, images) {
  if (!images || images.length === 0) {
    return userPrompt;
  }
  return [
    ...images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
    })),
    { type: 'text', text: userPrompt },
  ];
}

function baseUrl(cfg) {
  return cfg.baseUrl || DEFAULT_BASE_URL;
}

// bodyFields: { model, max_tokens, system, messages, tools? } — the
// transport-agnostic request shape both completeWithMeta and
// completeWithTools already build. Vertex's rawPredict/streamRawPredict
// takes the model from the URL (never the body — a real, live-verified
// difference from the direct API, which takes it from the body and has
// no per-model URL segment at all) and needs anthropic_version as a body
// field instead of a header; prompt-caching's anthropic-beta header has
// no Vertex equivalent in this adapter yet (not exercised — this project
// has zero Vertex quota for Claude to verify caching behavior against).
async function buildRequest(cfg, bodyFields, verb) {
  if (isVertexMode(cfg)) {
    // model: encoded in the URL, never the body, on Vertex. stream: the
    // URL verb (rawPredict vs streamRawPredict) is what selects
    // streaming here — Vertex has no body-level `stream` flag the way
    // the direct API does.
    const { model, stream, ...rest } = bodyFields;
    const token = await getAccessToken(cfg);
    return {
      url: vertexModelUrl(cfg, verb === 'stream' ? 'streamRawPredict' : 'rawPredict'),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: { anthropic_version: ANTHROPIC_VERTEX_VERSION, ...rest },
    };
  }
  return {
    url: `${baseUrl(cfg)}/v1/messages`,
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      // Prompt caching (P1.2) — additive/harmless on any request that
      // doesn't use cache_control (Anthropic ignores it), so this is set
      // unconditionally rather than only on the one call site that
      // actually adds a cache_control breakpoint (completeWithTools).
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: bodyFields,
  };
}

async function doFetch(url, headers, body) {
  return withRetry(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
      });
    } catch (err) {
      throw new LlmRequestError(`request to Claude failed: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  });
}

async function postJson(cfg, bodyFields) {
  const { url, headers, body } = await buildRequest(cfg, bodyFields, 'json');
  const response = await doFetch(url, headers, body);

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new LlmRequestError(`Claude returned ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  try {
    return await response.json();
  } catch (err) {
    throw new LlmRequestError(`Claude returned a non-JSON response: ${err.message}`);
  }
}

// Token/cost telemetry (P1.1) — see openai.js's own comment for the
// shared reasoning. Claude's usage block uses input_tokens/output_tokens,
// not the OpenAI-compatible prompt_tokens/completion_tokens naming.
async function completeWithMeta(cfg, arcnaveContext) {
  const { systemPrompt, userPrompt, images } = flattenToPrompts(arcnaveContext);
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing apiKey/projectId)');
  }

  const payload = await postJson(cfg, {
    model: cfg.model,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: buildUserContent(userPrompt, images) }],
  });

  const block = payload && Array.isArray(payload.content) ? payload.content.find((b) => b.type === 'text') : null;
  if (!block || typeof block.text !== 'string') {
    throw new LlmRequestError('Claude response did not contain a text content block');
  }

  const usage = payload && payload.usage
    ? { inputTokens: payload.usage.input_tokens, outputTokens: payload.usage.output_tokens }
    : undefined;
  return { text: block.text, usage };
}

async function complete(cfg, prompts) {
  const { text } = await completeWithMeta(cfg, prompts);
  return text;
}

// Streaming variant of complete() (P0.5) — see openai.js's own comment
// for the shared reasoning (only the final answer streams, retries
// only cover the initial connection). Anthropic's Messages API SSE
// sends several named event types (message_start, content_block_start/
// delta/stop, message_delta, message_stop) — iterateSseLines only
// yields `data:` lines (the `event:` line is redundant with the JSON
// payload's own `type` field, so nothing here needs it), so only
// `content_block_delta` events with a `text_delta` are real answer
// text; every other event type is legitimately ignored, not an error.
// onUsage (optional, P1.6) — called at most once, after the stream ends,
// with {inputTokens, outputTokens} when the API actually reported them.
// Anthropic's Messages API reports input tokens once on message_start
// (message.usage.input_tokens) and cumulative output tokens on every
// message_delta (delta.usage.output_tokens, growing as generation
// proceeds) — the LAST message_delta's value is the final total, so this
// simply keeps overwriting rather than summing. Never called if neither
// event carried a usage block, rather than reporting a fabricated zero.
async function completeStream(cfg, arcnaveContext, onDelta, onUsage) {
  const { systemPrompt, userPrompt, images } = flattenToPrompts(arcnaveContext);
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing apiKey/projectId)');
  }

  const { url, headers, body } = await buildRequest(cfg, {
    model: cfg.model,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: buildUserContent(userPrompt, images) }],
    stream: true,
  }, 'stream');
  const response = await doFetch(url, headers, body);

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new LlmRequestError(`Claude returned ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  let full = '';
  let inputTokens;
  let outputTokens;
  for await (const payload of iterateSseLines(response)) {
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      continue;
    }
    if (event && event.type === 'content_block_delta' && event.delta && event.delta.type === 'text_delta') {
      const { text } = event.delta;
      if (typeof text === 'string' && text.length > 0) {
        full += text;
        onDelta(text);
      }
    } else if (event && event.type === 'message_start' && event.message && event.message.usage) {
      inputTokens = event.message.usage.input_tokens;
    } else if (event && event.type === 'message_delta' && event.usage) {
      outputTokens = event.usage.output_tokens;
    }
  }
  if (typeof onUsage === 'function' && (inputTokens !== undefined || outputTokens !== undefined)) {
    onUsage({ inputTokens, outputTokens });
  }
  return full;
}

async function completeWithTools(cfg, arcnaveContext) {
  const {
    systemPrompt, userPrompt, tools, images,
  } = flattenToPrompts(arcnaveContext);
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing apiKey/projectId)');
  }

  const payload = await postJson(cfg, {
    model: cfg.model,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: buildUserContent(userPrompt, images) }],
    // Prompt caching (P1.2): a cache_control breakpoint on the LAST
    // tool caches this entire tools array — the ~10k-token role-
    // filtered tool schema list, unlike the system/user prompt which
    // varies per user/turn, is identical across calls in the same
    // role's short caching window (Anthropic's default TTL). Round 2's
    // own design ("role-level prompt caching") — the breakpoint sits
    // on the tool list specifically because that's the actually-stable
    // block, not because caching the whole request would be wrong to
    // want, it just wouldn't cache anything real given how much of the
    // rest changes every call.
    tools: tools.map((tool, index) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.params,
      ...(index === tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
    })),
  });

  const blocks = Array.isArray(payload && payload.content) ? payload.content : [];
  const toolUse = blocks.find((b) => b.type === 'tool_use');
  if (toolUse) {
    // ADR-030 P0 telemetry — see gemini.js's own equivalent comment.
    const usage = payload && payload.usage
      ? { inputTokens: payload.usage.input_tokens, outputTokens: payload.usage.output_tokens }
      : undefined;
    return {
      type: 'tool_call', toolName: toolUse.name, arguments: toolUse.input || {}, usage,
    };
  }

  const textBlock = blocks.find((b) => b.type === 'text');
  if (!textBlock) {
    throw new LlmRequestError('Claude response contained neither a tool_use block nor a text block');
  }
  const usage = payload && payload.usage
    ? { inputTokens: payload.usage.input_tokens, outputTokens: payload.usage.output_tokens }
    : undefined;
  return { type: 'answer', text: textBlock.text, usage };
}

async function embed() {
  throw new AiProviderCapabilityError('claude has no embeddings endpoint — configure a different provider for RAG/embedding features');
}

// No image-generation endpoint (RS-AIG-025): Anthropic's Messages API has
// no first-party image-generation capability, same honest-limitation
// treatment embed() above already gets — never a silent no-op.
async function generateImage() {
  throw new AiProviderCapabilityError('claude has no image-generation endpoint — configure a different provider for this feature');
}

module.exports = {
  name: 'claude',
  supportsVision,
  isConfigured,
  complete,
  completeWithMeta,
  completeStream,
  completeWithTools,
  embed,
  generateImage,
};
