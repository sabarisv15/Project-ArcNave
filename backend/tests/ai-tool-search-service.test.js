'use strict';

// Unit tests for aiToolSearchService.js (Priority 1, Phase 1 — Tool
// Search) against a fake dbClient/stubbed configurationService and
// aiToolRetrievalService, same "not a live Postgres, not a live vendor
// call" convention ai-tool-retrieval-service.test.js's own file comment
// already documents for this codebase's unit-test tier. Same withStub
// pattern that file already established.

const test = require('node:test');
const assert = require('node:assert/strict');
const aiToolSearchService = require('../src/services/aiToolSearchService');
const configurationService = require('../src/services/configurationService');
const aiToolRetrievalService = require('../src/services/aiToolRetrievalService');

function withStub(obj, key, impl, fn) {
  const original = obj[key];
  obj[key] = impl;
  return fn().finally(() => { obj[key] = original; });
}

function makeTools(count) {
  return Array.from({ length: count }, (_, i) => ({
    name: `tool_${i}`, description: `does thing number ${i}.`, params: {},
  }));
}

// A stand-in for whatever getToolSearchConfig() would return when
// enabled — the real shape ({provider, config, adapter}), with a
// caller-supplied fake adapter so no real Vertex MaaS call ever happens.
function enabledConfig(completeWithTools) {
  return { provider: 'vertex_maas', config: {}, adapter: { completeWithTools } };
}

// coverageStatus defaults to 'complete' here — every pre-existing test
// using this helper represents a selection that was always meant to be
// trusted as-is, and defaulting it any other way would silently route
// them all through the new uncertain/insufficient recovery path below.
function toolCallDecision(names, { coverageStatus = 'complete', uncoveredRequirements } = {}) {
  return {
    type: 'tool_call',
    toolName: aiToolSearchService.SELECT_TOOLS_META_TOOL_NAME,
    arguments: { names, coverageStatus, ...(uncoveredRequirements ? { uncoveredRequirements } : {}) },
  };
}

test('discoverRelevantTools: valid tool-name selection is returned with viaToolSearch true', async () => {
  const tools = makeTools(5);
  await withStub(configurationService, 'getToolSearchConfig', () => enabledConfig(
    async () => toolCallDecision(['tool_0', 'tool_2']),
  ), async () => {
    const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'q' });
    assert.deepEqual(result.tools.map((t) => t.name), ['tool_0', 'tool_2']);
    assert.equal(result.viaToolSearch, true);
  });
});

test('discoverRelevantTools: a double-encoded names string (real quirk measured against minimaxai/minimax-m2-maas) is still parsed and validated correctly', async () => {
  const tools = makeTools(5);
  await withStub(configurationService, 'getToolSearchConfig', () => enabledConfig(
    async () => ({
      type: 'tool_call',
      toolName: aiToolSearchService.SELECT_TOOLS_META_TOOL_NAME,
      arguments: { names: '["tool_0","tool_1"]', coverageStatus: 'complete' },
    }),
  ), async () => {
    const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'q' });
    assert.deepEqual(result.tools.map((t) => t.name), ['tool_0', 'tool_1']);
    assert.equal(result.viaToolSearch, true);
  });
});

test('discoverRelevantTools: a names string that is not valid JSON falls back rather than throwing', async () => {
  const tools = makeTools(5);
  await withStub(aiToolRetrievalService, 'retrieveRelevantTools', async () => [tools[0]], () => withStub(
    configurationService,
    'getToolSearchConfig',
    () => enabledConfig(async () => ({
      type: 'tool_call', toolName: aiToolSearchService.SELECT_TOOLS_META_TOOL_NAME, arguments: { names: 'not json at all' },
    })),
    async () => {
      const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'q' });
      assert.equal(result.viaToolSearch, false);
      assert.deepEqual(result.tools, [tools[0]]);
    },
  ));
});

