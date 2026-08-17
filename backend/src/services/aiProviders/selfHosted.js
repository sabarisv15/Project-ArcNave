'use strict';

// Self-hosted adapter — for a college running its own inference server
// (vLLM, text-generation-inference, LM Studio, etc.), all of which
// commonly expose the same OpenAI-compatible /chat/completions (and
// often /embeddings) shape nim.js already speaks. Same request/response
// handling as nim.js; the only real difference is that baseUrl has no
// built-in default here — a self-hosted deployment's URL is inherently
// college-specific, unlike a hosted vendor's fixed API endpoint, so
// isConfigured() requires it explicitly rather than falling back to
// some guessed address. apiKey is optional (many self-hosted servers
// run with no auth on a private network) — isConfigured() only
// requires baseUrl.
//
// NOT live-verified against a real self-hosted server (no such
// deployment exists in this environment) — the interface and request
// shape are real (the documented OpenAI-compatible convention every
// major self-host server implements), not a fake stub, but this
// adapter has not been exercised against a live endpoint the way
// nim.js's request shape was.

const { LlmNotConfiguredError, LlmRequestError } = require('./errors');

const REQUEST_TIMEOUT_MS = 30000;

function isConfigured(cfg) {
  return Boolean(cfg && cfg.baseUrl);
}

async function postJson(cfg, path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const headers = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;

  let response;
  try {
    response = await fetch(`${cfg.baseUrl}${path}`, {
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

async function complete(cfg, { systemPrompt, userPrompt }) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no self-hosted LLM provider is configured for this college (missing baseUrl)');
  }

  const payload = await postJson(cfg, '/chat/completions', {
    model: cfg.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,
  });

  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const answer = choice && choice.message ? choice.message.content : undefined;
  if (typeof answer !== 'string') {
    throw new LlmRequestError('self-hosted LLM provider response did not contain choices[0].message.content');
  }

  return answer;
}

async function completeWithTools(cfg, { systemPrompt, userPrompt, tools }) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no self-hosted LLM provider is configured for this college (missing baseUrl)');
  }

  const payload = await postJson(cfg, '/chat/completions', {
    model: cfg.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    tools: tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.params },
    })),
    tool_choice: 'auto',
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
    return { type: 'tool_call', toolName: fn.name, arguments: toolArguments };
  }

  if (typeof message.content !== 'string') {
    throw new LlmRequestError('self-hosted LLM provider response contained neither a tool call nor message content');
  }
  return { type: 'answer', text: message.content };
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

module.exports = {
  name: 'self_hosted',
  isConfigured,
  complete,
  completeWithTools,
  embed,
};
