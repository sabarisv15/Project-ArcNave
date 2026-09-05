'use strict';

// Perplexity Agent API adapter — a web-grounded answer capability, not a
// drop-in swap for the complete()/completeWithTools() chat-provider
// interface the other adapters in this folder implement (gemini/claude/
// openai/self_hosted/vertex_maas). Those are selectable via
// DEFAULT_AI_PROVIDER for a college's general chat/embedding needs; this
// one is a single-purpose capability (POST /v1/agent) a caller reaches
// for explicitly when it wants live web grounding with citations, so it
// exposes its own `agentAnswer` shape instead of pretending to be a
// generic chat provider.
//
// The API key is a secret, resolved only from cfg.apiKey (itself sourced
// from process.env.PERPLEXITY_API_KEY via config.js) — never hardcoded,
// logged, or printed by this file.

const { LlmNotConfiguredError, LlmRequestError } = require('./errors');
const { withRetry } = require('./retry');

const REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_BASE_URL = 'https://api.perplexity.ai';
const DEFAULT_MODEL = 'openai/gpt-5.6-sol';

function isConfigured(cfg) {
  return Boolean(cfg && cfg.apiKey);
}

function baseUrl(cfg) {
  return (cfg && cfg.baseUrl) || DEFAULT_BASE_URL;
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
      throw new LlmRequestError(`request to Perplexity failed: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new LlmRequestError(`Perplexity returned ${response.status}: ${bodyText.slice(0, 500)}`);
  }
  return response.json();
}

// Web-grounded answer via the Agent API. `tools` defaults to web_search —
// the whole reason to call this adapter instead of a plain chat provider.
// Returns { text, searchResults, responseId, raw } — `raw` is kept for
// callers that need annotations/citations beyond output_text.
async function agentAnswer(cfg, { systemPrompt, userPrompt, tools, previousResponseId, responseFormat } = {}) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('Perplexity is not configured (missing apiKey)');
  }
  if (typeof userPrompt !== 'string' || userPrompt.length === 0) {
    throw new LlmRequestError('agentAnswer() requires a non-empty userPrompt');
  }

  const input = [];
  if (systemPrompt) {
    input.push({ role: 'system', content: systemPrompt });
  }
  input.push({ role: 'user', content: userPrompt });

  const payload = await postJson(cfg, '/v1/agent', {
    model: cfg.model || DEFAULT_MODEL,
    input,
    tools: tools || [{ type: 'web_search' }],
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
  });

  const text = extractOutputText(payload);
  if (typeof text !== 'string') {
    throw new LlmRequestError('Perplexity Agent API response did not contain any output_text content');
  }

  return {
    text,
    searchResults: extractSearchResults(payload),
    responseId: payload.id || payload.response_id || null,
    raw: payload,
  };
}

// The official SDKs expose `response.output_text` as a convenience
// getter that concatenates every output_text content block across
// `output` — the raw REST JSON (what a plain fetch() gets, since this
// adapter uses fetch directly rather than the @perplexity-ai SDK) has no
// such top-level field, only the `output` array of message items. This
// mirrors that getter so callers still get the same convenience string.
function extractOutputText(payload) {
  const output = payload && Array.isArray(payload.output) ? payload.output : [];
  const parts = [];
  for (const item of output) {
    const content = Array.isArray(item && item.content) ? item.content : [];
    for (const block of content) {
      if (block && block.type === 'output_text' && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }
  }
  return parts.length > 0 ? parts.join('') : undefined;
}

// search_results can appear as a top-level field (Search API convention)
// or, for the Agent API, as url_citation annotations on output_text
// content blocks — collect whichever is present rather than assuming one
// shape.
function extractSearchResults(payload) {
  if (Array.isArray(payload && payload.search_results)) {
    return payload.search_results;
  }
  const output = payload && Array.isArray(payload.output) ? payload.output : [];
  const citations = [];
  for (const item of output) {
    const content = Array.isArray(item && item.content) ? item.content : [];
    for (const block of content) {
      const annotations = Array.isArray(block && block.annotations) ? block.annotations : [];
      for (const annotation of annotations) {
        if (annotation && annotation.type === 'url_citation') {
          citations.push(annotation);
        }
      }
    }
  }
  return citations;
}

module.exports = {
  name: 'perplexity',
  isConfigured,
  agentAnswer,
};
