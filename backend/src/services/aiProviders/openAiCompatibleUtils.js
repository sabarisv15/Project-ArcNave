'use strict';

// Review Finding #15 (2026-08-30) — narrow, shared mechanics for the
// OpenAI-compatible chat-completions convention that vertexMaas.js,
// selfHosted.js, and openai.js all independently implemented, byte-for-
// byte identical in three of the four places checked (extractUsage's
// {inputTokens, outputTokens} mapping; buildPriorTurnMessages' assistant-
// tool_calls/tool-result message pair; postJson's single-attempt fetch +
// timeout + response validation + JSON parse). Deliberately narrow — this
// is transport/normalization mechanics only, never a provider framework:
// URL construction, authentication, retry/timeout POLICY (vertexMaas's
// own maxTotalLatencyMs deadline budget has no equivalent here and stays
// in that file), and every model-specific quirk (think-tag sanitization,
// finish-reason handling, content-embedded tool-call parsing, local
// call-ID generation) all stay local to their own adapter.
//
// Every export here takes its provider context as explicit parameters
// (url, headers, body, timeoutMs, providerLabel) — nothing about a
// specific vendor is embedded, so each adapter keeps building its own
// URL/headers/auth before calling in.

const { LlmRequestError } = require('./errors');

// Single attempt: build a fresh AbortController from timeoutMs, POST the
// body, and return the raw Response — never parsed, since the retry loop
// each adapter already owns (retry.js's withRetry) decides retryability
// from response.ok/status before any parsing happens. A network-level
// failure (DNS, connection reset, or the abort firing) is wrapped in the
// same LlmRequestError shape every adapter already threw, naming the
// calling provider so the message stays distinguishable in logs.
async function fetchWithTimeout({ url, headers, body, timeoutMs, providerLabel }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new LlmRequestError(`request to ${providerLabel} failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

// response: a fetch Response already resolved past retry. Validates
// response.ok (reading up to 500 chars of the error body, same bound
// every adapter already used) and parses JSON, throwing the identical
// LlmRequestError shape/wording each adapter already had for both
// failure modes.
async function parseJsonResponse(response, providerLabel) {
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new LlmRequestError(`${providerLabel} returned ${response.status}: ${bodyText.slice(0, 500)}`);
  }
  try {
    return await response.json();
  } catch (err) {
    throw new LlmRequestError(`${providerLabel} returned a non-JSON response: ${err.message}`);
  }
}

// rawUsage: whatever a provider's own `usage` field was (OpenAI-
// compatible prompt_tokens/completion_tokens shape), or undefined/null.
// Returns undefined — never a fabricated {inputTokens:0,...} — when no
// usage block was present, so a caller can distinguish "usage unknown"
// from "usage is genuinely zero". Exactly the ternary vertexMaas.js,
// selfHosted.js, and openai.js each already had, inlined or named.
function extractOpenAiCompatibleUsage(rawUsage) {
  if (!rawUsage) return undefined;
  return { inputTokens: rawUsage.prompt_tokens, outputTokens: rawUsage.completion_tokens };
}

// priorTurns -> one {role:'assistant', tool_calls:[...]} + {role:'tool',
// tool_call_id, content} message pair per turn, in order — the ADR-030
// P2(c) continuation shape selfHosted.js and openai.js already built
// byte-identically. turn.rawToolCall (the provider's own literal
// tool_calls[0] entry, when the caller kept it) is preferred over
// reconstructing {id, type:'function', function:{name, arguments}} from
// the parsed arguments object, since JSON.stringify(parsedArguments)
// isn't guaranteed to reproduce the model's original argument-string
// formatting/key order. Callers needing their own pre-validation (e.g.
// vertexMaas.js's callId check, Review Finding #11) run it before calling
// this — this function assumes every turn.callId is already valid.
function buildOpenAiCompatiblePriorTurnMessages(priorTurns) {
  return priorTurns.flatMap((turn) => [
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        turn.rawToolCall || {
          id: turn.callId,
          type: 'function',
          function: { name: turn.toolName, arguments: JSON.stringify(turn.arguments || {}) },
        },
      ],
    },
    { role: 'tool', tool_call_id: turn.callId, content: turn.resultText },
  ]);
}

// ARCNAVE modernization P2 / 1.6 — historyTurns -> real prior 'user'/
// 'assistant' messages, placed BEFORE the current user turn — see
// gemini.js's own buildHistoryContents comment for the shared reasoning.
// The OpenAI-compatible convention already uses plain {role, content}
// message objects for both roles, so no shape translation is needed
// beyond passing the fields through.
function buildOpenAiCompatibleHistoryMessages(historyTurns) {
  if (!Array.isArray(historyTurns)) return [];
  return historyTurns.map((turn) => ({ role: turn.role, content: turn.content }));
}

module.exports = {
  fetchWithTimeout,
  parseJsonResponse,
  extractOpenAiCompatibleUsage,
  buildOpenAiCompatiblePriorTurnMessages,
  buildOpenAiCompatibleHistoryMessages,
};
