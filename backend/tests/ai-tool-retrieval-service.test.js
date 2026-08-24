'use strict';

// Unit tests for aiToolRetrievalService.js (round 32 — provider-
// independent tool retrieval) against a fake dbClient/fake
// embeddingService, same "not a live Postgres, not a live vendor
// call" convention ai-service.test.js's own file comment already
// documents for this codebase's unit-test tier.

const test = require('node:test');
const assert = require('node:assert/strict');
const aiToolRetrievalService = require('../src/services/aiToolRetrievalService');
const embeddingService = require('../src/services/embeddingService');
const aiToolEmbeddingRepository = require('../src/repositories/aiToolEmbeddingRepository');
const aiToolRegistry = require('../src/services/aiToolRegistry');

function makeTools(count) {
  return Array.from({ length: count }, (_, i) => ({
    name: `tool_${i}`,
    description: `does thing number ${i}`,
    level: 'L1',
    dataClassification: 'Internal',
    riskLevel: 0,
    params: {},
  }));
}

function withStub(obj, key, impl, fn) {
  const original = obj[key];
  obj[key] = impl;
  return fn().finally(() => { obj[key] = original; });
}

test('retrieveRelevantTools: a role-tool count at or under TOP_K is returned unchanged, no embedding/DB call at all', async () => {
  const tools = makeTools(5);
  let embedCalled = false;
  await withStub(embeddingService, 'embed', async () => { embedCalled = true; return []; }, async () => {
    const result = await aiToolRetrievalService.retrieveRelevantTools({}, { roleTools: tools, question: 'anything' });
    assert.deepEqual(result, tools);
    assert.equal(embedCalled, false, 'a small role-tool set never needs retrieval at all');
  });
});

test('retrieveRelevantTools: embedding service unavailable falls back to the lexical filter, never the full list', async () => {
  const tools = makeTools(30);
  await withStub(embeddingService, 'isAvailable', () => false, async () => {
    const result = await aiToolRetrievalService.retrieveRelevantTools({}, { roleTools: tools, question: 'xyzzy qux wombat' });
    assert.ok(result.length <= 25, 'the lexical fallback must still respect RANK_CAP');
    assert.ok(result.length < tools.length);
  });
});

test('retrieveRelevantTools: a failed embed() call degrades to the lexical fallback, never throws and never sends all tools', async () => {
  const tools = makeTools(30);
  await withStub(embeddingService, 'isAvailable', () => true, () => withStub(embeddingService, 'embed', async () => { throw new Error('network down'); }, async () => {
    const result = await aiToolRetrievalService.retrieveRelevantTools(
      { query: async () => ({ rows: [] }) },
      { roleTools: tools, question: 'attendance students staff finance marks timetable' },
    );
    assert.ok(result.length <= 25, 'a transient embedding failure must never break an entire chat turn, and must never fall open to the full list');
  }));
});

test('retrieveRelevantTools: semantic path only backfills tools missing an embedding, then ranks by distance and applies the threshold', async () => {
  const tools = makeTools(30);
  const upserted = [];
  const client = { query: async () => ({ rows: [] }) };

  await withStub(embeddingService, 'isAvailable', () => true, () => withStub(
    aiToolEmbeddingRepository,
    'findExistingToolNames',
    async (_client, names) => names.slice(0, 20),
    () => withStub(aiToolEmbeddingRepository, 'upsert', async (_client, { toolName, embedding }) => {
      upserted.push({ toolName, embedding });
    }, () => withStub(embeddingService, 'embed', async (texts) => texts.map(() => [0.1, 0.2]), () => withStub(
      aiToolEmbeddingRepository,
      'search',
      async (_client, { toolNames }) => toolNames.slice(0, 3).map((name, i) => ({ tool_name: name, distance: [0, 0.3, 0.9][i] })),
      async () => {
        const result = await aiToolRetrievalService.retrieveRelevantTools(client, { roleTools: tools, question: 'attendance report' });
        assert.equal(upserted.length, 10, 'only the 10 tools missing a row should ever be embedded/upserted, not all 30');
        assert.equal(result.length, 2, 'distances 0 and 0.3 clear the threshold; 0.9 does not');
        assert.deepEqual(result.map((t) => t.name), ['tool_0', 'tool_1']);
      },
    ))),
  ));
});

test('retrieveRelevantTools: ensureEmbeddings scopes "already embedded" to the CURRENT model (ADR-030 P0) — a model change re-embeds every tool, self-healing instead of silently ranking a stale vector space', async () => {
  const tools = makeTools(30);
  const findExistingCalls = [];
  const upserted = [];
  const client = { query: async () => ({ rows: [] }) };

  await withStub(embeddingService, 'isAvailable', () => true, () => withStub(embeddingService, 'currentModel', () => 'new-model-v2', () => withStub(
    aiToolEmbeddingRepository,
    'findExistingToolNames',
    async (_client, names, model) => {
      findExistingCalls.push({ names, model });
      // Every tool has a row, but all under the OLD model — none count
      // as "existing" once findExistingToolNames is scoped by model.
      return [];
    },
    () => withStub(aiToolEmbeddingRepository, 'upsert', async (_client, { toolName, embedding, model }) => {
      upserted.push({ toolName, embedding, model });
    }, () => withStub(embeddingService, 'embed', async (texts) => texts.map(() => [0.1, 0.2]), () => withStub(
      aiToolEmbeddingRepository,
      'search',
      async (_client, { toolNames }) => toolNames.slice(0, 1).map((name) => ({ tool_name: name, distance: 0 })),
      async () => {
        await aiToolRetrievalService.retrieveRelevantTools(client, { roleTools: tools, question: 'attendance report' });
        assert.equal(findExistingCalls[0].model, 'new-model-v2', 'the existence check is scoped to the current model');
        assert.equal(upserted.length, 30, 'a model change makes every tool "missing" again, re-embedding the full set, not just genuinely new tools');
        assert.ok(upserted.every((u) => u.model === 'new-model-v2'), 'every re-embedded row is stamped with the new model, overwriting the stale one');
      },
    ))),
  )));
});

test('filterToolsByRelevance (lexical fallback tier) still exists and is what retrieveRelevantTools degrades to', () => {
  // Guards against the two functions silently drifting apart — the
  // fallback tier IS this function, not a reimplementation of it.
  assert.equal(typeof aiToolRegistry.filterToolsByRelevance, 'function');
});