test('discoverRelevantTools: a name with stray leading/trailing whitespace (real quirk measured against qwen/qwen3-next-80b-a3b-thinking-maas) still matches, not rejected as invalid', async () => {
  const tools = makeTools(5);
  await withStub(configurationService, 'getToolSearchConfig', () => enabledConfig(
    async () => toolCallDecision([' tool_0', 'tool_1 ']),
  ), async () => {
    const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'q' });
    assert.deepEqual(result.tools.map((t) => t.name), ['tool_0', 'tool_1']);
  });
});

test('discoverRelevantTools: a name outside roleTools is rejected, never trusted blindly', async () => {
  const tools = makeTools(5);
  await withStub(configurationService, 'getToolSearchConfig', () => enabledConfig(
    async () => toolCallDecision(['tool_0', 'fake_admin_delete_everything']),
  ), async () => {
    const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'q' });
    assert.deepEqual(result.tools.map((t) => t.name), ['tool_0']);
  });
});

test('discoverRelevantTools: duplicate names are deduped', async () => {
  const tools = makeTools(5);
  await withStub(configurationService, 'getToolSearchConfig', () => enabledConfig(
    async () => toolCallDecision(['tool_0', 'tool_0', 'tool_1']),
  ), async () => {
    const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'q' });
    assert.deepEqual(result.tools.map((t) => t.name), ['tool_0', 'tool_1']);
  });
});

test('discoverRelevantTools: dynamic tool count — a simple question returns 1, a compound one returns more, no fixed K', async () => {
  const tools = makeTools(10);
  await withStub(configurationService, 'getToolSearchConfig', () => enabledConfig(
    async () => toolCallDecision(['tool_3']),
  ), async () => {
    const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'simple' });
    assert.equal(result.tools.length, 1);
  });
  await withStub(configurationService, 'getToolSearchConfig', () => enabledConfig(
    async () => toolCallDecision(['tool_1', 'tool_2', 'tool_3', 'tool_4', 'tool_5']),
  ), async () => {
    const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'compound' });
    assert.equal(result.tools.length, 5);
  });
});

test('discoverRelevantTools: a pathological response is capped at MAX_TOOL_SEARCH_RESULTS, never unbounded', async () => {
  const tools = makeTools(50);
  await withStub(configurationService, 'getToolSearchConfig', () => enabledConfig(
    async () => toolCallDecision(tools.map((t) => t.name)),
  ), async () => {
    const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'q' });
    assert.equal(result.tools.length, aiToolSearchService.MAX_TOOL_SEARCH_RESULTS);
  });
});

test('discoverRelevantTools: a prose (non-tool-call) response is not trusted and falls back', async () => {
  const tools = makeTools(5);
  const client = {};
  await withStub(aiToolRetrievalService, 'retrieveRelevantTools', async () => [tools[0]], () => withStub(
    configurationService,
    'getToolSearchConfig',
    () => enabledConfig(async () => ({ type: 'answer', text: 'I think tool_0 fits.' })),
    async () => {
      const result = await aiToolSearchService.discoverRelevantTools(client, { roleTools: tools, question: 'q' });
      assert.equal(result.viaToolSearch, false);
      assert.deepEqual(result.tools, [tools[0]]);
    },
  ));
});

test('discoverRelevantTools: a provider timeout/network failure falls back, never throws out of a chat turn', async () => {
  const tools = makeTools(5);
  await withStub(aiToolRetrievalService, 'retrieveRelevantTools', async () => [tools[1]], () => withStub(
    configurationService,
    'getToolSearchConfig',
    () => enabledConfig(async () => { throw new Error('request timed out'); }),
    async () => {
      const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'q' });
      assert.equal(result.viaToolSearch, false);
      assert.deepEqual(result.tools, [tools[1]]);
    },
  ));
});

