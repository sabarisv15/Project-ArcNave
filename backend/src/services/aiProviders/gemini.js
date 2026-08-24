'use strict';

// Google Gemini adapter — Vertex AI (not the API-key Generative Language
// API this file used before). Auth is Application Default Credentials
// (ADC) via google-auth-library: `gcloud auth application-default
// login` for local dev, or the runtime's own service account in a real
// GCP deployment — never a static key a college admin types into a
// form. isConfigured() therefore keys off cfg.projectId, not cfg.apiKey.
// Request/response body shapes (contents/systemInstruction/
// generationConfig, candidates[].content.parts[].text) are the same
// ones Vertex AI's generateContent shares with the public Gemini API —
// only the auth header, host, and URL path differ. Real shapes per
// Google's documented REST API — NOT live-verified against a real GCP
// project (none exists in this environment).

const { GoogleAuth } = require('google-auth-library');
const { LlmNotConfiguredError, LlmRequestError, AiProviderCapabilityError } = require('./errors');
const { withRetry } = require('./retry');
const { iterateSseLines } = require('./sse');
const { flattenToPrompts } = require('../aiContextAssembly');

const REQUEST_TIMEOUT_MS = 30000;
// Overall wall-clock budget for ONE logical postJson-based call
// (completeWithMeta/completeWithTools/embed) — covers every retry
// withRetry performs for it, not just the first attempt. Without this,
// a run of transient 429/502/503/504 responses could compound
// withRetry's own MAX_ATTEMPTS=3 x a fresh REQUEST_TIMEOUT_MS each into
// ~90s+ for what the rest of this codebase treats as "one LLM call" —
// the same class of risk MAX_TOTAL_STREAM_MS below fixes for the
// streaming path, and the tool-select call this constant bounds
// (completeWithTools, askAgent's first LLM call every turn) runs inside
// the same per-request DB transaction (tenantTransaction.js) as
// whatever runs after it, so its own worst case eats into the same
// idle_in_transaction_session_timeout budget (90s, db-role-timeouts.
// test.js) the streaming call does.
const MAX_TOTAL_LATENCY_MS = 30000;
// 'global' — not a real GCP region, Vertex AI's own non-regional
// endpoint — is where Gemini 3.6/3.7 Flash actually serve from; a
// regional location like us-central1 404s for these models. Verified
// live against the real API, not assumed from docs alone.
const DEFAULT_LOCATION = 'global';
// Google's current agentic-workhorse Flash model (launched Aug 2026) —
// the default whenever a config doesn't name a specific model, same
// "sane default, never a hard requirement" treatment MAX_OUTPUT_TOKENS
// already gets below.
const DEFAULT_MODEL = 'gemini-3.7-flash';
// Gemini 3.7 Flash's own hard ceiling (Vertex rejects anything higher with
// a 400) — raised here from the previous 1024 because large consolidated
// reports (e.g. a multi-hundred-row arrear list spanning several serial
// number ranges) were hitting that cap mid-table and returning truncated
// output with no error. LOW thinkingConfig below keeps this from also
// inflating cost/latency on ordinary short replies, since thinking tokens
// are drawn from this same budget.
const MAX_OUTPUT_TOKENS = 65_536;
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
// NIM-provider removal: Gemini is now the platform default embedding
// provider too. gemini-embedding-001 natively outputs up to 3072
// dimensions but supports Vertex's documented outputDimensionality
// truncation (Matryoshka representation learning) — requested below to
// match the ai_document_chunks/ai_tool_embeddings vector(1024) columns'
// existing fixed size, so no new migration is needed. Changing this
// value requires either a new migration or re-embedding every row under
// the new dimension.
const EMBEDDING_DIMENSIONS = 1024;

// Gemini 3.x's hybrid reasoning defaults to a HIGH thinking level for
// Flash models — real live cost caught it: a tool-result-summarization
// call spent 407 "thinking" tokens reasoning about a rendering task
// that needs none, and in one production case (a longer prompt) it
// spent the ENTIRE MAX_OUTPUT_TOKENS budget thinking and emitted zero
// visible answer text before hitting STOP — a silent empty "success"
// (see completeStream's own comment on why that's now impossible).
// LOW (not MINIMAL — Vertex rejects THINKING_LEVEL_MINIMAL for this
// model with a 400, caught live) cut that same call's thinking tokens
// from 407 to 171 while still answering correctly. None of this app's
// calls (tool selection, tool-result phrasing, direct chat) are the
// kind of deep multi-step reasoning task a higher level exists for.
const GENERATION_CONFIG = { maxOutputTokens: MAX_OUTPUT_TOKENS, thinkingConfig: { thinkingLevel: 'LOW' } };

