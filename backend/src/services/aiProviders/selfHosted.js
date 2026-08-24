'use strict';

// Self-hosted adapter — for a college running its own inference server
// (vLLM, text-generation-inference, LM Studio, etc.), all of which
// commonly expose the same OpenAI-compatible /chat/completions (and
// often /embeddings) shape openai.js already speaks. Same request/
// response handling as openai.js; the only real difference is that
// baseUrl has no built-in default here — a self-hosted deployment's URL
// is inherently college-specific, unlike a hosted vendor's fixed API
// endpoint, so isConfigured() requires it explicitly rather than
// falling back to some guessed address. apiKey is optional (many
// self-hosted servers run with no auth on a private network) —
// isConfigured() only requires baseUrl.
//
// NOT live-verified against a real self-hosted server (no such
// deployment exists in this environment) — the interface and request
// shape are real (the documented OpenAI-compatible convention every
// major self-host server implements), not a fake stub, but this
// adapter has not been exercised against a live endpoint.

const { LlmNotConfiguredError, LlmRequestError, AiProviderCapabilityError } = require('./errors');
const { withRetry } = require('./retry');
const { iterateSseLines } = require('./sse');
const { flattenToPrompts } = require('../aiContextAssembly');

const REQUEST_TIMEOUT_MS = 30000;
// Matches claude.js's own MAX_TOKENS — this adapter previously sent no
// max_tokens at all, so output length was fully unbounded (relying
// entirely on the self-hosted server's own default) with no cost
// ceiling this codebase controlled.
const MAX_TOKENS = 1024;

// A self-hosted deployment's model is whatever the college's own
// operator configured — no vision-capable convention is assumed here,
// since there's no fixed vendor to make that guarantee.
const supportsVision = false;

function isConfigured(cfg) {
  return Boolean(cfg && cfg.baseUrl);
}

async function postJson(cfg, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;

  const response = await withRetry(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${cfg.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new LlmRequestError(`request to self-hosted LLM provider failed: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new LlmRequestError(`self-hosted LLM provider returned ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  try {
    return await response.json();
  } catch (err) {
    throw new LlmRequestError(`self-hosted LLM provider returned a non-JSON response: ${err.message}`);
  }
}

// Token/cost telemetry (P1.1) — see openai.js's own comment; same
// shape, same OpenAI-compatible `usage` block.
async function completeWithMeta(cfg, arcnaveContext) {
  const { systemPrompt, userPrompt } = flattenToPrompts(arcnaveContext);
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no self-hosted LLM provider is configured for this college (missing baseUrl)');
  }

  const payload = await postJson(cfg, '/chat/completions', {
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
    throw new LlmRequestError('self-hosted LLM provider response did not contain choices[0].message.content');
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

// Streaming variant of complete() (P0.5) — see openai.js's own comment
// for the shared reasoning (only the final answer streams, retries
// only cover the initial connection). Same OpenAI-compatible SSE shape
// openai.js speaks, since a self-hosted deployment is defined as
// implementing that same convention.
// onUsage (optional, P1.6) — see openai.js's own comment for the shared
// OpenAI-compatible `stream_options.include_usage` reasoning. Not
// exercised against a live self-hosted endpoint (same caveat this
// adapter's own header comment already carries) — a deployment that
// ignores the unrecognized `stream_options` field simply never calls
// onUsage, degrading to "no usage known" rather than an error.
async function completeStream(cfg, arcnaveContext, onDelta, onUsage) {
  const { systemPrompt, userPrompt } = flattenToPrompts(arcnaveContext);
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no self-hosted LLM provider is configured for this college (missing baseUrl)');
  }

  const headers = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;

  const response = await withRetry(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: MAX_TOKENS,
          temperature: 0.2,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new LlmRequestError(`request to self-hosted LLM provider failed: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new LlmRequestError(`self-hosted LLM provider returned ${response.status}: ${bodyText.slice(0, 500)}`);
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

// ADR-030 P2(c) — same OpenAI-compatible continuation shape openai.js's
// own buildPriorTurnMessages uses (this adapter targets the same wire
// convention). See that file's comment for the rawToolCall-preference
// reasoning.
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
  const { systemPrompt, userPrompt, tools } = flattenToPrompts(arcnaveContext);
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no self-hosted LLM provider is configured for this college (missing baseUrl)');
  }

  const payload = await postJson(cfg, '/chat/completions', {
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
    throw new LlmRequestError('self-hosted LLM provider response did not contain choices[0].message');
  }

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (toolCalls.length > 0) {
    const fn = toolCalls[0].function || {};
    let toolArguments;
    try {
      toolArguments = fn.arguments ? JSON.parse(fn.arguments) : {};
    } catch (err) {
      throw new LlmRequestError(`self-hosted LLM tool call arguments were not valid JSON: ${err.message}`);
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
    throw new LlmRequestError('self-hosted LLM provider response contained neither a tool call nor message content');
  }
  const usage = payload && payload.usage
    ? { inputTokens: payload.usage.prompt_tokens, outputTokens: payload.usage.completion_tokens }
    : undefined;
  return { type: 'answer', text: message.content, usage };
}

async function embed(cfg, texts, { inputType } = {}) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no self-hosted LLM provider is configured for this college (missing baseUrl)');
  }
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new LlmRequestError('embed() requires a non-empty array of texts');
  }

  const payload = await postJson(cfg, '/embeddings', {
    model: cfg.embeddingModel,
    input: texts,
    input_type: inputType,
  });

  const data = Array.isArray(payload && payload.data) ? payload.data : null;
  if (!data || data.length !== texts.length) {
    throw new LlmRequestError('self-hosted embeddings provider response did not contain one embedding per input text');
  }

  return data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

// No image-generation endpoint by default (RS-AIG-025): a self-hosted
// OpenAI-compatible chat endpoint has no standard image-generation
// convention this codebase can assume — honest limitation, same
// AiProviderCapabilityError shape claude.js's own missing embed() uses.
async function generateImage() {
  throw new AiProviderCapabilityError('this self-hosted provider has no image-generation endpoint configured — configure a different provider for this feature');
}

module.exports = {
  name: 'self_hosted',
  supportsVision,
  isConfigured,
  complete,
  completeWithMeta,
  completeStream,
  completeWithTools,
  embed,
  generateImage,
};