test('discoverRelevantTools: a provider/config error (LlmNotConfiguredError-shaped) falls back', async () => {
  const tools = makeTools(5);
  await withStub(aiToolRetrievalService, 'retrieveRelevantTools', async () => [tools[2]], () => withStub(
    configurationService,
    'getToolSearchConfig',
    () => enabledConfig(async () => { throw new Error('no Vertex AI MaaS provider is configured'); }),
    async () => {
      const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'q' });
      assert.equal(result.viaToolSearch, false);
      assert.deepEqual(result.tools, [tools[2]]);
    },
  ));
});

test('discoverRelevantTools: a response where every returned name is invalid falls back rather than proceeding with zero tools and no catalogue', async () => {
  const tools = makeTools(5);
  await withStub(aiToolRetrievalService, 'retrieveRelevantTools', async () => [tools[0], tools[1]], () => withStub(
    configurationService,
    'getToolSearchConfig',
    () => enabledConfig(async () => toolCallDecision(['hallucinated_tool_a', 'hallucinated_tool_b'])),
    async () => {
      const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'q' });
      assert.equal(result.viaToolSearch, false, 'all-invalid names must not be trusted as a genuine empty answer');
      assert.deepEqual(result.tools.map((t) => t.name), ['tool_0', 'tool_1']);
    },
  ));
});

test('discoverRelevantTools: on the fallback path, aiToolRetrievalService.retrieveRelevantTools is actually called with the same args', async () => {
  const tools = makeTools(5);
  const calls = [];
  const client = { marker: 'fake-client' };
  await withStub(aiToolRetrievalService, 'retrieveRelevantTools', async (c, args) => {
    calls.push({ c, args });
    return [];
  }, () => withStub(
    configurationService,
    'getToolSearchConfig',
    () => null,
    async () => {
      await aiToolSearchService.discoverRelevantTools(client, { roleTools: tools, question: 'q' });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].c, client);
      assert.deepEqual(calls[0].args, { roleTools: tools, question: 'q' });
    },
  ));
});

test('discoverRelevantTools: disabled (getToolSearchConfig returns null) reproduces the old path byte-for-byte, no adapter ever called', async () => {
  const tools = makeTools(5);
  let adapterCalled = false;
  const sentinel = [tools[3]];
  await withStub(aiToolRetrievalService, 'retrieveRelevantTools', async () => sentinel, () => withStub(
    configurationService,
    'getToolSearchConfig',
    () => { adapterCalled = true; return null; },
    async () => {
      const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'q' });
      assert.deepEqual(result.tools, sentinel);
      assert.equal(result.viaToolSearch, false);
    },
  ));
  // getToolSearchConfig itself was called (that's how "disabled" is
  // discovered) — but no completeWithTools was ever invoked, since no
  // adapter object was ever returned to call it on.
  assert.equal(adapterCalled, true);
});

test('discoverRelevantTools: no identityContext/credentials are ever passed into the Tool Search call', async () => {
  const tools = makeTools(3);
  let capturedContext;
  await withStub(configurationService, 'getToolSearchConfig', () => enabledConfig(async (cfg, context) => {
    capturedContext = context;
    return toolCallDecision(['tool_0']);
  }), async () => {
    // The function signature itself never accepts identityContext — only
    // roleTools/question — so there is structurally nothing to leak here.
    await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'what is my attendance' });
  });
  const serialized = JSON.stringify(capturedContext);
  assert.ok(!/identityContext|apiKey|password|token|collegeId/i.test(serialized), 'no identity/credential data reached the Tool Search context');
});

