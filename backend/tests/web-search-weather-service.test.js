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
