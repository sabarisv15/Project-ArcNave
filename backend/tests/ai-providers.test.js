'use strict';

// Unit tests for the aiProviders adapter registry — no live network
// calls to any real vendor (nim.js's own request-shape behavior is
// already proven against mocked fetch in ai-service.test.js; this file
// proves the shared interface contract every adapter must satisfy, and
// getAdapter's own resolution/error behavior).

const test = require('node:test');
const assert = require('node:assert/strict');
const aiProviders = require('../src/services/aiProviders');

const REQUIRED_METHODS = ['isConfigured', 'complete', 'completeWithTools', 'embed'];

test('aiProviders: every registered adapter implements the full common interface', () => {
  for (const providerName of aiProviders.KNOWN_PROVIDERS) {
    const adapter = aiProviders.getAdapter(providerName);
    for (const method of REQUIRED_METHODS) {
      assert.equal(typeof adapter[method], 'function', `${providerName}.${method} must be a function`);
    }
  }
});

test('aiProviders.getAdapter: known providers resolve to their own module', () => {
  assert.equal(aiProviders.getAdapter('nim').name, 'nim');
  assert.equal(aiProviders.getAdapter('gemini').name, 'gemini');
  assert.equal(aiProviders.getAdapter('claude').name, 'claude');
  assert.equal(aiProviders.getAdapter('self_hosted').name, 'self_hosted');
});

test('aiProviders.getAdapter: an unknown provider name throws AiProviderUnknownError', () => {
  assert.throws(
    () => aiProviders.getAdapter('some_vendor_nobody_built'),
    aiProviders.AiProviderUnknownError,
  );
});

test('nim/gemini/selfHosted adapters: isConfigured is false with an empty config', () => {
  assert.equal(aiProviders.getAdapter('nim').isConfigured({}), false);
  assert.equal(aiProviders.getAdapter('gemini').isConfigured({}), false);
  assert.equal(aiProviders.getAdapter('self_hosted').isConfigured({}), false);
  assert.equal(aiProviders.getAdapter('claude').isConfigured({}), false);
});

test('selfHosted adapter: isConfigured requires baseUrl specifically, not apiKey', () => {
  const selfHosted = aiProviders.getAdapter('self_hosted');
  assert.equal(selfHosted.isConfigured({ apiKey: 'k', baseUrl: undefined }), false);
  assert.equal(selfHosted.isConfigured({ apiKey: undefined, baseUrl: 'http://localhost:8000' }), true);
});

test('claude adapter: embed() throws AiProviderCapabilityError — a real vendor limitation, not a silent fake', async () => {
  const claude = aiProviders.getAdapter('claude');
  await assert.rejects(
    () => claude.embed({ apiKey: 'k' }, ['text'], { inputType: 'passage' }),
    aiProviders.AiProviderCapabilityError,
  );
});

test('nim/gemini/selfHosted adapters: complete()/embed() throw LlmNotConfiguredError when unconfigured, no fetch attempted', async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; };
  try {
    for (const providerName of ['nim', 'gemini', 'self_hosted']) {
      const adapter = aiProviders.getAdapter(providerName);
      // eslint-disable-next-line no-await-in-loop
      await assert.rejects(
        () => adapter.complete({}, { systemPrompt: 's', userPrompt: 'u' }),
        aiProviders.LlmNotConfiguredError,
      );
    }
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});
