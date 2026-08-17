'use strict';

// NVIDIA NIM adapter — an OpenAI-compatible /chat/completions +
// /embeddings API. This is the exact logic services/llmProvider.js
// used to own directly against the global config.nim.*; moved here
// unchanged except that every value it needs (apiKey, baseUrl, model,
// embeddingModel) now comes from the `cfg` argument each function
// takes, so the same code serves both a per-college row and the
// global-default fallback (ConfigurationService.getAiConfig builds
// `cfg` from config.nim.* when no college_ai_config row exists).

const { LlmNotConfiguredError, LlmRequestError } = require('./errors');

const REQUEST_TIMEOUT_MS = 30000;
const EMBEDDING_DIMENSIONS = 1024;

function isConfigured(cfg) {
  return Boolean(cfg && cfg.apiKey);
}

async function postJson(cfg, path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new LlmRequestError(`request to LLM provider failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new LlmRequestError(`LLM provider returned ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  try {
    return await response.json();
  } catch (err) {
    throw new LlmRequestError(`LLM provider returned a non-JSON response: ${err.message}`);
  }
}

async function complete(cfg, { systemPrompt, userPrompt }) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing apiKey)');
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
    throw new LlmRequestError('LLM provider response did not contain choices[0].message.content');
  }

  return answer;
}

async function completeWithTools(cfg, { systemPrompt, userPrompt, tools }) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing apiKey)');
  }

  const payload = await postJson(cfg, '/chat/completions', {
    model: cfg.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    tools: tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.params,
      },
    })),
    tool_choice: 'auto',
    temperature: 0.2,
  });

  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const message = choice ? choice.message : null;
  if (!message) {
    throw new LlmRequestError('LLM provider response did not contain choices[0].message');
  }

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (toolCalls.length > 0) {
    const fn = toolCalls[0].function || {};
    let toolArguments;
    try {
      toolArguments = fn.arguments ? JSON.parse(fn.arguments) : {};
    } catch (err) {
      throw new LlmRequestError(`LLM tool call arguments were not valid JSON: ${err.message}`);
    }
    return { type: 'tool_call', toolName: fn.name, arguments: toolArguments };
  }

  if (typeof message.content !== 'string') {
    throw new LlmRequestError('LLM provider response contained neither a tool call nor message content');
  }
  return { type: 'answer', text: message.content };
}

async function embed(cfg, texts, { inputType } = {}) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing apiKey)');
  }
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new LlmRequestError('embed() requires a non-empty array of texts');
  }
  if (inputType !== 'query' && inputType !== 'passage') {
    throw new LlmRequestError(`embed() inputType must be 'query' or 'passage', got ${JSON.stringify(inputType)}`);
  }

  const payload = await postJson(cfg, '/embeddings', {
    model: cfg.embeddingModel,
    input: texts,
    input_type: inputType,
    truncate: 'END',
  });

  const data = Array.isArray(payload && payload.data) ? payload.data : null;
  if (!data || data.length !== texts.length) {
    throw new LlmRequestError('LLM embeddings provider response did not contain one embedding per input text');
  }

  return data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

module.exports = {
  name: 'nim',
  EMBEDDING_DIMENSIONS,
  isConfigured,
  complete,
  completeWithTools,
  embed,
  // Back-compat aliases — existing tests/callers reference these off
  // the module directly (same identity as ./errors', re-exported here
  // rather than duplicated).
  LlmNotConfiguredError,
  LlmRequestError,
};