const supportsVision = true;

function isConfigured(cfg) {
  return Boolean(cfg && cfg.projectId);
}

function location(cfg) {
  return cfg.location || DEFAULT_LOCATION;
}

function model(cfg) {
  return cfg.model || DEFAULT_MODEL;
}

// Vertex AI's publisher-model base path — every generateContent/
// streamGenerateContent/predict call below is this plus :verb. The
// 'global' location is a genuine exception to Vertex's usual
// per-region-subdomain host pattern: it lives on the plain
// aiplatform.googleapis.com host, not global-aiplatform.googleapis.com
// (that subdomain doesn't exist — 404s, caught live against the real
// API), while every real region (us-central1, europe-west4, ...) does
// get its own `{region}-aiplatform.googleapis.com` host.
function modelUrl(cfg, modelId, verb) {
  const loc = location(cfg);
  const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${cfg.projectId}/locations/${loc}/publishers/google/models/${modelId}:${verb}`;
}

// One GoogleAuth instance reused across calls — it caches the minted
// access token internally (and refreshes it once it's near expiry), so
// this isn't a fresh ADC handshake on every request.
let sharedAuth = null;
function getAuth() {
  if (!sharedAuth) {
    sharedAuth = new GoogleAuth({ scopes: CLOUD_PLATFORM_SCOPE });
  }
  return sharedAuth;
}

// cfg.accessToken is a direct bearer-token override — the escape hatch
// tests use to avoid touching real ADC (this repo's Docker image is
// Node 20, too old for node:test's module-mocking), and a legitimate
// path for a caller that already minted a short-lived token itself.
// The real, default path is ADC via GoogleAuth.
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

// Builds the user turn's `parts` array — text only when no images are
// attached (unchanged shape every existing caller/test expects), or
// Gemini's real inline_data image-part shape (images first, text last)
// when images are present.
function buildUserParts(userPrompt, images) {
  if (!images || images.length === 0) {
    return [{ text: userPrompt }];
  }
  return [
    ...images.map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.base64 } })),
    { text: userPrompt },
  ];
}

async function postJson(cfg, url, body) {
  const token = await getAccessToken(cfg);
  // cfg.maxTotalLatencyMs: test-only override, same escape-hatch
  // precedent as cfg.accessToken above (avoids waiting out the real
  // 30s budget just to prove the deadline mechanism itself works).
  const deadline = Date.now() + (cfg.maxTotalLatencyMs || MAX_TOTAL_LATENCY_MS);
  const response = await withRetry(async () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new LlmRequestError('Gemini (Vertex AI) request exceeded its overall time budget before a response was received');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, remaining));
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new LlmRequestError(`request to Gemini (Vertex AI) failed: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new LlmRequestError(`Gemini (Vertex AI) returned ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  try {
    return await response.json();
  } catch (err) {
    throw new LlmRequestError(`Gemini (Vertex AI) returned a non-JSON response: ${err.message}`);
  }
}

// Token/cost telemetry (P1.1) — see openai.js's own comment for the
// shared reasoning. Gemini's usage block is `usageMetadata`
// (promptTokenCount/candidatesTokenCount), a different field name and
// shape from every other adapter's `usage` — a real vendor difference,
// not an inconsistency in this codebase.
async function completeWithMeta(cfg, arcnaveContext) {
  const { systemPrompt, userPrompt, images } = flattenToPrompts(arcnaveContext);
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing projectId)');
  }

  const payload = await postJson(cfg, modelUrl(cfg, model(cfg), 'generateContent'), {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: buildUserParts(userPrompt, images) }],
    generationConfig: GENERATION_CONFIG,
  });

  const parts = payload && payload.candidates && payload.candidates[0]
    && payload.candidates[0].content && payload.candidates[0].content.parts;
  const text = Array.isArray(parts) ? parts.map((p) => p.text).filter(Boolean).join('') : undefined;
  if (typeof text !== 'string' || text.length === 0) {
    throw new LlmRequestError('Gemini response did not contain candidates[0].content.parts[].text');
  }

  const usage = payload && payload.usageMetadata
    ? { inputTokens: payload.usageMetadata.promptTokenCount, outputTokens: payload.usageMetadata.candidatesTokenCount }
    : undefined;
  return { text, usage };
}

async function complete(cfg, prompts) {
  const { text } = await completeWithMeta(cfg, prompts);
  return text;
}

// One streamGenerateContent HTTP call. Calls onDelta inline, per SSE
// chunk, as soon as real text arrives — not buffered into one big
// string and released at the end (that made every Gemini/Vertex answer
// arrive as a single paste instead of a smooth stream, unlike the
// OpenAI/Claude adapters' own inline onDelta calls). This stays safe
// against completeStream's own empty-attempt retry below: retry only
// ever fires for an attempt that produced ZERO non-empty chunks (see
// that constant's own comment on Gemini's "thinking budget exhausted"
// failure mode), and this function's first non-empty chunk is the
// exact moment that can no longer be true for the CURRENT attempt — so
// nothing streamed here is ever later discarded/retried out from under
// the caller; an attempt is only ever retried before its first real
// chunk, never after.
async function attemptStream(cfg, arcnaveContext, deadline, onDelta) {
  const { systemPrompt, userPrompt, images } = flattenToPrompts(arcnaveContext);
  const token = await getAccessToken(cfg);
  const response = await withRetry(async () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new LlmRequestError('Gemini (Vertex AI) request exceeded its overall time budget before a response was received');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, remaining));
    try {
      return await fetch(`${modelUrl(cfg, model(cfg), 'streamGenerateContent')}?alt=sse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: buildUserParts(userPrompt, images) }],
          generationConfig: GENERATION_CONFIG,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new LlmRequestError(`request to Gemini (Vertex AI) failed: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new LlmRequestError(`Gemini (Vertex AI) returned ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  let full = '';
  let sawAnyText = false;
  let usage;
  for await (const payload of iterateSseLines(response)) {
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      continue;
    }
    const parts = event && event.candidates && event.candidates[0]
      && event.candidates[0].content && event.candidates[0].content.parts;
    const text = Array.isArray(parts) ? parts.map((p) => p.text).filter(Boolean).join('') : '';
    if (text.length > 0) {
      sawAnyText = true;
      full += text;
      onDelta(text);
    }
    // usageMetadata rides along on each chunk, cumulative — the last one
    // seen (the final chunk before the stream ends) is the real total,
    // same as completeWithMeta's own non-streaming usage read.
    if (event && event.usageMetadata) {
      usage = { inputTokens: event.usageMetadata.promptTokenCount, outputTokens: event.usageMetadata.candidatesTokenCount };
    }
  }
  return { full, sawAnyText, usage };
}

