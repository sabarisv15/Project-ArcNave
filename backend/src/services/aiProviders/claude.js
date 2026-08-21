'use strict';

// Anthropic Claude adapter (Messages API). Real request/response
// shapes per Anthropic's documented REST API — NOT live-verified
// against a real Claude API key (none exists in this environment); the
// shape is real, not fabricated, but unlike nim.js this hasn't been
// exercised against a live endpoint.
//
// No embed(): Anthropic has no first-party embeddings endpoint. This
// is a real, structural limitation of the vendor, not something this
// adapter chose to skip — it throws AiProviderCapabilityError loudly
// rather than silently returning a fake vector, so a college that
// picks 'claude' as its provider and then tries to use a RAG/search
// feature gets a clear error naming the actual cause, not a wrong
// answer.

const { LlmNotConfiguredError, LlmRequestError, AiProviderCapabilityError } = require('./errors');
const { withRetry } = require('./retry');
const { iterateSseLines } = require('./sse');

const REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 1024;

const supportsVision = true;

function isConfigured(cfg) {
  return Boolean(cfg && cfg.apiKey);
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

async function postJson(cfg, path, body) {
  const response = await withRetry(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${baseUrl(cfg)}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': cfg.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          // Prompt caching (P1.2) — additive/harmless on any request
          // that doesn't use cache_control (Anthropic ignores it), so
          // this is set unconditionally rather than only on the one
          // call site that actually adds a cache_control breakpoint
          // (completeWithTools).
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new LlmRequestError(`request to Claude failed: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  });

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

// Token/cost telemetry (P1.1) — see nim.js's own comment for the shared
// reasoning. Claude's usage block uses input_tokens/output_tokens, not
// the OpenAI-compatible prompt_tokens/completion_tokens naming.
async function completeWithMeta(cfg, { systemPrompt, userPrompt, images } = {}) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing apiKey)');
  }

  const payload = await postJson(cfg, '/v1/messages', {
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

// Streaming variant of complete() (P0.5) — see nim.js's own comment
// for the shared reasoning (only the final answer streams, retries
// only cover the initial connection). Anthropic's Messages API SSE
// sends several named event types (message_start, content_block_start/
// delta/stop, message_delta, message_stop) — iterateSseLines only
// yields `data:` lines (the `event:` line is redundant with the JSON
// payload's own `type` field, so nothing here needs it), so only
// `content_block_delta` events with a `text_delta` are real answer
// text; every other event type is legitimately ignored, not an error.
async function completeStream(cfg, { systemPrompt, userPrompt, images } = {}, onDelta) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing apiKey)');
  }

  const response = await withRetry(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${baseUrl(cfg)}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': cfg.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          // Prompt caching (P1.2) — additive/harmless on any request
          // that doesn't use cache_control (Anthropic ignores it), so
          // this is set unconditionally rather than only on the one
          // call site that actually adds a cache_control breakpoint
          // (completeWithTools).
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: MAX_TOKENS,
          system: systemPrompt,
          messages: [{ role: 'user', content: buildUserContent(userPrompt, images) }],
          stream: true,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new LlmRequestError(`request to Claude failed: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new LlmRequestError(`Claude returned ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  let full = '';
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
    }
  }
  return full;
}

async function completeWithTools(cfg, { systemPrompt, userPrompt, tools, images } = {}) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing apiKey)');
  }

  const payload = await postJson(cfg, '/v1/messages', {
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
    return { type: 'tool_call', toolName: toolUse.name, arguments: toolUse.input || {} };
  }

  const textBlock = blocks.find((b) => b.type === 'text');
  if (!textBlock) {
    throw new LlmRequestError('Claude response contained neither a tool_use block nor a text block');
  }
  return { type: 'answer', text: textBlock.text };
}

async function embed() {
  throw new AiProviderCapabilityError('claude has no embeddings endpoint — configure a different provider for RAG/embedding features');
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
};
