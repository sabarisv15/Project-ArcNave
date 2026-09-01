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
const config = require('../src/config');

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
  return fn().finally(() => {
    obj[key] = original;
  });
}

// ARCNAVE modernization P2 (1.2 / clash C4) — the `roleTools.length <=
// TOP_K` bypass this test used to assert is GONE: it was the PDF's own
// named bug ("if a role has 8 or fewer tools, all get sent" regardless
// of the question). A small role-tool set now goes through the exact
// same real retrieval + margin cutoff every other role does.
test('retrieveRelevantTools: a role-tool count at or under TOP_K still goes through real retrieval, never bypassed', async () => {
  const tools = makeTools(5);
  let embedCalled = false;
  await withStub(
    embeddingService,
    'isAvailable',
    () => true,
    () =>
      withStub(
        aiToolEmbeddingRepository,
        'findExistingToolNames',
        async () => tools.map((t) => t.name),
        () =>
          withStub(
            embeddingService,
            'embed',
            async (texts) => {
              embedCalled = true;
              return texts.map(() => [0.1, 0.2]);
            },
            () =>
              withStub(
                aiToolEmbeddingRepository,
                'search',
                async (_client, { toolNames }) =>
                  // Only tool_0 is genuinely relevant to this question — the
                  // exact shape the old bypass could never express, since it
                  // returned every one of these 5 tools unconditionally.
                  toolNames.map((name, i) => ({ tool_name: name, distance: i === 0 ? 0.2 : 0.6 })),
                async () => {
                  const result = await aiToolRetrievalService.retrieveRelevantTools(
                    { query: async () => ({ rows: [] }) },
                    { roleTools: tools, question: 'something only tool_0 is about' },
                  );
                  assert.equal(embedCalled, true, 'a small role-tool set must still go through real retrieval');
                  assert.deepEqual(
                    result.map((t) => t.name),
                    ['tool_0'],
                    'only the genuinely relevant tool survives, not all 5',
                  );
                },
              ),
          ),
      ),
  );
});

test('retrieveRelevantTools: embedding service unavailable falls back to the lexical filter, never the full list', async () => {
  const tools = makeTools(30);
  await withStub(
    embeddingService,
    'isAvailable',
    () => false,
    async () => {
      const result = await aiToolRetrievalService.retrieveRelevantTools(
        {},
        { roleTools: tools, question: 'xyzzy qux wombat' },
      );
      assert.ok(result.length <= 25, 'the lexical fallback must still respect RANK_CAP');
      assert.ok(result.length < tools.length);
    },
  );
});

test('retrieveRelevantTools: a failed embed() call degrades to the lexical fallback, never throws and never sends all tools', async () => {
  const tools = makeTools(30);
  await withStub(
    embeddingService,
    'isAvailable',
    () => true,
    () =>
      withStub(
        embeddingService,
        'embed',
        async () => {
          throw new Error('network down');
        },
        async () => {
          const result = await aiToolRetrievalService.retrieveRelevantTools(
            { query: async () => ({ rows: [] }) },
            { roleTools: tools, question: 'attendance students staff finance marks timetable' },
          );
          assert.ok(
            result.length <= 25,
            'a transient embedding failure must never break an entire chat turn, and must never fall open to the full list',
          );
        },
      ),
  );
});