// A real, live-caught failure mode: Gemini's hybrid reasoning can spend
// its ENTIRE token budget "thinking" (a final SSE chunk with `parts:
// [{ text: "", thoughtSignature: "..." }]`, finishReason STOP) and
// stream zero visible text — an HTTP 200 with a well-formed SSE body,
// no error to catch, yet nothing was ever said. Confirmed live to be
// genuinely non-deterministic — the identical request/config can
// succeed or empty-out from one call to the next (LLM sampling
// variance, not a fixed prompt-size cliff) — so unlike a 4xx/5xx this
// is worth an automatic regeneration, not just surfacing the error:
// MAX_EMPTY_RETRIES extra full attempts (fresh HTTP call each time, not
// a resend of the same dead response) before finally giving up.
const MAX_EMPTY_RETRIES = 2;

// Overall wall-clock budget for the WHOLE completeStream operation —
// every attempt (up to MAX_EMPTY_RETRIES+1) and every retry withRetry
// performs inside each one, combined. Live-reproduced root cause of a
// real incident: 3 empty-thinking-budget attempts x withRetry's own up
// to 3 sub-attempts x a fresh REQUEST_TIMEOUT_MS each could compound
// past idle_in_transaction_session_timeout (90s, db-role-timeouts.
// test.js) — Postgres killed the per-request transaction's checked-out
// client mid-call, which (before a separate fix to tenantTransaction.js)
// crashed the whole backend process for every tenant, not just the one
// slow request. This bounds the same call to well under that, regardless
// of how many nested retries happen at either level — MAX_EMPTY_RETRIES
// itself is left unchanged (still worth a couple of fast, genuinely
// non-deterministic regeneration attempts, per this constant's own
// comment above) since this deadline, not the retry count, is the real
// safety backstop against the slow/hanging case.
const MAX_TOTAL_STREAM_MS = 45000;

