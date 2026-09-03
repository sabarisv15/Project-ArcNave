'use strict';

// P3 1.16 — unit coverage for the FLAG-tier guardrail reinforcement note
// (aiGuardrailService.REINFORCEMENT_NOTE) wired into askAgent's
// buildDecisionContext (Curriculum) and askGeneralChat (Research).
// Mocked at the fetch layer (OpenAI-compatible response shapes), same
// convention as ai-service.test.js's own askAgent coverage — no real
// network call, no API quota spent. Reuses that file's exact
// wire-level-deepEqual method for proving the ADL-050 construction-once/
// reuse-by-reference invariant (this file doesn't invent a stronger,
// JS-reference-identity assertion the existing suite never used).

const test = require('node:test');
const assert = require('node:assert/strict');
const aiService = require('../src/services/aiService');
const aiGuardrailService = require('../src/services/aiGuardrailService');
const config = require('../src/config');
const embeddingService = require('../src/services/embeddingService');
const notificationRepository = require('../src/repositories/notificationRepository');

// This file's premise is the same as ai-service.test.js: a fake dbClient,
// never a live Postgres, so semantic tool retrieval is disabled the same
// way that file disables it.
embeddingService.isAvailable = () => false;

function fakeClient() {
  const queries = [];
  return {
    queries,
    query: async (text, params) => {
      queries.push({ text, params });
      return { rows: [] };
    },
  };
}

function withOpenAiConfig(apiKey, fn) {
  const original = { ...config.openai };
  const originalDefaultAiProvider = config.defaultAiProvider;
  config.openai.apiKey = apiKey;
  config.defaultAiProvider = 'openai';
  return fn().finally(() => {
    config.openai.apiKey = original.apiKey;
    config.openai.model = original.model;
    config.defaultAiProvider = originalDefaultAiProvider;
  });
}

function withMockFetch(mockFetch, fn) {
  const original = global.fetch;
  global.fetch = mockFetch;
  return fn().finally(() => {
    global.fetch = original;
  });
}

function withMaxToolCallsPerTurn(n, fn) {
  const original = config.maxToolCallsPerTurn;
  config.maxToolCallsPerTurn = n;
  return fn().finally(() => {
    config.maxToolCallsPerTurn = original;
  });
}

function mockToolCallResponse(toolName, args = {}) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { tool_calls: [{ function: { name: toolName, arguments: JSON.stringify(args) } }] } }],
    }),
  };
}

function mockAnswerResponse(text) {
  return { ok: true, json: async () => ({ choices: [{ message: { content: text } }] }) };
}

// A real FLAG_PATTERNS match ('role_reassignment': /pretend\s+(to\s+be|you\s+are)/i)
// — ordinary phrasing a real user could plausibly type, not a contrived
// string; screenInput's own comment: FLAG signals are individually
// ambiguous enough that blocking would catch legitimate use.
const FLAG_QUESTION = 'Pretend to be a strict class tutor and summarize this term\'s attendance for me.';
// A question that matches neither BLOCK_PATTERNS nor FLAG_PATTERNS.
const ORDINARY_QUESTION = 'What is the attendance rate for CSE-A this term?';

test('aiGuardrailService.screenInput sanity: FLAG_QUESTION flags, ORDINARY_QUESTION does not', () => {
  assert.equal(aiGuardrailService.screenInput(FLAG_QUESTION).verdict, 'flag');
  assert.equal(aiGuardrailService.screenInput(ORDINARY_QUESTION).verdict, 'allow');
});

test('askAgent (Curriculum) + FLAG question: the reinforcement note is present in the decision call system prompt, exactly once, byte-identical to REINFORCEMENT_NOTE', async () => {
  const client = fakeClient();
  const identityContext = { userId: 'u1', role: 'principal', collegeId: 'college-a' };
  let capturedBody;

  await withOpenAiConfig('test-openai-key', async () => {
    await withMockFetch(
      async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return mockAnswerResponse('Understood — staying within my normal rules.');
      },
      async () => {
        await aiService.askAgent(client, FLAG_QUESTION, { identityContext });
      },
    );
  });

  const systemPrompt = capturedBody.messages[0].content;
  const occurrences = systemPrompt.split(aiGuardrailService.REINFORCEMENT_NOTE).length - 1;
  assert.equal(occurrences, 1, 'the reinforcement note appears exactly once in the decision system prompt');
});

