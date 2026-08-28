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
  // There is ONE provider now and it has no key of its own, so "not
  // configured" means the Vertex project is missing. Naming a search key
  // here would send an operator to set a credential nothing reads.
  await t.test('throws WebSearchNotConfiguredError when the Vertex project is unset', async () => {
    const original = config.gemini.projectId;
    config.gemini.projectId = null;
    try {
      await assert.rejects(
        webSearchService.search(null, 'college-1', 'AICTE new rules'),
        (err) => err instanceof webSearchService.WebSearchNotConfiguredError
          && err.message.includes('GEMINI_PROJECT_ID'),
      );
    } finally {
      config.gemini.projectId = original;
    }
  });
});

// RS-AIG-020 Amendment 2 / ADL-062. These three cases are the whole
// difference between opt-in and opt-out, and the third is the one that
// matters most: flipping the default must not quietly re-enable a
// college that deliberately turned this off.
test('getWebSearchConfig — on by default, off only when explicitly opted out', async (t) => {
  const configurationService = require('../src/services/configurationService'); // eslint-disable-line global-require
  const original = configurationService.getConfiguration;
  async function withStoredRow(row, fn) {
    configurationService.getConfiguration = async () => row;
    try {
      return await fn();
    } finally {
      configurationService.getConfiguration = original;
    }
  }

  await t.test('no configuration row at all means enabled', async () => {
    const result = await withStoredRow(null, () => webSearchService.getWebSearchConfig(null, 'college-1'));
    assert.equal(result.enabled, true);
  });

  await t.test('a row that never mentions enabled means enabled', async () => {
    const result = await withStoredRow(
      { configuration: { somethingElse: 1 } },
      () => webSearchService.getWebSearchConfig(null, 'college-1'),
    );
    assert.equal(result.enabled, true);
  });

  await t.test('an explicit false is still honoured — an opt-out survives the flip', async () => {
    const result = await withStoredRow(
      { configuration: { enabled: false } },
      () => webSearchService.getWebSearchConfig(null, 'college-1'),
    );
    assert.equal(result.enabled, false);
  });

  await t.test('an opted-out college is refused with a message that does not tell it to opt in', async () => {
    await withStoredRow({ configuration: { enabled: false } }, async () => {
      await assert.rejects(
        webSearchService.search(null, 'college-1', 'AICTE new rules'),
        (err) => err instanceof webSearchService.WebSearchNotEnabledError
          && /opted out/.test(err.message)
          && !/opt in/.test(err.message),
      );
    });
  });
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

// The gemini provider runs on Vertex AI + ADC and has NO key of its own,
// so "not configured" for it means the Vertex project is missing — not
// that some search key is unset. Naming the wrong variable here is the
// bug this pins: an operator told to set GEMINI_WEB_SEARCH_API_KEY would
// set a credential the provider never reads.

// web_fetch's refusal path — the behaviour that matters most here.
// Measured live: a FAILED retrieval still returned HTTP 200 and the
// model wrote confident, invented bullets about the page. If this check
// regresses, web_fetch starts fabricating silently.
test('readFetchResult — refuses anything that was not actually retrieved', async (t) => {
  const url = 'https://www.aicte-india.org/';
  const withStatus = (status, text) => ({
    candidates: [{
      content: { parts: [{ text }] },
      urlContextMetadata: { urlMetadata: [{ retrievedUrl: url, urlRetrievalStatus: status }] },
    }],
  });

  await t.test('a retrieval error throws, and the model text is discarded', () => {
    assert.throws(
      () => webSearchService.readFetchResult(withStatus('URL_RETRIEVAL_STATUS_ERROR', 'Confident invented summary.'), url),
      (err) => err instanceof webSearchService.WebFetchFailedError
        && err.message.includes('could not be retrieved')
        && !err.message.includes('Confident invented summary'),
    );
  });

  await t.test('a missing retrieval status throws rather than defaulting to success', () => {
    assert.throws(
      () => webSearchService.readFetchResult({ candidates: [{ content: { parts: [{ text: 'x' }] } }] }, url),
      webSearchService.WebFetchFailedError,
    );
  });

  await t.test('success returns the content', () => {
    const out = webSearchService.readFetchResult(withStatus(webSearchService.URL_RETRIEVAL_SUCCESS, 'Real page text.'), url);
    assert.equal(out.retrieved, true);
    assert.equal(out.content, 'Real page text.');
  });

  await t.test('retrieved but empty is a failure, not an empty success', () => {
    assert.throws(
      () => webSearchService.readFetchResult(withStatus(webSearchService.URL_RETRIEVAL_SUCCESS, '   '), url),
      webSearchService.WebFetchFailedError,
    );
  });
});

test('image_search has no provider and says so', async (t) => {
  await t.test('throws rather than returning an empty list', async () => {
    await assert.rejects(
      webSearchService.searchImages(null, 'college-1', 'campus'),
      webSearchService.WebSearchNotConfiguredError,
    );
  });
});
