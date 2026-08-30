'use strict';

// Unit tests for the shared OpenAI-compatible adapter mechanics extracted
// in Review Finding #15 (2026-08-30) — fetchWithTimeout/parseJsonResponse
// (postJson's split halves), extractOpenAiCompatibleUsage, and
// buildOpenAiCompatiblePriorTurnMessages. Each adapter's own tests
// (vertex-maas-provider.test.js, vertex-maas.test.js, ai-providers.test.js)
// already prove these produce the exact same wire behavior as before
// through the real adapters; these tests cover the shared module's own
// externally observable contract directly, against a stubbed
// global.fetch, same "no live network call" convention every adapter
// test in this repo already follows.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchWithTimeout, parseJsonResponse, extractOpenAiCompatibleUsage, buildOpenAiCompatiblePriorTurnMessages,
} = require('../src/services/aiProviders/openAiCompatibleUtils');
const { LlmRequestError } = require('../src/services/aiProviders/errors');

function withStubbedFetch(impl, fn) {
  const original = global.fetch;
  global.fetch = impl;
  return fn().finally(() => { global.fetch = original; });
}

// --- fetchWithTimeout ---

test('fetchWithTimeout: posts to the exact url/headers/body given, no hidden defaults added', async () => {
  let captured;
  await withStubbedFetch(async (url, options) => {
    captured = { url, options };
    return { ok: true };
  }, async () => {
    await fetchWithTimeout({
      url: 'https://example.test/chat', headers: { 'x-custom': 'v' }, body: { a: 1 }, timeoutMs: 1000, providerLabel: 'Test Provider',
    });
  });
  assert.equal(captured.url, 'https://example.test/chat');
  assert.equal(captured.options.method, 'POST');
  assert.deepEqual(captured.options.headers, { 'x-custom': 'v' });
  assert.equal(captured.options.body, JSON.stringify({ a: 1 }));
  assert.ok(captured.options.signal instanceof AbortSignal);
});

test('fetchWithTimeout: a network-level throw is wrapped in LlmRequestError naming the given providerLabel', async () => {
  await withStubbedFetch(async () => { throw new Error('ECONNRESET'); }, async () => {
    await assert.rejects(
      () => fetchWithTimeout({
        url: 'https://example.test/chat', headers: {}, body: {}, timeoutMs: 1000, providerLabel: 'Test Provider',
      }),
      (err) => err instanceof LlmRequestError && /request to Test Provider failed: ECONNRESET/.test(err.message),
    );
  });
});

test('fetchWithTimeout: aborts and rejects once timeoutMs elapses on a hanging request', async () => {
  await withStubbedFetch((url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  }), async () => {
    const startedAt = Date.now();
    await assert.rejects(
      () => fetchWithTimeout({
        url: 'https://example.test/chat', headers: {}, body: {}, timeoutMs: 50, providerLabel: 'Test Provider',
      }),
      LlmRequestError,
    );
    assert.ok(Date.now() - startedAt < 2000, 'must not wait beyond the given timeoutMs');
  });
});

// --- parseJsonResponse ---

test('parseJsonResponse: a successful response returns the parsed JSON body', async () => {
  const response = { ok: true, json: async () => ({ hello: 'world' }) };
  const result = await parseJsonResponse(response, 'Test Provider');
  assert.deepEqual(result, { hello: 'world' });
});

test('parseJsonResponse: a non-ok response throws LlmRequestError with the status and up to 500 chars of the body, naming the provider', async () => {
  const response = {
    ok: false, status: 503, text: async () => 'x'.repeat(600),
  };
  await assert.rejects(
    () => parseJsonResponse(response, 'Test Provider'),
    (err) => {
      assert.ok(err instanceof LlmRequestError);
      assert.match(err.message, /^Test Provider returned 503: x+$/);
      assert.equal(err.message.length, 'Test Provider returned 503: '.length + 500);
      return true;
    },
  );
});

test('parseJsonResponse: a response whose body text read itself fails still throws cleanly (empty body assumed)', async () => {
  const response = {
    ok: false, status: 500, text: async () => { throw new Error('stream already consumed'); },
  };
  await assert.rejects(
    () => parseJsonResponse(response, 'Test Provider'),
    (err) => err instanceof LlmRequestError && /Test Provider returned 500: $/.test(err.message),
  );
});

test('parseJsonResponse: a non-JSON ok response throws LlmRequestError naming the provider, never crashes uncaught', async () => {
  const response = { ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } };
  await assert.rejects(
    () => parseJsonResponse(response, 'Test Provider'),
    (err) => err instanceof LlmRequestError && /Test Provider returned a non-JSON response: Unexpected token/.test(err.message),
  );
});

// --- extractOpenAiCompatibleUsage ---

test('extractOpenAiCompatibleUsage: maps prompt_tokens/completion_tokens to inputTokens/outputTokens', () => {
  assert.deepEqual(
    extractOpenAiCompatibleUsage({ prompt_tokens: 12, completion_tokens: 34 }),
    { inputTokens: 12, outputTokens: 34 },
  );
});

test('extractOpenAiCompatibleUsage: undefined/null/missing usage returns undefined, never a fabricated zero', () => {
  assert.equal(extractOpenAiCompatibleUsage(undefined), undefined);
  assert.equal(extractOpenAiCompatibleUsage(null), undefined);
});

// --- buildOpenAiCompatiblePriorTurnMessages ---

test('buildOpenAiCompatiblePriorTurnMessages: one assistant/tool_calls + tool/result pair per prior turn, in order', () => {
  const messages = buildOpenAiCompatiblePriorTurnMessages([
    {
      toolName: 'tool_a', arguments: { x: 1 }, callId: 'call_1', resultText: 'RESULT_1',
    },
    {
      toolName: 'tool_b', arguments: { y: 2 }, callId: 'call_2', resultText: 'RESULT_2',
    },
  ]);
  assert.equal(messages.length, 4);
  assert.deepEqual(messages[0], {
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'tool_a', arguments: '{"x":1}' } }],
  });
  assert.deepEqual(messages[1], { role: 'tool', tool_call_id: 'call_1', content: 'RESULT_1' });
  assert.deepEqual(messages[2], {
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'tool_b', arguments: '{"y":2}' } }],
  });
  assert.deepEqual(messages[3], { role: 'tool', tool_call_id: 'call_2', content: 'RESULT_2' });
});

test('buildOpenAiCompatiblePriorTurnMessages: rawToolCall is replayed verbatim when present, never reconstructed', () => {
  const rawToolCall = {
    id: 'call_9', type: 'function', function: { name: 'tool_a', arguments: '{"x":1,"y":2}' },
  };
  const messages = buildOpenAiCompatiblePriorTurnMessages([{
    toolName: 'tool_a', arguments: { x: 1, y: 2 }, callId: 'call_9', rawToolCall, resultText: 'R',
  }]);
  assert.equal(messages[0].tool_calls[0], rawToolCall, 'the exact same object, not a reconstruction');
});

test('buildOpenAiCompatiblePriorTurnMessages: an empty priorTurns array produces no messages', () => {
  assert.deepEqual(buildOpenAiCompatiblePriorTurnMessages([]), []);
});
