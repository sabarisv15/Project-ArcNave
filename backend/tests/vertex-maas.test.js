'use strict';

// Review Finding #4 (2026-08-29) — raw model "thinking" text wrapped in
// <think>...</think> could leak into user-visible Vertex MaaS answers.
// This file covers vertexMaas.js's own sanitizeModelOutput() directly
// (same precedent as sse.js's iterateSseLines being unit-tested on its
// own in ai-providers-streaming.test.js) plus the two real return paths
// that must never hand back raw provider content: completeWithMeta() and
// completeWithTools()'s type: 'answer' path (including its fallback, and
// its content-embedded tool-call detection, which must keep working
// exactly as before).
//
// No dedicated test file existed for this adapter before this one —
// ai-service.test.js/ai-tool-search-service.test.js only ever stub
// completeWithTools as a fake function, never exercising the real
// module. Fetch mocking follows ai-providers-streaming.test.js's own
// withMockFetch precedent, adapted for a plain JSON (non-SSE) body,
// which is this adapter's actual wire shape.

const test = require('node:test');
const assert = require('node:assert/strict');
const vertexMaasAdapter = require('../src/services/aiProviders/vertexMaas');
const { LlmRequestError } = require('../src/services/aiProviders/errors');
const { contextFromFlatPrompts } = require('../src/services/aiContextAssembly');

const { sanitizeModelOutput } = vertexMaasAdapter;

function withMockFetch(mockFetch, fn) {
  const original = global.fetch;
  global.fetch = mockFetch;
  return fn().finally(() => { global.fetch = original; });
}

function fakeJsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

const CFG = { projectId: 'p', model: 'test-model', accessToken: 't' };
const CTX = () => contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u', tools: [] });

function chatResponse(content, { toolCalls } = {}) {
  return fakeJsonResponse({
    choices: [{ message: { content, tool_calls: toolCalls } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
}

// --- sanitizeModelOutput (the shared sanitizer itself) ---

test('sanitizeModelOutput: normal answer text is unchanged', () => {
  assert.equal(sanitizeModelOutput('Hello, how can I help?'), 'Hello, how can I help?');
});

test('sanitizeModelOutput: a complete leading think block is removed, visible text kept', () => {
  assert.equal(sanitizeModelOutput('<think>internal reasoning</think>The final answer.'), 'The final answer.');
});

test('sanitizeModelOutput: multiple and mixed-position think blocks are all removed', () => {
  assert.equal(sanitizeModelOutput('<think>first</think>Visible answer<think>second</think>'), 'Visible answer');
});

test('sanitizeModelOutput: tag matching is case-insensitive', () => {
  assert.equal(sanitizeModelOutput('<THINK>internal reasoning</THINK>Visible answer'), 'Visible answer');
});

test('sanitizeModelOutput: a think block embedded after visible text is removed', () => {
  assert.equal(sanitizeModelOutput('Final answer<think>internal reasoning</think>'), 'Final answer');
});

test('sanitizeModelOutput: an unclosed think block leaves no visible text at all', () => {
  assert.equal(sanitizeModelOutput('<think>unfinished internal reasoning'), '');
});

test('sanitizeModelOutput: visible text before an unclosed think block is preserved, the tag and everything after it is dropped', () => {
  assert.equal(sanitizeModelOutput('Visible answer before tag<think>unfinished internal reasoning'), 'Visible answer before tag');
});

test('sanitizeModelOutput: a stray unmatched closing tag is removed on its own', () => {
  assert.equal(sanitizeModelOutput('Hello</think>World'), 'HelloWorld');
});

test('sanitizeModelOutput: non-string content (null/undefined/object) is handed back unchanged, never thrown on', () => {
  assert.equal(sanitizeModelOutput(null), null);
  assert.equal(sanitizeModelOutput(undefined), undefined);
  const obj = { not: 'a string' };
  assert.equal(sanitizeModelOutput(obj), obj);
});

// --- completeWithMeta() ---

test('completeWithMeta: a think block never reaches the returned text', async () => {
  await withMockFetch(async () => chatResponse('<think>\nI am uncertain about whether the extracted values align correctly.\n</think>\n\nThe total fee due is ₹48,000.'), async () => {
    const { text } = await vertexMaasAdapter.completeWithMeta(CFG, CTX());
    assert.equal(text, 'The total fee due is ₹48,000.');
  });
});

test('completeWithMeta: content that is ONLY internal reasoning throws LlmRequestError rather than returning raw thought', async () => {
  await withMockFetch(async () => chatResponse('<think>only internal reasoning</think>'), async () => {
    await assert.rejects(
      () => vertexMaasAdapter.completeWithMeta(CFG, CTX()),
      LlmRequestError,
    );
  });
});

// --- completeWithTools(): normal/fallback 'answer' path ---

test('completeWithTools: a think block never reaches the returned answer text', async () => {
  await withMockFetch(async () => chatResponse('<think>I should possibly use another tool.</think>The total fee due is ₹48,000.'), async () => {
    const result = await vertexMaasAdapter.completeWithTools(CFG, CTX());
    assert.equal(result.type, 'answer');
    assert.equal(result.text, 'The total fee due is ₹48,000.');
  });
});

test('completeWithTools: an unclosed think block with no visible text after it throws rather than returning raw thought', async () => {
  await withMockFetch(async () => chatResponse('<think>unfinished internal reasoning'), async () => {
    await assert.rejects(
      () => vertexMaasAdapter.completeWithTools(CFG, CTX()),
      LlmRequestError,
    );
  });
});

test('completeWithTools: visible text before an unclosed think block is still returned, the tag is dropped', async () => {
  await withMockFetch(async () => chatResponse('Final answer before tag<think>unfinished internal reasoning'), async () => {
    const result = await vertexMaasAdapter.completeWithTools(CFG, CTX());
    assert.equal(result.type, 'answer');
    assert.equal(result.text, 'Final answer before tag');
  });
});

// --- completeWithTools(): tool-call compatibility ---

test('completeWithTools: a structured tool_calls response is unaffected by sanitization (no text content involved)', async () => {
  await withMockFetch(async () => chatResponse(null, {
    toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'do_thing', arguments: '{"x":1}' } }],
  }), async () => {
    const result = await vertexMaasAdapter.completeWithTools(CFG, CTX());
    assert.equal(result.type, 'tool_call');
    assert.equal(result.toolName, 'do_thing');
    assert.deepEqual(result.arguments, { x: 1 });
  });
});

test('completeWithTools: a content-embedded tool call preceded by a think block is still detected, never returned as answer text', async () => {
  const content = '<think>I should call the tool.</think>[{"name":"select_relevant_tools","parameters":{"names":["a","b"]}}]';
  await withMockFetch(async () => chatResponse(content), async () => {
    const result = await vertexMaasAdapter.completeWithTools(CFG, CTX());
    assert.equal(result.type, 'tool_call');
    assert.equal(result.toolName, 'select_relevant_tools');
    assert.deepEqual(result.arguments, { names: ['a', 'b'] });
  });
});

test('completeWithTools: a content-embedded tool call followed by a think block is still detected', async () => {
  const content = '<tool_call>{"name":"select_relevant_tools","arguments":{"names":["a"]}}</tool_call><think>trailing reasoning</think>';
  await withMockFetch(async () => chatResponse(content), async () => {
    const result = await vertexMaasAdapter.completeWithTools(CFG, CTX());
    assert.equal(result.type, 'tool_call');
    assert.equal(result.toolName, 'select_relevant_tools');
    assert.deepEqual(result.arguments, { names: ['a'] });
  });
});
