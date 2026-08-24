'use strict';

// OpenAI adapter (Chat Completions API). OpenAI's own API IS the
// OpenAI-compatible convention selfHosted.js also speaks — the two
// share the same request/response shape, this one pointed at the real
// vendor endpoint with a required apiKey (like claude.js) instead of a
// college-supplied baseUrl.
//
// NOT live-verified against a real OpenAI API key (none exists in this
// environment) — the shape is the documented OpenAI Chat Completions/
// Embeddings convention, not fabricated, but this hasn't been
// exercised against a live endpoint.
//
// Vision (P0-of-this-pass): supportsVision is exported explicitly so
// aiService checks a capability flag, never a hardcoded provider-name
// string — see completeWithImages' own comment for the real OpenAI
// image_url content-block shape this adapter builds when images are
// present.

const { LlmNotConfiguredError, LlmRequestError } = require('./errors');
const { withRetry } = require('./retry');
const { iterateSseLines } = require('./sse');
const { flattenToPrompts } = require('../aiContextAssembly');

const REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
// Matches every other adapter's own MAX_TOKENS — an explicit cost
// ceiling this codebase controls, never left to the vendor's default.
const MAX_TOKENS = 1024;

const supportsVision = true;

function isConfigured(cfg) {
  return Boolean(cfg && cfg.apiKey);
}

function baseUrl(cfg) {
  return cfg.baseUrl || DEFAULT_BASE_URL;
}

async function postJson(cfg, path, body) {
  const response = await withRetry(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${baseUrl(cfg)}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new LlmRequestError(`request to OpenAI failed: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new LlmRequestError(`OpenAI returned ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  try {
    return await response.json();
  } catch (err) {
    throw new LlmRequestError(`OpenAI returned a non-JSON response: ${err.message}`);
  }
}

// Builds the user message's `content` — a plain string when no images
// are attached (unchanged shape every existing caller/test expects),
// or OpenAI's real multipart vision shape (an array of {type:'text'}/
// {type:'image_url'} blocks) when images are present. Real OpenAI
// vision convention: a base64 image is passed as a data: URI inside
// image_url.url, not a separate top-level field.
function buildUserContent(userPrompt, images) {
  if (!images || images.length === 0) {
    return userPrompt;
  }
  return [
    { type: 'text', text: userPrompt },
    ...images.map((img) => ({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
    })),
  ];
}

// Token/cost telemetry (P1.1) — complete() itself stays byte-for-byte
// unchanged (every existing caller/test expects a plain string back);
// completeWithMeta is the one place that also reads the raw response's
// own `usage` block, so aiService's completeMaybeStreaming can log real
// token counts without any adapter needing a second request shape.
// Same OpenAI-compatible `usage` block (prompt_tokens/completion_tokens)
// selfHosted.js also reads, since it targets the same vendor convention.
async function completeWithMeta(cfg, arcnaveContext) {
  const { systemPrompt, userPrompt, images } = flattenToPrompts(arcnaveContext);
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing apiKey)');
  }

  const payload = await postJson(cfg, '/chat/completions', {
    model: cfg.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildUserContent(userPrompt, images) },
    ],
    max_tokens: MAX_TOKENS,
    temperature: 0.2,
  });

  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const answer = choice && choice.message ? choice.message.content : undefined;
  if (typeof answer !== 'string') {
    throw new LlmRequestError('OpenAI response did not contain choices[0].message.content');
  }

  const usage = payload && payload.usage
    ? { inputTokens: payload.usage.prompt_tokens, outputTokens: payload.usage.completion_tokens }
    : undefined;
  return { text: answer, usage };
}

async function complete(cfg, prompts) {
  const { text } = await completeWithMeta(cfg, prompts);
  return text;
}

// Streaming variant of complete() (P0.5) — only for the final natural-
// language answer, never the tool-select call (that needs the whole
// structured decision before anything downstream can run, so there is
// nothing meaningful to stream). `onDelta` is called once per text
// chunk as it arrives; the full concatenated text is still returned at
// the end so a caller that doesn't care about incremental output can
// treat this exactly like complete(). Retries (withRetry) only ever
// apply to the initial connection attempt, before any chunk has been
// read — once streaming starts, a transient failure surfaces as
// whatever's already been streamed plus a thrown error, never a silent
// retry after partial output already reached the caller. Same
// OpenAI-compatible SSE shape selfHosted.js speaks, since it targets
// the same vendor convention.
// onUsage (optional, P1.6) — called at most once, after the stream ends,
// with {inputTokens, outputTokens}, only if the API actually returned a
// usage block. `stream_options.include_usage: true` asks the server to
// emit one extra final chunk carrying a top-level `usage` and an empty
// `choices` array, just before `[DONE]` — every other chunk's `usage`
// is absent, so the last one seen wins.
async function completeStream(cfg, arcnaveContext, onDelta, onUsage) {
  const { systemPrompt, userPrompt, images } = flattenToPrompts(arcnaveContext);
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing apiKey)');
  }

  const response = await withRetry(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${baseUrl(cfg)}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: buildUserContent(userPrompt, images) },
          ],
          max_tokens: MAX_TOKENS,
          temperature: 0.2,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new LlmRequestError(`request to OpenAI failed: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new LlmRequestError(`OpenAI returned ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  let full = '';
  let usage;
  for await (const payload of iterateSseLines(response)) {
    if (payload === '[DONE]') break;
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      continue;
    }
    const delta = event && event.choices && event.choices[0] && event.choices[0].delta && event.choices[0].delta.content;
    if (typeof delta === 'string' && delta.length > 0) {
      full += delta;
      onDelta(delta);
    }
    if (event && event.usage) {
      usage = { inputTokens: event.usage.prompt_tokens, outputTokens: event.usage.completion_tokens };
    }
  }
  if (typeof onUsage === 'function' && usage) {
    onUsage(usage);
  }
  return full;
}

