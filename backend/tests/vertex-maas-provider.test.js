'use strict';

// Unit tests for aiProviders/vertexMaas.js — Review Finding #9 (finish-
// reason/truncation handling), against a stubbed global.fetch, same
// "not a live vendor call" convention every other unit test in this
// repo's test tier already follows (see ai-tool-search-service.test.js's
// own file comment). cfg.accessToken is this adapter's own documented
// test-only bearer-token override (its getAccessToken's own comment),
// used here instead of real ADC so no GoogleAuth call ever happens.
//
// No safe bounded "continue a truncated answer" mechanism exists
// anywhere in this codebase today (gemini.js's own MAX_EMPTY_RETRIES is
// a full-regeneration retry for a DIFFERENT failure — zero visible text
// — not a resume-from-partial-output mechanism, and nothing analogous
// exists in this file or its callers). Per this finding's own scope
// ("do not build a large new continuation framework in this task"),
// continuation is deliberately not implemented and there is no Test 9
// here — a truncated response always surfaces as a thrown
// LlmRequestError, for the caller's existing retry/fallback behavior
// (e.g. aiToolSearchService.js's own catch-all) to handle exactly as it
// already handles any other provider failure.

const test = require('node:test');
const assert = require('node:assert/strict');
const vertexMaas = require('../src/services/aiProviders/vertexMaas');
const { LlmRequestError } = require('../src/services/aiProviders/errors');
const aiContextAssembly = require('../src/services/aiContextAssembly');

