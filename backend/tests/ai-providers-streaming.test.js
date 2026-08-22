'use strict';

// Unit tests for the streaming variant of each adapter's complete()
// (P0.5 of the AI capability roadmap, CHECKPOINT.md) — mocked fetch
// returning a fake SSE body (an async generator yielding Buffer
// chunks, exactly the shape Node's real fetch(undici) gives
// response.body), no live network call to any vendor.

const test = require('node:test');
const assert = require('node:assert/strict');
const { iterateSseLines } = require('../src/services/aiProviders/sse');
const nimAdapter = require('../src/services/aiProviders/nim');
const selfHostedAdapter = require('../src/services/aiProviders/selfHosted');
const claudeAdapter = require('../src/services/aiProviders/claude');
const geminiAdapter = require('../src/services/aiProviders/gemini');
const openaiAdapter = require('../src/services/aiProviders/openai');
const { LlmRequestError, LlmNotConfiguredError } = require('../src/services/aiProviders/errors');

function fakeSseResponse(lines, { ok = true, status } = {}) {
  return {
    ok,
    status,
    text: async () => '',
    body: (async function* body() {
      for (const line of lines) yield Buffer.from(line);
    }()),
  };
}

function withMockFetch(mockFetch, fn) {
  const original = global.fetch;
  global.fetch = mockFetch;
  return fn().finally(() => { global.fetch = original; });
}

// --- iterateSseLines (shared parser) ---

test('iterateSseLines: yields each data: payload, splitting on newlines regardless of chunk boundaries', async () => {
  const response = fakeSseResponse([
    'data: {"a":1}\n\n',
    'data: {"a":2}\ndata: {"a":3}\n',
  ]);
  const payloads = [];
  for await (const p of iterateSseLines(response)) payloads.push(p);
  assert.deepEqual(payloads, ['{"a":1}', '{"a":2}', '{"a":3}']);
});

test('iterateSseLines: a data: line split across two chunks is still reassembled correctly', async () => {
  const response = fakeSseResponse(['data: {"a":', '1}\n']);
  const payloads = [];
  for await (const p of iterateSseLines(response)) payloads.push(p);
  assert.deepEqual(payloads, ['{"a":1}']);
});

test('iterateSseLines: non-data lines (event:, blank lines) are ignored', async () => {
  const response = fakeSseResponse(['event: content_block_delta\ndata: {"a":1}\n\n']);
  const payloads = [];
  for await (const p of iterateSseLines(response)) payloads.push(p);
  assert.deepEqual(payloads, ['{"a":1}']);
});

// --- nim/selfHosted (OpenAI-compatible SSE shape) ---