// Regression pin for the schema-key bug: the meta-tool was built with
// `parameters:` while every provider adapter (aiToolRegistry.js,
// vertexMaas.js, selfHosted.js, openai.js, gemini.js, claude.js) reads a
// tool's schema from `tool.params` — so the schema silently never reached
// the model and every real call fell back to keyword retrieval. Asserted
// against the actual object handed to `adapter.completeWithTools`, the
// same object any real adapter reads `.params` from.
test('discoverRelevantTools: the select_relevant_tools meta-tool schema is built under `params`, the adapter-wide contract — never `parameters`', async () => {
  const tools = makeTools(5);
  let capturedContext;
  await withStub(configurationService, 'getToolSearchConfig', () => enabledConfig(async (cfg, context) => {
    capturedContext = context;
    return toolCallDecision(['tool_0']);
  }), async () => {
    await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'q' });
  });

  const metaTool = capturedContext.tools.find((t) => t.name === aiToolSearchService.SELECT_TOOLS_META_TOOL_NAME);
  assert.ok(metaTool, 'the select_relevant_tools meta-tool must be offered to the model');
  assert.equal(metaTool.parameters, undefined, 'the old `parameters` key must not be used — no adapter reads it');
  assert.ok(metaTool.params, 'the schema must be present under `params`, the key every adapter actually reads');
  assert.equal(metaTool.params.type, 'object');
  assert.deepEqual(metaTool.params.required, ['names', 'coverageStatus']);
  assert.equal(metaTool.params.properties.names.type, 'array');
  assert.equal(metaTool.params.properties.names.items.type, 'string');
  // Review Finding #8 — coverage self-assessment is part of the schema
  // contract, not a bolt-on freeform field.
  assert.deepEqual(metaTool.params.properties.coverageStatus.enum, ['complete', 'uncertain', 'insufficient']);
  assert.equal(metaTool.params.properties.uncoveredRequirements.type, 'array');
});

test('discoverRelevantTools: an empty roleTools set short-circuits to the fallback shape with no calls at all', async () => {
  let configResolved = false;
  await withStub(configurationService, 'getToolSearchConfig', () => { configResolved = true; return null; }, async () => {
    const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: [], question: 'q' });
    assert.deepEqual(result, { tools: [], viaToolSearch: false, usage: undefined });
  });
  assert.equal(configResolved, false, 'nothing to search for zero tools — never even resolves a Tool Search config');
});

// --- Review Finding #8: coverage-status honesty and recovery ---------
//
// A valid selected tool name is not the same claim as "this set is
// sufficient". The tests below use a stand-in multi-domain question
// (attendance + fee-due) to exercise the three coverageStatus values the
// model can now self-report, and the broader-retrieval recovery attempt
// that follows an uncertain/insufficient one.

test('coverage complete: valid selection proceeds normally, no broader-catalogue fallback is attempted', async () => {
  const tools = makeTools(5);
  let retrievalCalled = false;
  await withStub(aiToolRetrievalService, 'retrieveRelevantTools', async () => { retrievalCalled = true; return []; }, () => withStub(
    configurationService,
    'getToolSearchConfig',
    () => enabledConfig(async () => toolCallDecision(['tool_0', 'tool_1'], { coverageStatus: 'complete' })),
    async () => {
      const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'attendance only' });
      assert.deepEqual(result.tools.map((t) => t.name), ['tool_0', 'tool_1']);
      assert.equal(result.viaToolSearch, true);
      assert.equal(result.coverageStatus, 'complete');
      assert.deepEqual(result.uncoveredRequirements, []);
    },
  ));
  assert.equal(retrievalCalled, false, 'an ordinary complete selection must not trigger the broader-catalogue path');
});

