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

const REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 1024;

function isConfigured(cfg) {
  return Boolean(cfg && cfg.apiKey);
}

function baseUrl(cfg) {
  return cfg.baseUrl || DEFAULT_BASE_URL;
}

async function postJson(cfg, path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${baseUrl(cfg)}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new LlmRequestError(`request to Claude failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

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

async function complete(cfg, { systemPrompt, userPrompt }) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing apiKey)');
  }

  const payload = await postJson(cfg, '/v1/messages', {
    model: cfg.model,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const block = payload && Array.isArray(payload.content) ? payload.content.find((b) => b.type === 'text') : null;
  if (!block || typeof block.text !== 'string') {
    throw new LlmRequestError('Claude response did not contain a text content block');
  }

  return block.text;
}

async function completeWithTools(cfg, { systemPrompt, userPrompt, tools }) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing apiKey)');
  }

  const payload = await postJson(cfg, '/v1/messages', {
    model: cfg.model,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.params,
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
  isConfigured,
  complete,
  completeWithTools,
  embed,
};