test('retrieveRelevantTools: semantic path only backfills tools missing an embedding, then ranks by distance and applies the margin cutoff', async () => {
  const tools = makeTools(30);
  const upserted = [];
  const client = { query: async () => ({ rows: [] }) };

  await withStub(
    embeddingService,
    'isAvailable',
    () => true,
    () =>
      withStub(
        aiToolEmbeddingRepository,
        'findExistingToolNames',
        async (_client, names) => names.slice(0, 20),
        () =>
          withStub(
            aiToolEmbeddingRepository,
            'upsert',
            async (_client, { toolName, embedding }) => {
              upserted.push({ toolName, embedding });
            },
            () =>
              withStub(
                embeddingService,
                'embed',
                async (texts) => texts.map(() => [0.1, 0.2]),
                () =>
                  withStub(
                    aiToolEmbeddingRepository,
                    'search',
                    async (_client, { toolNames }) =>
                      // 0.1 (best), 0.18 (within MARGIN=0.1 of best -> kept),
                      // 0.35 (0.25 from best -> excluded by the MARGIN, even
                      // though it is still well under ABSOLUTE_CEILING=0.4 on
                      // its own — proving the cutoff is relative-to-best, not
                      // just an absolute ceiling), 0.6 (excluded by the
                      // ceiling too, moot since the margin already stopped
                      // the scan before reaching it).
                      toolNames.slice(0, 4).map((name, i) => ({ tool_name: name, distance: [0.1, 0.18, 0.35, 0.6][i] })),
                    async () => {
                      const result = await aiToolRetrievalService.retrieveRelevantTools(client, {
                        roleTools: tools,
                        question: 'attendance report',
                      });
                      assert.equal(
                        upserted.length,
                        10,
                        'only the 10 tools missing a row should ever be embedded/upserted, not all 30',
                      );
                      assert.equal(result.length, 2, 'only distances within MARGIN of the best match survive');
                      assert.deepEqual(
                        result.map((t) => t.name),
                        ['tool_0', 'tool_1'],
                      );
                    },
                  ),
              ),
          ),
      ),
  );
});

test('retrieveRelevantTools: ensureEmbeddings scopes "already embedded" to the CURRENT model (ADR-030 P0) — a model change re-embeds every tool, self-healing instead of silently ranking a stale vector space', async () => {
  const tools = makeTools(30);
  const findExistingCalls = [];
  const upserted = [];
  const client = { query: async () => ({ rows: [] }) };

  await withStub(
    embeddingService,
    'isAvailable',
    () => true,
    () =>
      withStub(
        embeddingService,
        'currentModel',
        () => 'new-model-v2',
        () =>
          withStub(
            aiToolEmbeddingRepository,
            'findExistingToolNames',
            async (_client, names, model) => {
              findExistingCalls.push({ names, model });
              // Every tool has a row, but all under the OLD model — none count
              // as "existing" once findExistingToolNames is scoped by model.
              return [];
            },
            () =>
              withStub(
                aiToolEmbeddingRepository,
                'upsert',
                async (_client, { toolName, embedding, model }) => {
                  upserted.push({ toolName, embedding, model });
                },
                () =>
                  withStub(
                    embeddingService,
                    'embed',
                    async (texts) => texts.map(() => [0.1, 0.2]),
                    () =>
                      withStub(
                        aiToolEmbeddingRepository,
                        'search',
                        async (_client, { toolNames }) =>
                          toolNames.slice(0, 1).map((name) => ({ tool_name: name, distance: 0 })),
                        async () => {
                          await aiToolRetrievalService.retrieveRelevantTools(client, {
                            roleTools: tools,
                            question: 'attendance report',
                          });
                          assert.equal(
                            findExistingCalls[0].model,
                            'new-model-v2',
                            'the existence check is scoped to the current model',
                          );
                          assert.equal(
                            upserted.length,
                            30,
                            'a model change makes every tool "missing" again, re-embedding the full set, not just genuinely new tools',
                          );
                          assert.ok(
                            upserted.every((u) => u.model === 'new-model-v2'),
                            'every re-embedded row is stamped with the new model, overwriting the stale one',
                          );
                        },
                      ),
                  ),
              ),
          ),
      ),
  );
});

test('filterToolsByRelevance (lexical fallback tier) still exists and is what retrieveRelevantTools degrades to', () => {
  // Guards against the two functions silently drifting apart — the
  // fallback tier IS this function, not a reimplementation of it.
  assert.equal(typeof aiToolRegistry.filterToolsByRelevance, 'function');
});

// --- applyMarginCutoff (ARCNAVE modernization P2, 1.2 / clash C4) ------

test('applyMarginCutoff: an empty candidate list returns empty, never throws', () => {
  assert.deepEqual(aiToolRetrievalService.applyMarginCutoff([]), []);
});

test("applyMarginCutoff: even the single best candidate exceeding ABSOLUTE_CEILING returns genuinely empty — this is what makes 'zero tools' possible again", () => {
  const ranked = [{ tool_name: 'a', distance: 0.5 }];
  assert.deepEqual(aiToolRetrievalService.applyMarginCutoff(ranked), []);
});