function withStubbedFetch(impl, fn) {
  const original = global.fetch;
  global.fetch = impl;
  return fn().finally(() => {
    global.fetch = original;
  });
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

function baseCfg() {
  return {
    projectId: 'proj',
    location: 'global',
    model: 'qwen/qwen3-next-80b-a3b-thinking-maas',
    accessToken: 'fake-token',
  };
}

function plainContext() {
  return aiContextAssembly.contextFromFlatPrompts({ systemPrompt: 'sys', userPrompt: 'user question' });
}

function toolContext() {
  return aiContextAssembly.contextFromFlatPrompts({
    systemPrompt: 'sys',
    userPrompt: 'user question',
    tools: [
      { name: 'attendance_summary', description: 'reports attendance.', params: { type: 'object', properties: {} } },
    ],
  });
}

// --- Test 1: normal completed answer -----------------------------------

test('completeWithMeta: a normal finish_reason "stop" answer is returned unchanged', async () => {
  await withStubbedFetch(
    async () =>
      jsonResponse({
        choices: [{ finish_reason: 'stop', message: { content: 'The answer is 42.' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    async () => {
      const result = await vertexMaas.completeWithMeta(baseCfg(), plainContext());
      assert.equal(result.text, 'The answer is 42.');
      assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5 });
    },
  );
});

test('completeWithTools: a normal finish_reason "stop" plain-text answer (no tools called) is returned unchanged', async () => {
  await withStubbedFetch(
    async () =>
      jsonResponse({
        choices: [{ finish_reason: 'stop', message: { content: 'The answer is 42.', tool_calls: null } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    async () => {
      const result = await vertexMaas.completeWithTools(baseCfg(), toolContext());
      assert.equal(result.type, 'answer');
      assert.equal(result.text, 'The answer is 42.');
    },
  );
});

// --- Test 2: truncated normal answer ------------------------------------

test('completeWithMeta: finish_reason "length" is never returned as a completed answer', async () => {
  await withStubbedFetch(
    async () =>
      jsonResponse({
        choices: [
          {
            finish_reason: 'length',
            message: { content: 'Students with fee due above ₹10,000 are Arun, Bala, and...' },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 1024 },
      }),
    async () => {
      await assert.rejects(
        () => vertexMaas.completeWithMeta(baseCfg(), plainContext()),
        (err) => {
          assert.ok(err instanceof LlmRequestError);
          assert.match(err.message, /length/);
          assert.ok(!/Arun|Bala/.test(err.message), 'the partial text itself must not leak into the error either');
          return true;
        },
      );
    },
  );
});

test('completeWithTools: finish_reason "length" plain-text answer is never returned as a completed answer', async () => {
  await withStubbedFetch(
    async () =>
      jsonResponse({
        choices: [
          {
            finish_reason: 'length',
            message: { content: 'Students with fee due above ₹10,000 are Arun, Bala, and...', tool_calls: null },
          },
        ],
      }),
    async () => {
      await assert.rejects(
        () => vertexMaas.completeWithTools(baseCfg(), toolContext()),
        (err) => err instanceof LlmRequestError && /length/.test(err.message),
      );
    },
  );
});

// --- Test 3: truncated output containing think tags ---------------------

test('completeWithMeta: a truncated response with an unclosed <think> block never leaks reasoning and is still refused as truncated', async () => {
  await withStubbedFetch(
    async () =>
      jsonResponse({
        choices: [
          {
            finish_reason: 'length',
            message: { content: '<think>internal reasoning the user must never see and is still going' },
          },
        ],
      }),
    async () => {
      await assert.rejects(
        () => vertexMaas.completeWithMeta(baseCfg(), plainContext()),
        (err) => {
          assert.ok(err instanceof LlmRequestError);
          assert.ok(!/internal reasoning/.test(err.message), '<think> content must never appear in the thrown error');
          return true;
        },
      );
    },
  );
});

// --- Test 4: complete native tool call -----------------------------------

test('completeWithTools: a complete native tool call (finish_reason "tool_calls") proceeds exactly as before', async () => {
  await withStubbedFetch(
    async () =>
      jsonResponse({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'attendance_summary', arguments: '{"classId":"CSE-A"}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 8 },
      }),
    async () => {
      const result = await vertexMaas.completeWithTools(baseCfg(), toolContext());
      assert.equal(result.type, 'tool_call');
      assert.equal(result.toolName, 'attendance_summary');
      assert.deepEqual(result.arguments, { classId: 'CSE-A' });
    },
  );
});

// --- Test 5: truncated native tool call -----------------------------------

test('completeWithTools: a native tool call with finish_reason "length" is never executed', async () => {
  await withStubbedFetch(
    async () =>
      jsonResponse({
        choices: [
          {
            finish_reason: 'length',
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'attendance_summary', arguments: '{"classId":"CSE' },
                },
              ],
            },
          },
        ],
      }),
    async () => {
      await assert.rejects(
        () => vertexMaas.completeWithTools(baseCfg(), toolContext()),
        (err) => err instanceof LlmRequestError && /length/.test(err.message),
      );
    },
  );
});

// --- Test 6: truncated content-embedded tool call -------------------------

test('completeWithTools: a content-embedded tool-call fallback is never parsed/executed when finish_reason is "length"', async () => {
  await withStubbedFetch(
    async () =>
      jsonResponse({
        choices: [
          {
            finish_reason: 'length',
            message: {
              content: '<tool_call>{"name":"attendance_summary","arguments":{"classId":"CSE',
              tool_calls: null,
            },
          },
        ],
      }),
    async () => {
      await assert.rejects(
        () => vertexMaas.completeWithTools(baseCfg(), toolContext()),
        (err) => err instanceof LlmRequestError && /length/.test(err.message),
      );
    },
  );
});

// --- Test 7: missing/unknown finish reason ---------------------------------

test('completeWithMeta: a missing finish_reason does not bypass truncation detection but does not reject an otherwise-valid answer', async () => {
  await withStubbedFetch(
    async () =>
      jsonResponse({
        choices: [{ message: { content: 'A complete answer with no finish_reason field at all.' } }],
      }),
    async () => {
      const result = await vertexMaas.completeWithMeta(baseCfg(), plainContext());
      assert.equal(result.text, 'A complete answer with no finish_reason field at all.');
    },
  );
});

test('completeWithTools: an unrecognized finish_reason value does not reject an otherwise-valid tool call', async () => {
  await withStubbedFetch(
    async () =>
      jsonResponse({
        choices: [
          {
            finish_reason: 'some_future_provider_value',
            message: {
              content: null,
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'attendance_summary', arguments: '{}' } },
              ],
            },
          },
        ],
      }),
    async () => {
      const result = await vertexMaas.completeWithTools(baseCfg(), toolContext());
      assert.equal(result.type, 'tool_call');
      assert.equal(result.toolName, 'attendance_summary');
    },
  );
});

// --- Test 8: special non-length completion state (content filter) ---------

test('completeWithTools: finish_reason "content_filter" is never treated as a completed answer', async () => {
  await withStubbedFetch(
    async () =>
      jsonResponse({
        choices: [
          {
            finish_reason: 'content_filter',
            message: { content: 'partial before the filter tripped', tool_calls: null },
          },
        ],
      }),
    async () => {
      await assert.rejects(
        () => vertexMaas.completeWithTools(baseCfg(), toolContext()),
        (err) => err instanceof LlmRequestError && /content_filter/.test(err.message),
      );
    },
  );
});

// --- normalizeFinishReason direct unit coverage ----------------------------

test('normalizeFinishReason: maps the real observed and documented OpenAI-compatible values correctly', () => {
  assert.equal(vertexMaas.normalizeFinishReason('length'), vertexMaas.FINISH_REASON.TRUNCATED);
  assert.equal(vertexMaas.normalizeFinishReason('max_tokens'), vertexMaas.FINISH_REASON.TRUNCATED);
  assert.equal(vertexMaas.normalizeFinishReason('tool_calls'), vertexMaas.FINISH_REASON.TOOL_CALL);
  assert.equal(vertexMaas.normalizeFinishReason('stop'), vertexMaas.FINISH_REASON.COMPLETE);
  assert.equal(vertexMaas.normalizeFinishReason('content_filter'), vertexMaas.FINISH_REASON.CONTENT_FILTER);
  assert.equal(vertexMaas.normalizeFinishReason(undefined), vertexMaas.FINISH_REASON.UNKNOWN);
  assert.equal(vertexMaas.normalizeFinishReason(null), vertexMaas.FINISH_REASON.UNKNOWN);
  assert.equal(vertexMaas.normalizeFinishReason('something_new'), vertexMaas.FINISH_REASON.UNKNOWN);
});

// === Review Finding #11 — call-ID normalization ============================
//
// A content-embedded tool call (extractToolCallFromContent) has no
// provider ID at all — MiniMax M2/Qwen3-Next both emit tool calls this
// way when message.tool_calls is empty (see that function's own file
// comment). An undefined callId is silently OMITTED by JSON.stringify
// (not serialized as null), so the eventual tool-result continuation
// message would reach the wire missing tool_call_id entirely, leaving
// the model no way to associate the result with its own prior call.

function contentEmbeddedToolCallResponse(name, args) {
  return jsonResponse({
    choices: [
      {
        finish_reason: 'stop',
        message: { content: `<tool_call>${JSON.stringify({ name, arguments: args })}</tool_call>`, tool_calls: null },
      },
    ],
  });
}

// --- Test 1: native tool call preserves provider ID -------------------------

test("completeWithTools: a native tool call keeps the provider's own ID unchanged", async () => {
  await withStubbedFetch(
    async () =>
      jsonResponse({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_provider_123',
                  type: 'function',
                  function: { name: 'get_attendance', arguments: '{"threshold":75}' },
                },
              ],
            },
          },
        ],
      }),
    async () => {
      const result = await vertexMaas.completeWithTools(baseCfg(), toolContext());
      assert.equal(result.callId, 'call_provider_123');

      const messages = vertexMaas.buildPriorTurnMessages([
        {
          toolName: result.toolName,
          arguments: result.arguments,
          callId: result.callId,
          rawToolCall: result.rawToolCall,
          resultText: 'ok',
        },
      ]);
      assert.equal(messages[1].tool_call_id, 'call_provider_123', 'no local ID must replace a valid provider ID');
    },
  );
});