// Streaming variant of complete() (P0.5) — see openai.js's own comment
// for the shared reasoning (only the final answer streams). Vertex
// AI's streaming path is the same `:streamGenerateContent?alt=sse`
// shape the public Gemini API uses — only the host/auth above differ.
// onUsage (optional, P1.6) — called at most once, with whichever
// attempt actually succeeded (sawAnyText) reported it. A discarded
// empty-thinking-budget attempt's usage (if any) is never reported —
// it described tokens spent on an answer the caller never saw.
async function completeStream(cfg, prompts, onDelta, onUsage) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing projectId)');
  }

  // cfg.maxTotalStreamMs: test-only override, same escape-hatch
  // precedent as cfg.accessToken/postJson's cfg.maxTotalLatencyMs above.
  const deadline = Date.now() + (cfg.maxTotalStreamMs || MAX_TOTAL_STREAM_MS);
  for (let attempt = 0; attempt <= MAX_EMPTY_RETRIES; attempt++) {
    if (Date.now() >= deadline) break;
    // eslint-disable-next-line no-await-in-loop
    const { full, sawAnyText, usage } = await attemptStream(cfg, prompts, deadline, onDelta);
    if (sawAnyText) {
      if (typeof onUsage === 'function' && usage) onUsage(usage);
      return full;
    }
  }
  throw new LlmRequestError(`Gemini streamed no visible answer text within ${cfg.maxTotalStreamMs || MAX_TOTAL_STREAM_MS}ms (thinking budget exhausted before any output, or the overall time budget was exceeded)`);
}

// Gemini's function-calling `parameters` field is a restricted OpenAPI
// 3.0 Schema subset, not full JSON Schema — `additionalProperties` is
// real JSON Schema (every tool in aiToolRegistry.js sets it) but
// Gemini's API rejects it outright ("Unknown name 'additionalProperties'
// ... Cannot find field"), a real 400 caught live against the actual
// endpoint, not a guessed vendor limitation. Stripped recursively (not
// just at the top level) since a tool's params can nest an object
// schema inside `properties`/`items`. Claude/OpenAI's own tool schemas
// accept `additionalProperties` unchanged — this sanitization is
// Gemini-adapter-local, not a change to the shared tool registry.
function stripAdditionalProperties(schema) {
  if (Array.isArray(schema)) {
    return schema.map(stripAdditionalProperties);
  }
  if (schema && typeof schema === 'object') {
    const { additionalProperties, ...rest } = schema;
    const cleaned = {};
    for (const [key, value] of Object.entries(rest)) {
      cleaned[key] = stripAdditionalProperties(value);
    }
    return cleaned;
  }
  return schema;
}

// ADR-030 P2(c) — appends one {model:functionCall} + {user:functionResponse}
// turn pair per prior tool execution, AFTER the unchanged base user turn
// built above. This is the only thing priorTurns changes: the base
// systemInstruction/first-user-turn construction above is byte-identical
// whether or not priorTurns is empty (regression-locked by
// ai-providers.test.js), satisfying ADL-050's constraint that the
// governance-bearing system content never gets re-split/re-packaged
// across a tool-use loop's iterations. No callId needed — Gemini matches
// functionResponse to functionCall by name/order, not by an explicit id.
function buildPriorTurnContents(priorTurns) {
  return priorTurns.flatMap((turn) => [
    // Prefer the verbatim part Gemini itself returned (turn.rawToolCall) —
    // required live: it carries the thoughtSignature field a
    // reconstructed {functionCall:{name,args}} part never has, and
    // Vertex's real API 400s on a multi-turn request replaying a
    // functionCall part without one, with thinking enabled. See
    // completeWithTools' own comment on functionCallPart above.
    { role: 'model', parts: [turn.rawToolCall || { functionCall: { name: turn.toolName, args: turn.arguments || {} } }] },
    { role: 'user', parts: [{ functionResponse: { name: turn.toolName, response: { content: turn.resultText } } }] },
  ]);
}