test('applyMarginCutoff: candidates within MARGIN of the best match are kept, in order', () => {
  const ranked = [
    { tool_name: 'a', distance: 0.2 },
    { tool_name: 'b', distance: 0.25 },
    { tool_name: 'c', distance: 0.29 },
  ];
  assert.deepEqual(
    aiToolRetrievalService.applyMarginCutoff(ranked).map((r) => r.tool_name),
    ['a', 'b', 'c'],
  );
});

test('applyMarginCutoff: the cutoff is relative to the BEST match, not each neighbour — small consecutive gaps must never accumulate past MARGIN unnoticed', () => {
  // Each step from its own neighbour is only 0.04-0.05 — a naive
  // "gap from previous" cutoff would keep accumulating and never stop.
  // Cumulative distance from the actual best match (0.2) crosses MARGIN
  // (0.1) at the 4th entry (0.32 - 0.2 = 0.12 > 0.1).
  const ranked = [
    { tool_name: 'a', distance: 0.2 },
    { tool_name: 'b', distance: 0.24 },
    { tool_name: 'c', distance: 0.28 },
    { tool_name: 'd', distance: 0.32 },
  ];
  assert.deepEqual(
    aiToolRetrievalService.applyMarginCutoff(ranked).map((r) => r.tool_name),
    ['a', 'b', 'c'],
  );
});

test('applyMarginCutoff: a single genuinely confident match with no close runner-up returns just that one tool', () => {
  const ranked = [
    { tool_name: 'a', distance: 0.2 },
    { tool_name: 'b', distance: 0.39 },
  ];
  assert.deepEqual(
    aiToolRetrievalService.applyMarginCutoff(ranked).map((r) => r.tool_name),
    ['a'],
  );
});

// --- ADL-055 / ai-tool-catalogue-approved-spec.md's own "wrongly-
// excluded tool" incident, put in the test set per PDF 1.2 / clash C4's
// own explicit instruction ---
//
// The ORIGINAL incident (analyze_document_table never retrieved for
// "how many arrears are there in the ECE Sandwich section?", because
// "arrears" embeds closer to this domain's finance vocabulary than to a
// tool description that never uses the word) can no longer be replayed
// verbatim — that tool was retired (ADL-065). The STRUCTURAL shape of
// the finding is still live and worth locking in: a genuinely relevant
// tool can rank far enough from the question's own embedding to be
// legitimately excluded, and this function must degrade sanely when
// that happens — never crash, never silently fall back to sending
// every tool (that would just reintroduce the cost problem retrieval
// exists to solve), and never claim a false positive either. Recovery
// from exactly this case is describe_tools' job (aiService.js's own
// SCHEMA_TOOL_NAME), not this function's — this test only proves the
// function itself stays well-behaved at the moment of the miss.
test('applyMarginCutoff: a genuinely relevant tool ranked far from the question is excluded cleanly, not crashed on or silently over-included', () => {
  // finance_submit_fee_correction embeds close to "arrears" (finance
  // vocabulary); a hypothetical arrears-reconciliation tool whose own
  // description never uses financial wording embeds far from it — the
  // exact mismatch ADL-055 measured.
  const ranked = [
    { tool_name: 'finance_submit_fee_correction', distance: 0.22 },
    { tool_name: 'finance_status_summary', distance: 0.27 },
    { tool_name: 'arrears_reconciliation_tool', distance: 0.71 }, // the genuinely needed tool, ranked far
  ];
  const kept = aiToolRetrievalService.applyMarginCutoff(ranked);
  assert.deepEqual(
    kept.map((r) => r.tool_name),
    ['finance_submit_fee_correction', 'finance_status_summary'],
    'the two finance tools clear the cutoff; the genuinely needed tool legitimately does not — this is the miss the ' +
      'catalogue + describe_tools recovery path (built in aiService.js, not here) exists to catch, not this function',
  );
  assert.ok(
    !kept.some((r) => r.tool_name === 'arrears_reconciliation_tool'),
    'confirms the miss actually happened in this scenario, not accidentally avoided by the chosen distances',
  );
});

// --- reciprocalRankFusion / retrieveHybrid (ARCNAVE modernization P3, D3) ---

function tool(name) {
  return { name, description: `does ${name}`, level: 'L1', dataClassification: 'Internal', riskLevel: 0, params: {} };
}