for (const [label, adapter, cfg] of [
  ['nim', nimAdapter, { apiKey: 'k', baseUrl: 'https://nim.example', model: 'test-model' }],
  ['selfHosted', selfHostedAdapter, { baseUrl: 'https://self-hosted.example', model: 'test-model' }],
  ['openai', openaiAdapter, { apiKey: 'k', model: 'test-model' }],
]) {
  test(`${label} adapter.completeStream: streams each delta and returns the full concatenated text`, async () => {
    const deltas = [];
    const response = fakeSseResponse([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    await withMockFetch(async () => response, async () => {
      const full = await adapter.completeStream(cfg, { systemPrompt: 's', userPrompt: 'u' }, (d) => deltas.push(d));
      assert.deepEqual(deltas, ['Hello', ' world']);
      assert.equal(full, 'Hello world');
    });
  });

  test(`${label} adapter.completeStream: a non-ok response throws LlmRequestError before any onDelta call`, async () => {
    const response = fakeSseResponse([], { ok: false, status: 500 });
    let deltaCalled = false;
    await withMockFetch(async () => response, async () => {
      await assert.rejects(
        () => adapter.completeStream(cfg, { systemPrompt: 's', userPrompt: 'u' }, () => { deltaCalled = true; }),
        LlmRequestError,
      );
    });
    assert.equal(deltaCalled, false);
  });
}

// --- Claude (named-event SSE shape) ---

test('claude adapter.completeStream: only content_block_delta/text_delta events produce output, other event types are ignored', async () => {
  const deltas = [];
  const response = fakeSseResponse([
    'event: message_start\ndata: {"type":"message_start"}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" there"}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ]);
  await withMockFetch(async () => response, async () => {
    const full = await claudeAdapter.completeStream({ apiKey: 'k' }, { systemPrompt: 's', userPrompt: 'u' }, (d) => deltas.push(d));
    assert.deepEqual(deltas, ['Hi', ' there']);
    assert.equal(full, 'Hi there');
  });
});

// --- Gemini (candidates[].content.parts[].text SSE shape) ---

test('gemini adapter.completeStream: streams candidates[0].content.parts[].text deltas', async () => {
  const deltas = [];
  const response = fakeSseResponse([
    'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n',
    'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}]}\n\n',
  ]);
  await withMockFetch(async () => response, async () => {
    const full = await geminiAdapter.completeStream({ projectId: 'p', accessToken: 't' }, { systemPrompt: 's', userPrompt: 'u' }, (d) => deltas.push(d));
    assert.deepEqual(deltas, ['Hello', ' world']);
    assert.equal(full, 'Hello world');
  });
});

// Regression: attemptStream used to collect every chunk into an array
// and only call onDelta in a tight loop AFTER the whole SSE stream had
// ended, so a real caller (the chat UI's typewriter effect) saw the
// entire answer arrive in one burst instead of a smooth stream. Proven
// here by timing, not just by the final delta values (which the old
// buffered code also produced correctly, just all at once at the end):
// the first delta must fire before the second SSE chunk is even
// available on the wire.
test('gemini adapter.completeStream: emits each delta inline as its own SSE chunk arrives, not buffered until the stream ends', async () => {
  let secondChunkReleased = false;
  const firstDeltaSawSecondChunkReleased = [];
  const response = {
    ok: true,
    text: async () => '',
    body: (async function* body() {
      yield Buffer.from('data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n');
      await new Promise((resolve) => { setTimeout(resolve, 30); });
      secondChunkReleased = true;
      yield Buffer.from('data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}]}\n\n');
    }()),
  };
  await withMockFetch(async () => response, async () => {
    await geminiAdapter.completeStream(
      { projectId: 'p', accessToken: 't' },
      { systemPrompt: 's', userPrompt: 'u' },
      () => firstDeltaSawSecondChunkReleased.push(secondChunkReleased),
    );
  });
  assert.equal(
    firstDeltaSawSecondChunkReleased[0],
    false,
    'the first onDelta call must happen before the second SSE chunk is even available — proves per-chunk inline emission, not buffer-then-burst',
  );
});

// Real live-caught bug (2026-08-21): Gemini 3.7 Flash's hybrid
// reasoning can spend its entire thinking budget and stream a final
// chunk shaped `{ parts: [{ text: "", thoughtSignature: "..." }],
// finishReason: "STOP" }` — a well-formed 200 SSE response with zero
// visible answer text. Before this guard, completeStream returned ''
// as a false "success", which the caller (aiService.js) persisted as
// if it were a real (empty) answer, and the frontend then displayed a
// generic fallback string as though the AI itself had said it —
// completeWithMeta already refused an empty text; streaming needed the
// identical guard.
test('gemini adapter.completeStream: a well-formed response with zero visible text (thinking budget exhausted) throws LlmRequestError, never a false empty success', async () => {
  const response = fakeSseResponse([
    'data: {"candidates":[{"content":{"parts":[{"text":"","thoughtSignature":"abc"}]},"finishReason":"STOP"}]}\n\n',
  ]);
  let deltaCalled = false;
  await withMockFetch(async () => response, async () => {
    await assert.rejects(
      () => geminiAdapter.completeStream({ projectId: 'p', accessToken: 't' }, { systemPrompt: 's', userPrompt: 'u' }, () => { deltaCalled = true; }),
      LlmRequestError,
    );
  });
  assert.equal(deltaCalled, false);
});

// Regression test for the P0 finding from the AI red-team evaluation
// session (2026-08-21) — the streaming counterpart of ai-providers.
// test.js's equivalent completeWithMeta test. attemptStream previously
// got a fresh REQUEST_TIMEOUT_MS (30s) on every withRetry sub-attempt
// AND on every one of completeStream's own MAX_EMPTY_RETRIES+1 outer
// attempts, compounding to ~90s+ for a single call — this is the exact
// call this incident's own live trace pointed at (askAgent's final-
// answer synthesis, held inside the same per-request DB transaction
// whose idle_in_transaction_session_timeout, 90s, killed the connection
// and — before a separate fix to tenantTransaction.js — crashed the
// whole backend process). MAX_TOTAL_STREAM_MS now bounds the whole
// operation. Proven with a genuinely hanging mock fetch (rejects only
// when the AbortSignal fires), not a fast-failing one.
test('gemini adapter.completeStream: a hanging request is aborted well within the overall time budget, never the old ~90s+ worst case', async () => {
  const hangingFetch = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
  const startedAt = Date.now();
  await withMockFetch(hangingFetch, async () => {
    await assert.rejects(
      () => geminiAdapter.completeStream(
        { projectId: 'p', accessToken: 't', maxTotalStreamMs: 150 },
        { systemPrompt: 's', userPrompt: 'u' },
        () => {},
      ),
      LlmRequestError,
    );
  });
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 5000, `expected the call to give up within a few seconds of the 150ms budget, took ${elapsed}ms`);
});

test('gemini adapter.completeStream: unconfigured (no projectId) throws LlmNotConfiguredError, no fetch attempted', async () => {
  let fetchCalled = false;
  await withMockFetch(async () => { fetchCalled = true; }, async () => {
    await assert.rejects(
      () => geminiAdapter.completeStream({}, { systemPrompt: 's', userPrompt: 'u' }, () => {}),
      LlmNotConfiguredError,
    );
  });
  assert.equal(fetchCalled, false);
});