test('coverage insufficient, no recovery: attendance+identity selected but no fee tool anywhere — broader fallback attempted, finds nothing new, insufficiency is preserved', async () => {
  // Deliberately no fee tool exists in roleTools at all — a truly
  // unsupported requirement (spec Test 4), so the broader retrieval path
  // cannot recover it either.
  const tools = [
    { name: 'attendance_summary', description: 'reports attendance percentages.', params: {} },
    { name: 'student_profile', description: 'looks up student identity.', params: {} },
  ];
  let retrievalCalled = false;
  await withStub(aiToolRetrievalService, 'retrieveRelevantTools', async () => {
    retrievalCalled = true;
    // Returns the same subset Tool Search already picked — nothing new.
    return [tools[0], tools[1]];
  }, () => withStub(
    configurationService,
    'getToolSearchConfig',
    () => enabledConfig(async () => toolCallDecision(['attendance_summary', 'student_profile'], {
      coverageStatus: 'insufficient',
      uncoveredRequirements: ['No selected tool provides current fee-due data.'],
    })),
    async () => {
      const result = await aiToolSearchService.discoverRelevantTools({}, {
        roleTools: tools,
        question: 'List students whose attendance is below 75% and whose fee due is above 10000.',
      });
      assert.deepEqual(result.tools.map((t) => t.name), ['attendance_summary', 'student_profile']);
      assert.equal(result.viaToolSearch, true, 'a valid subset, even if incomplete, is not treated as an outright Tool Search failure');
      assert.equal(result.coverageStatus, 'insufficient', 'coverage gap must not be silently upgraded to complete');
      assert.deepEqual(result.uncoveredRequirements, ['No selected tool provides current fee-due data.']);
    },
  ));
  assert.equal(retrievalCalled, true, 'broader/full catalogue fallback must be attempted for an insufficient result');
});

test('coverage recovery: broader-catalogue fallback surfaces the missing fee tool, final coverage becomes complete', async () => {
  const feeTool = { name: 'fee_due_lookup', description: 'reports outstanding fee dues.', params: {} };
  const tools = [
    { name: 'attendance_summary', description: 'reports attendance percentages.', params: {} },
    { name: 'student_profile', description: 'looks up student identity.', params: {} },
    feeTool,
  ];
  await withStub(aiToolRetrievalService, 'retrieveRelevantTools', async () => [feeTool], () => withStub(
    configurationService,
    'getToolSearchConfig',
    () => enabledConfig(async () => toolCallDecision(['attendance_summary', 'student_profile'], {
      coverageStatus: 'insufficient',
      uncoveredRequirements: ['No selected tool provides current fee-due data.'],
    })),
    async () => {
      const result = await aiToolSearchService.discoverRelevantTools({}, {
        roleTools: tools,
        question: 'List students whose attendance is below 75% and whose fee due is above 10000.',
      });
      assert.deepEqual(
        result.tools.map((t) => t.name).sort(),
        ['attendance_summary', 'fee_due_lookup', 'student_profile'],
        'the recovered fee tool must be merged into the final selection',
      );
      assert.equal(result.coverageStatus, 'complete', 'coverage becomes complete once the broader path actually finds the missing capability');
      assert.deepEqual(result.uncoveredRequirements, []);
    },
  ));
});

test('coverage uncertain: attempts broader-catalogue recovery, and when it finds nothing new the uncertainty is preserved (not silently upgraded to complete)', async () => {
  const tools = makeTools(4);
  let retrievalCalled = false;
  await withStub(aiToolRetrievalService, 'retrieveRelevantTools', async () => { retrievalCalled = true; return [tools[0]]; }, () => withStub(
    configurationService,
    'getToolSearchConfig',
    () => enabledConfig(async () => toolCallDecision(['tool_0'], { coverageStatus: 'uncertain' })),
    async () => {
      const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'q' });
      assert.equal(result.coverageStatus, 'uncertain', 'the broader path re-confirmed the same tool_0 with nothing new — the original uncertainty stands');
      assert.deepEqual(result.tools.map((t) => t.name), ['tool_0']);
    },
  ));
  assert.equal(retrievalCalled, true, 'broader/full catalogue fallback must be attempted for an uncertain result too');
});

test('coverage uncertain with genuine recovery: broader-catalogue fallback surfaces a new tool, coverage becomes complete', async () => {
  const tools = makeTools(4);
  await withStub(aiToolRetrievalService, 'retrieveRelevantTools', async () => [tools[0], tools[1]], () => withStub(
    configurationService,
    'getToolSearchConfig',
    () => enabledConfig(async () => toolCallDecision(['tool_0'], { coverageStatus: 'uncertain' })),
    async () => {
      const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'q' });
      assert.equal(result.coverageStatus, 'complete');
      assert.deepEqual(result.tools.map((t) => t.name).sort(), ['tool_0', 'tool_1']);
    },
  ));
});

