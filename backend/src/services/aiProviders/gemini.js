'use strict';

// Google Gemini adapter (Generative Language API). Real request/
// response shapes per Google's documented REST API — NOT live-verified
// against a real Gemini API key (none exists in this environment); the
// shape is real, not fabricated, but unlike nim.js this hasn't been
// exercised against a live endpoint.

const { LlmNotConfiguredError, LlmRequestError, AiProviderCapabilityError } = require('./errors');

const REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

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
    response = await fetch(`${baseUrl(cfg)}${path}?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new LlmRequestError(`request to Gemini failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new LlmRequestError(`Gemini returned ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  try {
    return await response.json();
  } catch (err) {
    throw new LlmRequestError(`Gemini returned a non-JSON response: ${err.message}`);
  }
}

async function complete(cfg, { systemPrompt, userPrompt }) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing apiKey)');
  }

  const payload = await postJson(cfg, `/models/${cfg.model}:generateContent`, {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
  });

  const parts = payload && payload.candidates && payload.candidates[0]
    && payload.candidates[0].content && payload.candidates[0].content.parts;
  const text = Array.isArray(parts) ? parts.map((p) => p.text).filter(Boolean).join('') : undefined;
  if (typeof text !== 'string' || text.length === 0) {
    throw new LlmRequestError('Gemini response did not contain candidates[0].content.parts[].text');
  }

  return text;
}

async function completeWithTools(cfg, { systemPrompt, userPrompt, tools }) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing apiKey)');
  }

  const payload = await postJson(cfg, `/models/${cfg.model}:generateContent`, {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    tools: [{
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.params,
      })),
    }],
  });

  const parts = payload && payload.candidates && payload.candidates[0]
    && payload.candidates[0].content && payload.candidates[0].content.parts;
  if (!Array.isArray(parts)) {
    throw new LlmRequestError('Gemini response did not contain candidates[0].content.parts');
  }

  const functionCallPart = parts.find((p) => p.functionCall);
  if (functionCallPart) {
    return { type: 'tool_call', toolName: functionCallPart.functionCall.name, arguments: functionCallPart.functionCall.args || {} };
  }

  const text = parts.map((p) => p.text).filter(Boolean).join('');
  if (!text) {
    throw new LlmRequestError('Gemini response contained neither a function call nor text');
  }
  return { type: 'answer', text };
}

async function embed(cfg, texts, { inputType } = {}) {
  if (!isConfigured(cfg)) {
    throw new LlmNotConfiguredError('no LLM provider is configured for this college (missing apiKey)');
  }
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new LlmRequestError('embed() requires a non-empty array of texts');
  }

  // Gemini's embedContent is single-input; batchEmbedContents is the
  // batch form — used here so embed()'s array contract (one caller
  // request in, one embedding per input out) holds without an N-call
  // loop for a multi-chunk ingest.
  const taskType = inputType === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';
  const payload = await postJson(cfg, `/models/${cfg.embeddingModel}:batchEmbedContents`, {
    requests: texts.map((text) => ({
      model: `models/${cfg.embeddingModel}`,
      content: { parts: [{ text }] },
      taskType,
    })),
  });

  const embeddings = Array.isArray(payload && payload.embeddings) ? payload.embeddings : null;
  if (!embeddings || embeddings.length !== texts.length) {
    throw new LlmRequestError('Gemini embeddings response did not contain one embedding per input text');
  }

  return embeddings.map((item) => item.values);
}

module.exports = {
  name: 'gemini',
  isConfigured,
  complete,
  completeWithTools,
  embed,
  AiProviderCapabilityError,
};