// --- Test 2: content-embedded tool call receives a local ID -----------------

test('completeWithTools: a content-embedded tool call with no provider ID gets a non-empty local_ prefixed ID', async () => {
  await withStubbedFetch(
    async () => contentEmbeddedToolCallResponse('get_attendance', { threshold: 75 }),
    async () => {
      const result = await vertexMaas.completeWithTools(baseCfg(), toolContext());
      assert.equal(result.type, 'tool_call');
      assert.equal(result.toolName, 'get_attendance');
      assert.equal(typeof result.callId, 'string');
      assert.ok(result.callId.length > 0);
      assert.match(result.callId, /^local_/);
    },
  );
});

// --- Test 3: the same ID reaches the tool-result continuation, surviving JSON serialization ---

test('completeWithTools + buildPriorTurnMessages: the exact normalized callId from a content-embedded call reaches tool_call_id, and survives JSON.stringify/parse', async () => {
  let callId;
  await withStubbedFetch(
    async () => contentEmbeddedToolCallResponse('get_attendance', { threshold: 75 }),
    async () => {
      const result = await vertexMaas.completeWithTools(baseCfg(), toolContext());
      callId = result.callId;
    },
  );

  const messages = vertexMaas.buildPriorTurnMessages([
    {
      toolName: 'get_attendance',
      arguments: { threshold: 75 },
      callId,
      rawToolCall: undefined,
      resultText: '{"count":12}',
    },
  ]);
  const toolResultMessage = messages[1];
  assert.equal(toolResultMessage.role, 'tool');
  assert.equal(toolResultMessage.tool_call_id, callId);

  // The exact regression this finding exists to prevent: `undefined`
  // silently vanishing under JSON.stringify. Round-tripped through real
  // serialization (postJson's own JSON.stringify(body) call), not just
  // inspected as a JS object.
  const roundTripped = JSON.parse(JSON.stringify(messages));
  assert.ok(
    Object.prototype.hasOwnProperty.call(roundTripped[1], 'tool_call_id'),
    'tool_call_id must survive JSON serialization, never be dropped',
  );
  assert.equal(roundTripped[1].tool_call_id, callId);

  // The assistant-side prior-turn message must reference the SAME ID too
  // (a synthetic tool_calls entry, since rawToolCall was undefined for a
  // content-embedded call).
  assert.equal(messages[0].tool_calls[0].id, callId);
});

