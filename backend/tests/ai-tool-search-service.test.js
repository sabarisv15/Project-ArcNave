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

function toolCallDecision(names) {
  return { type: 'tool_call', toolName: aiToolSearchService.SELECT_TOOLS_META_TOOL_NAME, arguments: { names } };
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
      arguments: { names: '["tool_0","tool_1"]' },
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
  assert.deepEqual(metaTool.params.required, ['names']);
  assert.equal(metaTool.params.properties.names.type, 'array');
  assert.equal(metaTool.params.properties.names.items.type, 'string');
});

test('discoverRelevantTools: an empty roleTools set short-circuits to the fallback shape with no calls at all', async () => {
  let configResolved = false;
  await withStub(configurationService, 'getToolSearchConfig', () => { configResolved = true; return null; }, async () => {
    const result = await aiToolSearchService.discoverRelevantTools({}, { roleTools: [], question: 'q' });
    assert.deepEqual(result, { tools: [], viaToolSearch: false, usage: undefined });
  });
  assert.equal(configResolved, false, 'nothing to search for zero tools — never even resolves a Tool Search config');
});
