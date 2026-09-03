'use strict';

// ARCNAVE modernization P2 (PDF 1.4 / clash C2) — explicit Vertex prompt
// caching for askAgent's stable decision-call system prefix.

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config');
const aiExplicitCache = require('../src/services/aiExplicitCache');

const BIG_PREFIX = 'ARCNAVE curriculum policy and tool routing catalogue. '.repeat(360); // > MIN_CACHEABLE_CHARS (~4k tokens)
const CFG = { projectId: 'p', model: 'gemini-3.8-flash', location: 'global', accessToken: 't' };

function withFetch(impl, fn) {
  const original = global.fetch;
  global.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      global.fetch = original;
    });
}

test('resolveCachedSystemInstruction: returns null when config.aiExplicitCache is off (default), no HTTP call', async () => {
  aiExplicitCache._reset();
  assert.equal(config.aiExplicitCache, false);
  let called = false;
  await withFetch(
    async () => {
      called = true;
      return { status: 200, json: async () => ({}) };
    },
    async () => {
      const name = await aiExplicitCache.resolveCachedSystemInstruction(CFG, BIG_PREFIX);
      assert.equal(name, null);
    },
  );
  assert.equal(called, false, 'no cachedContents call when the feature is off');
});

test('resolveCachedSystemInstruction: with the flag on, creates a cachedContents resource once and reuses the handle', async () => {
  aiExplicitCache._reset();
  const original = config.aiExplicitCache;
  config.aiExplicitCache = true;
  let createCalls = 0;
  try {
    await withFetch(
      async (url, options) => {
        assert.ok(url.endsWith('/cachedContents'), 'posts to the cachedContents collection');
        assert.equal(options.method, 'POST');
        const body = JSON.parse(options.body);
        assert.ok(body.model.includes('gemini-3.8-flash'));
        assert.equal(body.systemInstruction.parts[0].text, BIG_PREFIX);
        assert.match(body.ttl, /^\d+s$/);
        createCalls += 1;
        return {
          status: 200,
          json: async () => ({ name: `projects/x/locations/global/cachedContents/${createCalls}` }),
        };
      },
      async () => {
        const a = await aiExplicitCache.resolveCachedSystemInstruction(CFG, BIG_PREFIX);
        const b = await aiExplicitCache.resolveCachedSystemInstruction(CFG, BIG_PREFIX);
        assert.equal(a, 'projects/x/locations/global/cachedContents/1');
        assert.equal(b, a, 'second call reuses the cached handle');
        assert.equal(createCalls, 1, 'only one cachedContents resource created');
      },
    );
  } finally {
    config.aiExplicitCache = original;
    aiExplicitCache._reset();
  }
});

test('resolveCachedSystemInstruction: a create failure degrades to null (inline system prompt), never throws', async () => {
  aiExplicitCache._reset();
  const original = config.aiExplicitCache;
  config.aiExplicitCache = true;
  try {
    await withFetch(
      async () => ({ status: 429, text: async () => 'RESOURCE_EXHAUSTED' }),
      async () => {
        const name = await aiExplicitCache.resolveCachedSystemInstruction(CFG, BIG_PREFIX);
        assert.equal(name, null);
      },
    );
  } finally {
    config.aiExplicitCache = original;
    aiExplicitCache._reset();
  }
});

test('resolveCachedSystemInstruction: a prefix below the size floor is not cached', async () => {
  aiExplicitCache._reset();
  const original = config.aiExplicitCache;
  config.aiExplicitCache = true;
  try {
    let called = false;
    await withFetch(
      async () => {
        called = true;
        return { status: 200, json: async () => ({ name: 'n' }) };
      },
      async () => {
        assert.equal(await aiExplicitCache.resolveCachedSystemInstruction(CFG, 'short prefix'), null);
      },
    );
    assert.equal(called, false);
  } finally {
    config.aiExplicitCache = original;
    aiExplicitCache._reset();
  }
});

test('isEligible: only a Vertex Gemini cfg with the flag on qualifies', () => {
  const original = config.aiExplicitCache;
  config.aiExplicitCache = true;
  try {
    assert.equal(aiExplicitCache.isEligible(CFG), true);
    assert.equal(aiExplicitCache.isEligible({ model: 'gpt-4' }), false, 'no projectId');
    config.aiExplicitCache = false;
    assert.equal(aiExplicitCache.isEligible(CFG), false, 'flag off');
  } finally {
    config.aiExplicitCache = original;
  }
});
