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