test('coverage hallucinated names remain rejected regardless of coverageStatus', async () => {
  const tools = makeTools(5);
  await withStub(aiToolRetrievalService, 'retrieveRelevantTools', async () => [tools[0], tools[1]], () => withStub(
    configurationService,
    'getToolSearchConfig',
    () => enabledConfig(async () => toolCallDecision(['hallucinated_tool_a', 'hallucinated_tool_b'], { coverageStatus: 'complete' })),
    async () => {
      const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'q' });
      assert.equal(result.viaToolSearch, false, 'all-invalid names must still fall back regardless of the reported coverageStatus');
      assert.deepEqual(result.tools.map((t) => t.name), ['tool_0', 'tool_1']);
    },
  ));
});

test('malformed coverageStatus (missing) defaults to uncertain, not complete, and triggers broader-catalogue recovery', async () => {
  const tools = makeTools(3);
  let retrievalCalled = false;
  await withStub(aiToolRetrievalService, 'retrieveRelevantTools', async () => { retrievalCalled = true; return []; }, () => withStub(
    configurationService,
    'getToolSearchConfig',
    () => enabledConfig(async () => ({
      type: 'tool_call',
      toolName: aiToolSearchService.SELECT_TOOLS_META_TOOL_NAME,
      arguments: { names: ['tool_0'] },
    })),
    async () => {
      const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'q' });
      assert.equal(result.coverageStatus, 'uncertain', 'a missing coverageStatus must never be treated as an implicit "complete"');
      assert.deepEqual(result.tools.map((t) => t.name), ['tool_0']);
    },
  ));
  assert.equal(retrievalCalled, true);
});

test('malformed coverageStatus (invalid enum value) is normalized to uncertain rather than trusted as-is', async () => {
  const tools = makeTools(3);
  await withStub(aiToolRetrievalService, 'retrieveRelevantTools', async () => [], () => withStub(
    configurationService,
    'getToolSearchConfig',
    () => enabledConfig(async () => toolCallDecision(['tool_0'], { coverageStatus: 'super-duper-sure' })),
    async () => {
      const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'q' });
      assert.equal(result.coverageStatus, 'uncertain');
    },
  ));
});

test('malformed uncoveredRequirements (wrong type) is normalized to an empty array rather than propagated as-is', async () => {
  const tools = makeTools(3);
  await withStub(aiToolRetrievalService, 'retrieveRelevantTools', async () => [], () => withStub(
    configurationService,
    'getToolSearchConfig',
    () => enabledConfig(async () => toolCallDecision(['tool_0'], {
      coverageStatus: 'insufficient',
      uncoveredRequirements: 'fee data is missing',
    })),
    async () => {
      const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'q' });
      assert.deepEqual(result.uncoveredRequirements, [], 'a non-array uncoveredRequirements must be normalized away, not passed through');
    },
  ));
});

test('malformed uncoveredRequirements is bounded to a safe count and per-item length', async () => {
  const tools = makeTools(3);
  const longItem = 'x'.repeat(500);
  const manyItems = Array.from({ length: 20 }, (_, i) => `requirement ${i}`);
  await withStub(aiToolRetrievalService, 'retrieveRelevantTools', async () => [], () => withStub(
    configurationService,
    'getToolSearchConfig',
    () => enabledConfig(async () => toolCallDecision(['tool_0'], {
      coverageStatus: 'insufficient',
      uncoveredRequirements: [longItem, ...manyItems],
    })),
    async () => {
      const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: tools, question: 'q' });
      assert.ok(result.uncoveredRequirements.length <= 5, 'uncoveredRequirements must be capped, never unbounded');
      assert.ok(result.uncoveredRequirements[0].length <= 200, 'each uncoveredRequirements item must be bounded in length');
    },
  ));
});
