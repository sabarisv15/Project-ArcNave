'use strict';

// Unit tests for webSearchService.js (ADL-061) and weatherService.js.
// The "not configured" tests explicitly clear the relevant config
// values for their own duration rather than assuming they're globally
// unset — same discipline sandbox-execution-service.test.js uses, so
// this suite passes regardless of whether a real API key happens to be
// set in the ambient environment it runs in (as SANDBOX_SERVICE_URL now
// is, on at least one real dev machine, after ADL-059's first deploy).

const test = require('node:test');
const assert = require('node:assert/strict');
const webSearchService = require('../src/services/webSearchService');
const weatherService = require('../src/services/weatherService');
const aiToolRegistry = require('../src/services/aiToolRegistry');
const config = require('../src/config');

function withConfigCleared(keys, fn) {
  return async () => {
    const originals = keys.map((key) => config[key]);
    keys.forEach((key) => { config[key] = null; });
    try {
      await fn();
    } finally {
      keys.forEach((key, i) => { config[key] = originals[i]; });
    }
  };
}

test('webSearchService.search — not configured', async (t) => {
  await t.test('throws WebSearchNotConfiguredError when no API key is set', withConfigCleared(['googleSearchApiKey', 'googleSearchEngineId'], async () => {
    await assert.rejects(
      webSearchService.search(null, 'college-1', 'AICTE new rules'),
      webSearchService.WebSearchNotConfiguredError,
    );
  }));
});

test('weatherService.fetchCurrentWeather — not configured', async (t) => {
  await t.test('throws WeatherNotConfiguredError when no API key is set', withConfigCleared(['openWeatherApiKey'], async () => {
    await assert.rejects(
      weatherService.fetchCurrentWeather(null, 'college-1', 'Coimbatore'),
      weatherService.WeatherNotConfiguredError,
    );
  }));
});

test('web_search / weather_fetch tool registration', async (t) => {
  await t.test('both registered, L1, Internal, reachable by every tenant role, not humanOnly', () => {
    for (const name of ['web_search', 'weather_fetch']) {
      const tool = aiToolRegistry.getTool(name);
      assert.ok(tool, `expected ${name} to be registered`);
      assert.equal(tool.level, 'L1');
      assert.equal(tool.dataClassification, 'Internal');
      assert.deepEqual([...tool.allowedRoles].sort(), ['class_tutor', 'hod', 'principal', 'staff']);
      assert.ok(!tool.humanOnly);
    }
  });

  await t.test('web_search requires query, weather_fetch requires location', () => {
    assert.deepEqual(aiToolRegistry.getTool('web_search').params.required, ['query']);
    assert.deepEqual(aiToolRegistry.getTool('weather_fetch').params.required, ['location']);
  });
});

// The gemini provider (F1, owner's choice 2026-08-28) is the only one
// whose readWebResults does real work: this API has no per-result
// snippet field, so a snippet has to be assembled by joining the
// groundingSupports spans that cite each chunk. These fixtures are the
// shapes that mapping actually has to survive.
test('gemini provider — readWebResults maps grounding chunks to results', async (t) => {
  const { gemini } = webSearchService.PROVIDERS;

  await t.test('joins every support span citing the same chunk', () => {
    const results = gemini.readWebResults({
      candidates: [{
        groundingMetadata: {
          groundingChunks: [
            { web: { uri: 'https://redirect/a', title: 'Source A' } },
            { web: { uri: 'https://redirect/b', title: 'Source B' } },
          ],
          groundingSupports: [
            { segment: { text: 'First claim.' }, groundingChunkIndices: [0] },
            { segment: { text: 'Second claim.' }, groundingChunkIndices: [0, 1] },
          ],
        },
      }],
    });
    assert.equal(results.length, 2);
    assert.equal(results[0].title, 'Source A');
    assert.equal(results[0].url, 'https://redirect/a');
    assert.equal(results[0].snippet, 'First claim. Second claim.');
    // A chunk cited by only one support still gets that support's text —
    // it must not inherit the other chunk's spans.
    assert.equal(results[1].snippet, 'Second claim.');
  });

  await t.test('a chunk with no supporting span yields an empty snippet, not a crash', () => {
    const results = gemini.readWebResults({
      candidates: [{
        groundingMetadata: { groundingChunks: [{ web: { uri: 'https://redirect/c', title: 'C' } }] },
      }],
    });
    assert.deepEqual(results, [{ title: 'C', url: 'https://redirect/c', snippet: '' }]);
  });

  await t.test('a chunk with no uri is dropped rather than returned unusable', () => {
    const results = gemini.readWebResults({
      candidates: [{
        groundingMetadata: {
          groundingChunks: [{ web: { title: 'no uri' } }, { web: { uri: 'https://redirect/d', title: 'D' } }],
        },
      }],
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].url, 'https://redirect/d');
  });

  // Google returns no groundingMetadata at all when it decides the query
  // needed no search. That is zero results, never an error, and never
  // backfilled from the model's ungrounded answer text.
  await t.test('an ungrounded response is zero results, not a failure', () => {
    assert.deepEqual(gemini.readWebResults({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }), []);
    assert.deepEqual(gemini.readWebResults({}), []);
  });

  await t.test('image search is declared unsupported, not faked', () => {
    assert.equal(gemini.buildImageRequest, null);
  });
});

test('gemini provider — not configured reports ITS key, not the shared one', async (t) => {
  await t.test('names GEMINI_WEB_SEARCH_API_KEY', withConfigCleared(
    ['geminiWebSearchApiKey', 'webSearchApiKey'],
    async () => {
      const original = config.webSearchProvider;
      config.webSearchProvider = 'gemini';
      try {
        await assert.rejects(
          () => webSearchService.search({}, 'demo', 'anything'),
          (err) => err instanceof webSearchService.WebSearchNotConfiguredError
            && err.message.includes('GEMINI_WEB_SEARCH_API_KEY'),
        );
      } finally {
        config.webSearchProvider = original;
      }
    },
  ));
});