// --- Test 4: empty/invalid raw IDs ------------------------------------------

test('resolveToolCallId: every invalid raw ID form produces a valid non-empty local_ ID, never an empty/malformed one', () => {
  const invalidInputs = [undefined, null, '', '   ', 123, {}, []];
  const generated = invalidInputs.map((raw) => vertexMaas.resolveToolCallId(raw));
  generated.forEach((id) => {
    assert.equal(typeof id, 'string');
    assert.ok(id.trim().length > 0);
    assert.match(id, /^local_/);
  });
});

test('resolveToolCallId: a valid provider ID (including one needing only whitespace trimming) is preserved, never replaced', () => {
  assert.equal(vertexMaas.resolveToolCallId('call_abc'), 'call_abc');
  assert.equal(vertexMaas.resolveToolCallId('  call_abc  '), 'call_abc');
});

// --- Test 5: multiple calls — existing single-call scope, documented -------

test('completeWithTools: only the FIRST native tool_calls entry is used (pre-existing single-call scope, not extended by this finding) — it still gets a valid ID', async () => {
  await withStubbedFetch(
    async () =>
      jsonResponse({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                { id: 'call_first', type: 'function', function: { name: 'get_attendance', arguments: '{}' } },
                { id: 'call_second', type: 'function', function: { name: 'get_fee_status', arguments: '{}' } },
              ],
            },
          },
        ],
      }),
    async () => {
      const result = await vertexMaas.completeWithTools(baseCfg(), toolContext());
      assert.equal(result.toolName, 'get_attendance');
      assert.equal(result.callId, 'call_first');
    },
  );
});

test('resolveToolCallId: two separately generated local IDs (e.g. from two separate content-embedded calls) are never the same fallback constant', () => {
  const a = vertexMaas.resolveToolCallId(undefined);
  const b = vertexMaas.resolveToolCallId(undefined);
  assert.notEqual(a, b, 'no shared/constant fallback ID — each generated ID must be unique per invocation');
});

// --- Test 6: existing normal answer behavior is unaffected -------------------

test('completeWithTools: an ordinary plain-text answer (no tool call) is unaffected by call-ID normalization', async () => {
  await withStubbedFetch(
    async () =>
      jsonResponse({
        choices: [{ finish_reason: 'stop', message: { content: 'The answer is 42.', tool_calls: null } }],
      }),
    async () => {
      const result = await vertexMaas.completeWithTools(baseCfg(), toolContext());
      assert.equal(result.type, 'answer');
      assert.equal(result.text, 'The answer is 42.');
      assert.equal(result.callId, undefined, 'a plain answer never carries a callId at all');
    },
  );
});

// --- Test 7: defensive failure path -----------------------------------------

test('buildPriorTurnMessages: a prior turn with a missing/invalid callId is refused, never emitted as a tool_call_id-less message', () => {
  const invalidTurns = [
    { toolName: 't', arguments: {}, callId: undefined, resultText: 'x' },
    { toolName: 't', arguments: {}, callId: null, resultText: 'x' },
    { toolName: 't', arguments: {}, callId: '', resultText: 'x' },
    { toolName: 't', arguments: {}, callId: '   ', resultText: 'x' },
  ];
  invalidTurns.forEach((turn) => {
    assert.throws(
      () => vertexMaas.buildPriorTurnMessages([turn]),
      (err) => err instanceof LlmRequestError,
      `expected a thrown LlmRequestError for callId=${JSON.stringify(turn.callId)}`,
    );
  });
});