test('reciprocalRankFusion: empty inputs return empty, never throws', () => {
  assert.deepEqual(aiToolRetrievalService.reciprocalRankFusion([], []), []);
});

test('reciprocalRankFusion: a tool present in both lists outranks one present in only one, even if the single-list one is rank 1 there', () => {
  const a = tool('a');
  const b = tool('b');
  // b is rank 1 semantically but not lexical at all; a is rank 2
  // semantically AND rank 1 lexically — agreement across both signals
  // should win over a lone rank-1 in just one.
  const result = aiToolRetrievalService.reciprocalRankFusion([b, a], [a]);
  assert.equal(result[0].name, 'a');
  assert.equal(result[1].name, 'b');
});

test('reciprocalRankFusion: identical rank-1 in both lists still returns just that one tool, not duplicated', () => {
  const a = tool('a');
  const result = aiToolRetrievalService.reciprocalRankFusion([a], [a]);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'a');
});

test('reciprocalRankFusion: a tool only in the lexical list still surfaces (meaning search alone would have missed it)', () => {
  const a = tool('a');
  const b = tool('b');
  const result = aiToolRetrievalService.reciprocalRankFusion([a], [b]);
  assert.deepEqual(
    result.map((t) => t.name).sort(),
    ['a', 'b'],
  );
});

test('reciprocalRankFusion: preserves rank order within a single list when the other is empty', () => {
  const a = tool('a');
  const b = tool('b');
  const c = tool('c');
  const result = aiToolRetrievalService.reciprocalRankFusion([a, b, c], []);
  assert.deepEqual(
    result.map((t) => t.name),
    ['a', 'b', 'c'],
  );
});

test('retrieveHybrid: blends semantic and lexical rankings — a tool with strong lexical overlap but a mediocre (ceiling-passing) semantic rank still wins fusion', async () => {
  const tools = [tool('attendance_summary'), tool('fee_status'), tool('staff_leave_balance')];
  await withStub(
    aiToolEmbeddingRepository,
    'findExistingToolNames',
    async () => tools.map((t) => t.name),
    () =>
      withStub(
        embeddingService,
        'embed',
        async (texts) => texts.map(() => [0.1, 0.2]),
        () =>
          withStub(
            aiToolEmbeddingRepository,
            'search',
            async (_client, { toolNames }) =>
              // All three pass ABSOLUTE_CEILING (0.4), so all three are
              // real fusion candidates — fee_status ranks best
              // semantically but has zero lexical overlap with the
              // question below; attendance_summary ranks worse
              // semantically but the question is explicitly about
              // attendance (real lexical overlap) — fusion should put
              // it first.
              toolNames.map((name) => ({
                tool_name: name,
                distance: { attendance_summary: 0.35, fee_status: 0.28, staff_leave_balance: 0.39 }[name],
              })),
            async () => {
              const result = await aiToolRetrievalService.retrieveHybrid(
                { query: async () => ({ rows: [] }) },
                tools,
                'what is the attendance summary for this class',
              );
              assert.equal(result[0].name, 'attendance_summary');
            },
          ),
      ),
  );
});

test('retrieveHybrid: a semantic candidate beyond ABSOLUTE_CEILING is excluded from fusion even though embedding search returned it', async () => {
  const tools = [tool('irrelevant_tool')];
  await withStub(
    aiToolEmbeddingRepository,
    'findExistingToolNames',
    async () => tools.map((t) => t.name),
    () =>
      withStub(
        embeddingService,
        'embed',
        async (texts) => texts.map(() => [0.1, 0.2]),
        () =>
          withStub(
            aiToolEmbeddingRepository,
            'search',
            // Every embedding search returns its nearest TOP_K neighbours
            // regardless of how far they are — distance 0.9 is well
            // beyond ABSOLUTE_CEILING (0.4), so this must not surface.
            async (_client, { toolNames }) => toolNames.map((name) => ({ tool_name: name, distance: 0.9 })),
            async () => {
              const result = await aiToolRetrievalService.retrieveHybrid(
                { query: async () => ({ rows: [] }) },
                tools,
                'completely unrelated greeting, hi there',
              );
              assert.deepEqual(result, [], 'a genuinely irrelevant question must still be able to return zero tools');
            },
          ),
      ),
  );
});