async function completeWithTools(cfg, arcnaveContext, priorTurns = []) {
  const {
    systemPrompt, userPrompt, tools, images,
  } = flattenToPrompts(arcnaveContext);
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing projectId)');
  }

  const payload = await postJson(cfg, modelUrl(cfg, model(cfg), 'generateContent'), {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [
      { role: 'user', parts: buildUserParts(userPrompt, images) },
      ...buildPriorTurnContents(priorTurns),
    ],
    tools: [{
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: stripAdditionalProperties(tool.params),
      })),
    }],
    generationConfig: GENERATION_CONFIG,
  });

  const parts = payload && payload.candidates && payload.candidates[0]
    && payload.candidates[0].content && payload.candidates[0].content.parts;
  if (!Array.isArray(parts)) {
    throw new LlmRequestError('Gemini response did not contain candidates[0].content.parts');
  }

  const functionCallPart = parts.find((p) => p.functionCall);
  if (functionCallPart) {
    // ADR-030 P0 telemetry: a tool_call response's own usageMetadata is
    // just as real a request cost as an 'answer' response's — previously
    // dropped here, which meant every genuine tool-use turn's decision
    // call was invisible to logLlmCall (see aiService.js's own comment on
    // decision.usage), the exact turn shape the review found most
    // expensive.
    const usage = payload && payload.usageMetadata
      ? { inputTokens: payload.usageMetadata.promptTokenCount, outputTokens: payload.usageMetadata.candidatesTokenCount }
      : undefined;
    // rawToolCall carries the ENTIRE part as Gemini returned it — not
    // just {name, args} — because with thinking enabled (GENERATION_
    // CONFIG's thinkingLevel above) Vertex's real API attaches a sibling
    // `thoughtSignature` field to this same part and REJECTS a later
    // multi-turn request that replays this functionCall without it: a
    // real 400 ("Function call is missing a thought_signature..."),
    // caught live against the actual endpoint the first time ADR-030
    // P2(c)'s tool-use loop ran a genuine 2-tool live scenario — invisible
    // to any mocked-fetch unit test, since a hand-built mock response
    // never carries a field the test author didn't think to add.
    // buildPriorTurnContents below replays this whole part verbatim on a
    // continuation call, never reconstructing {functionCall:{name,args}}
    // alone when the original part is available.
    return {
      type: 'tool_call', toolName: functionCallPart.functionCall.name, arguments: functionCallPart.functionCall.args || {}, rawToolCall: functionCallPart, usage,
    };
  }

  const text = parts.map((p) => p.text).filter(Boolean).join('');
  if (!text) {
    throw new LlmRequestError('Gemini response contained neither a function call nor text');
  }
  const usage = payload && payload.usageMetadata
    ? { inputTokens: payload.usageMetadata.promptTokenCount, outputTokens: payload.usageMetadata.candidatesTokenCount }
    : undefined;
  return { type: 'answer', text, usage };
}

async function embed(cfg, texts, { inputType } = {}) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing projectId)');
  }
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new LlmRequestError('embed() requires a non-empty array of texts');
  }
  if (!cfg.embeddingModel) {
    throw new LlmRequestError('embed() requires cfg.embeddingModel (Vertex AI has no embedding default — e.g. gemini-embedding-001)');
  }

  // Vertex AI's embeddings endpoint is a `:predict` call (Vertex's
  // generic prediction shape — instances[]/predictions[]), a genuinely
  // different request/response shape from the public Gemini API's
  // embedContent/batchEmbedContents this adapter used before, not just
  // a details difference.
  const taskType = inputType === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';
  const payload = await postJson(cfg, modelUrl(cfg, cfg.embeddingModel, 'predict'), {
    instances: texts.map((content) => ({ content, task_type: taskType })),
    parameters: { outputDimensionality: EMBEDDING_DIMENSIONS },
  });

  const predictions = Array.isArray(payload && payload.predictions) ? payload.predictions : null;
  if (!predictions || predictions.length !== texts.length) {
    throw new LlmRequestError('Gemini (Vertex AI) embeddings response did not contain one prediction per input text');
  }

  return predictions.map((item) => item && item.embeddings && item.embeddings.values);
}

// Image generation (RS-AIG-025) — Vertex AI's Imagen `:predict` endpoint,
// the same `instances[]`/`predictions[]` shape embed() above already
// uses for this vendor's non-generateContent models. NOT live-verified
// against a real GCP project (same caveat this file's own header comment
// already carries) — the request/response shape is Google's documented
// Imagen-on-Vertex REST convention, not fabricated. `cfg.imageModel`
// lets a college override the model id; Imagen is a separate publisher
// model from whatever `cfg.model` names for chat, so this never reuses
// that field.
const DEFAULT_IMAGE_MODEL = 'imagen-4.0-generate-001';

async function generateImage(cfg, { prompt }) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing projectId)');
  }
  const payload = await postJson(cfg, modelUrl(cfg, cfg.imageModel || DEFAULT_IMAGE_MODEL, 'predict'), {
    instances: [{ prompt }],
    parameters: { sampleCount: 1 },
  });
  const prediction = Array.isArray(payload && payload.predictions) ? payload.predictions[0] : null;
  const b64 = prediction && prediction.bytesBase64Encoded;
  if (!b64) {
    throw new LlmRequestError('Gemini (Vertex AI) image response did not contain predictions[0].bytesBase64Encoded');
  }
  const mimeType = (prediction && prediction.mimeType) || 'image/png';
  return { imageBuffer: Buffer.from(b64, 'base64'), mimeType };
}

module.exports = {
  name: 'gemini',
  EMBEDDING_DIMENSIONS,
  supportsVision,
  isConfigured,
  complete,
  completeWithMeta,
  completeStream,
  completeWithTools,
  embed,
  generateImage,
  AiProviderCapabilityError,
};