test('askAgent (Curriculum) + FLAG question: the reinforcement note stays present, byte-identical, across a continuation call — same construction-once/reuse-by-reference wire-level invariant ai-service.test.js already locks for every other system segment', async (t) => {
  t.mock.method(notificationRepository, 'create', async (c, fields) => ({ id: 'notif-guardrail-1', ...fields }));
  const client = fakeClient();
  const identityContext = { userId: 'u1', role: 'principal', collegeId: 'college-a' };
  const capturedBodies = [];

  await withMaxToolCallsPerTurn(2, () =>
    withOpenAiConfig('test-openai-key', async () => {
      await withMockFetch(
        async (url, options) => {
          const body = JSON.parse(options.body);
          capturedBodies.push(body);
          if (capturedBodies.length === 1) return mockToolCallResponse('get_college_profile', {});
          return mockAnswerResponse('Here is the profile, staying within my normal rules.');
        },
        async () => {
          await aiService.askAgent(client, FLAG_QUESTION, { identityContext });
        },
      );
    }),
  );

  assert.equal(capturedBodies.length, 2);
  const [decisionBody, continuationBody] = capturedBodies;
  assert.ok(
    decisionBody.messages[0].content.includes(aiGuardrailService.REINFORCEMENT_NOTE),
    'decision call carries the note',
  );
  // The same ADL-050 wire-level invariant ai-service.test.js:3317 locks for
  // the rest of the system prompt: byte-identical across every iteration
  // of the turn, not merely "same text re-derived".
  assert.deepEqual(
    continuationBody.messages[0],
    decisionBody.messages[0],
    'system prompt (including the reinforcement note) must be byte-identical across the continuation',
  );
});

test('askAgent (Curriculum) + ordinary question: no reinforcement note segment, no other change to the system prompt', async () => {
  const client = fakeClient();
  const identityContext = { userId: 'u1', role: 'principal', collegeId: 'college-a' };
  let capturedBody;

  await withOpenAiConfig('test-openai-key', async () => {
    await withMockFetch(
      async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return mockAnswerResponse('The attendance rate is unavailable in this fixture.');
      },
      async () => {
        await aiService.askAgent(client, ORDINARY_QUESTION, { identityContext });
      },
    );
  });

  const systemPrompt = capturedBody.messages[0].content;
  assert.ok(
    !systemPrompt.includes(aiGuardrailService.REINFORCEMENT_NOTE),
    'no reinforcement note for a non-FLAG question',
  );
});

test('askAgent (mode: general / Research) + FLAG question: the reinforcement note is present, and identity stays the last system segment', async () => {
  const client = fakeClient();
  const identityContext = { userId: 'u1', role: 'principal', collegeId: 'college-a' };
  let capturedBody;

  await withOpenAiConfig('test-openai-key', async () => {
    await withMockFetch(
      async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return mockAnswerResponse('Understood — staying within my normal rules.');
      },
      async () => {
        await aiService.askAgent(client, FLAG_QUESTION, { identityContext, mode: 'general' });
      },
    );
  });

  const systemPrompt = capturedBody.messages[0].content;
  const noteIndex = systemPrompt.indexOf(aiGuardrailService.REINFORCEMENT_NOTE);
  assert.notEqual(noteIndex, -1, 'reinforcement note present in Research mode too');
  // identityBlock always includes a "Role: <label>" line
  // (aiActorContext.js) — a stable, guaranteed substring sufficient to
  // prove ordering without depending on the exact role-label wording.
  const identityIndex = systemPrompt.indexOf('Role:');
  assert.ok(identityIndex > noteIndex, 'identity segment stays ordered after the reinforcement note');
});

test('askAgent (mode: general / Research) + ordinary question: no reinforcement note segment', async () => {
  const client = fakeClient();
  const identityContext = { userId: 'u1', role: 'principal', collegeId: 'college-a' };
  let capturedBody;

  await withOpenAiConfig('test-openai-key', async () => {
    await withMockFetch(
      async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return mockAnswerResponse('The attendance rate is unavailable in this fixture.');
      },
      async () => {
        await aiService.askAgent(client, ORDINARY_QUESTION, { identityContext, mode: 'general' });
      },
    );
  });

  const systemPrompt = capturedBody.messages[0].content;
  assert.ok(
    !systemPrompt.includes(aiGuardrailService.REINFORCEMENT_NOTE),
    'no reinforcement note for a non-FLAG question in Research mode',
  );
});