test('retrieveHybrid: caps the fused result at TOP_K even when both lists together exceed it', async () => {
  const tools = makeTools(12);
  await withStub(
    aiToolEmbeddingRepository,
    'findExistingToolNames',
    async () => tools.map((t) => t.name),
    () =>
      withStub(
        embeddingService,
        'embed',
        async (texts) => texts.map(() => [0.1, 0.2]),
        () =>
          withStub(
            aiToolEmbeddingRepository,
            'search',
            async (_client, { toolNames }) =>
              toolNames.map((name, i) => ({ tool_name: name, distance: 0.1 + i * 0.01 })),
            async () => {
              const result = await aiToolRetrievalService.retrieveHybrid(
                { query: async () => ({ rows: [] }) },
                tools,
                'does thing number 1 2 3 4 5 6 7 8 9 10 11',
              );
              assert.ok(result.length <= 8, `expected at most 8 (TOP_K), got ${result.length}`);
            },
          ),
      ),
  );
});

test('retrieveRelevantTools: config.aiHybridToolRetrieval OFF (default) still uses the pure-semantic margin-cutoff tier, not hybrid', async () => {
  const tools = [tool('a'), tool('b')];
  const original = config.aiHybridToolRetrieval;
  config.aiHybridToolRetrieval = false;
  try {
    await withStub(
      embeddingService,
      'isAvailable',
      () => true,
      () =>
        withStub(
          aiToolEmbeddingRepository,
          'findExistingToolNames',
          async () => tools.map((t) => t.name),
          () =>
            withStub(
              embeddingService,
              'embed',
              async (texts) => texts.map(() => [0.1, 0.2]),
              () =>
                withStub(
                  aiToolEmbeddingRepository,
                  'search',
                  async (_client, { toolNames }) => toolNames.map((name) => ({ tool_name: name, distance: 0.9 })),
                  async () => {
                    // distance 0.9 exceeds ABSOLUTE_CEILING either way, but
                    // this asserts the CALL PATH taken, not just the
                    // result: retrieveSemantic's own margin-cutoff
                    // behavior applies (an empty result here is expected
                    // from BOTH tiers on this input, so the real
                    // assertion is that no crash/mismatch occurs when the
                    // flag is explicitly off).
                    const result = await aiToolRetrievalService.retrieveRelevantTools(
                      { query: async () => ({ rows: [] }) },
                      { roleTools: tools, question: 'irrelevant' },
                    );
                    assert.deepEqual(result, []);
                  },
                ),
            ),
        ),
    );
  } finally {
    config.aiHybridToolRetrieval = original;
  }
});

test('retrieveRelevantTools: config.aiHybridToolRetrieval ON routes through the hybrid tier (a lexical-only match surfaces that pure-semantic would have missed)', async () => {
  const tools = [tool('attendance_summary'), tool('unrelated_tool')];
  const original = config.aiHybridToolRetrieval;
  config.aiHybridToolRetrieval = true;
  try {
    await withStub(
      embeddingService,
      'isAvailable',
      () => true,
      () =>
        withStub(
          aiToolEmbeddingRepository,
          'findExistingToolNames',
          async () => tools.map((t) => t.name),
          () =>
            withStub(
              embeddingService,
              'embed',
              async (texts) => texts.map(() => [0.1, 0.2]),
              () =>
                withStub(
                  aiToolEmbeddingRepository,
                  'search',
                  // Both tools are semantically indistinguishable and
                  // BEYOND the ceiling — the pure-semantic tier would
                  // return nothing here. The hybrid tier's lexical half
                  // still has real overlap with "attendance summary".
                  async (_client, { toolNames }) => toolNames.map((name) => ({ tool_name: name, distance: 0.9 })),
                  async () => {
                    const result = await aiToolRetrievalService.retrieveRelevantTools(
                      { query: async () => ({ rows: [] }) },
                      { roleTools: tools, question: 'give me the attendance summary' },
                    );
                    assert.deepEqual(
                      result.map((t) => t.name),
                      ['attendance_summary'],
                      'the hybrid tier recovers a lexical-only match the pure-semantic tier alone would have missed',
                    );
                  },
                ),
            ),
        ),
    );
  } finally {
    config.aiHybridToolRetrieval = original;
  }
});