// ADR-030 P2(c) — one {assistant:tool_calls} + {tool:result} message pair
// per prior tool execution, appended AFTER the unchanged base system+user
// messages. Prefers turn.rawToolCall (the literal tool_calls[0] entry
// OpenAI itself returned, when the caller kept it) over reconstructing
// {id, type:'function', function:{name, arguments}} from the parsed
// arguments object — JSON.stringify(parsedArguments) isn't guaranteed to
// reproduce the model's original argument-string formatting/key order.
// Same shape selfHosted.js's OpenAI-compatible continuation uses.
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

async function completeWithTools(cfg, arcnaveContext, priorTurns = []) {
  const {
    systemPrompt, userPrompt, tools, images,
  } = flattenToPrompts(arcnaveContext);
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing apiKey)');
  }

  const payload = await postJson(cfg, '/chat/completions', {
    model: cfg.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildUserContent(userPrompt, images) },
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
    throw new LlmRequestError('OpenAI response did not contain choices[0].message');
  }

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (toolCalls.length > 0) {
    const fn = toolCalls[0].function || {};
    let toolArguments;
    try {
      toolArguments = fn.arguments ? JSON.parse(fn.arguments) : {};
    } catch (err) {
      throw new LlmRequestError(`OpenAI tool call arguments were not valid JSON: ${err.message}`);
    }
    // ADR-030 P0 telemetry — see gemini.js's own equivalent comment.
    const usage = payload && payload.usage
      ? { inputTokens: payload.usage.prompt_tokens, outputTokens: payload.usage.completion_tokens }
      : undefined;
    return {
      type: 'tool_call', toolName: fn.name, arguments: toolArguments, callId: toolCalls[0].id, rawToolCall: toolCalls[0], usage,
    };
  }

  if (typeof message.content !== 'string') {
    throw new LlmRequestError('OpenAI response contained neither a tool call nor message content');
  }
  const usage = payload && payload.usage
    ? { inputTokens: payload.usage.prompt_tokens, outputTokens: payload.usage.completion_tokens }
    : undefined;
  return { type: 'answer', text: message.content, usage };
}

// OpenAI's real embeddings endpoint has no input_type/asymmetric
// query-vs-passage concept (unlike nim.js's strict requirement) — same
// permissive shape as selfHosted.embed(), not fabricated leniency.
async function embed(cfg, texts) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing apiKey)');
  }
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new LlmRequestError('embed() requires a non-empty array of texts');
  }

  const payload = await postJson(cfg, '/embeddings', {
    model: cfg.embeddingModel,
    input: texts,
  });

  const data = Array.isArray(payload && payload.data) ? payload.data : null;
  if (!data || data.length !== texts.length) {
    throw new LlmRequestError('OpenAI embeddings response did not contain one embedding per input text');
  }

  return data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

// Image generation (RS-AIG-025) — OpenAI's real Images API
// (/v1/images/generations, documented `response_format: 'b64_json'`
// convention). NOT live-verified against a real OpenAI API key (same
// caveat this file's own header comment already carries for chat) — the
// request/response shape is the documented convention, not fabricated.
// Always PNG per this endpoint's own documented output format.
const IMAGE_MODEL = 'gpt-image-1';

async function generateImage(cfg, { prompt }) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing apiKey)');
  }
  const payload = await postJson(cfg, '/images/generations', {
    model: cfg.imageModel || IMAGE_MODEL,
    prompt,
    n: 1,
    size: '1024x1024',
  });
  const item = payload && Array.isArray(payload.data) ? payload.data[0] : null;
  const b64 = item && (item.b64_json || item.b64Json);
  if (!b64) {
    throw new LlmRequestError('OpenAI image response did not contain data[0].b64_json');
  }
  return { imageBuffer: Buffer.from(b64, 'base64'), mimeType: 'image/png' };
}

module.exports = {
  name: 'openai',
  supportsVision,
  isConfigured,
  generateImage,
  complete,
  completeWithMeta,
  completeStream,
  completeWithTools,
  embed,
};
