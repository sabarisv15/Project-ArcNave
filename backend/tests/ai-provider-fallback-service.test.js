'use strict';

// Unit tests for aiProviderFallbackService.js (CEO Vertex/Gemini audit
// #40, 2026-08-30 — "Cross-Provider Fallback"). Pure unit tests over
// hand-built fake adapters — no real provider/network involved, same
// "prove the wrapping mechanism itself" scope aiProviders.test.js's own
// interface-contract tests already take for the real adapters.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LlmNotConfiguredError,
  LlmRequestError,
  AiProviderCapabilityError,
} = require('../src/services/aiProviders/errors');
const {
  buildResilientAdapter,
  buildFallbackTracker,
  isFallbackEligible,
} = require('../src/services/aiProviderFallbackService');

function fakeAdapter(name, { configured = true, complete } = {}) {
  return {
    name,
    supportsVision: true,
    supportsAudioVideo: false,
    isConfigured: () => configured,
    complete: complete || (async (cfg) => `${name}-answer-for-${JSON.stringify(cfg)}`),
  };
}

test('isFallbackEligible: LlmRequestError and LlmNotConfiguredError are eligible, AiProviderCapabilityError is not', () => {
  assert.equal(isFallbackEligible(new LlmRequestError('x')), true);
  assert.equal(isFallbackEligible(new LlmNotConfiguredError('x')), true);
  assert.equal(isFallbackEligible(new AiProviderCapabilityError('x')), false);
  assert.equal(isFallbackEligible(new Error('some other error')), false);
});

test('buildResilientAdapter: primary succeeds -> fallback is never called, onFallback never fires', async () => {
  let fallbackCalled = false;
  const primary = fakeAdapter('primary');
  const fallback = fakeAdapter('fallback', {
    complete: async () => {
      fallbackCalled = true;
      return 'should not happen';
    },
  });
  const { state, onFallback } = buildFallbackTracker();

  const resilient = buildResilientAdapter(primary, fallback, { model: 'fb-model' }, { onFallback });
  const result = await resilient.complete({ model: 'primary-model' });

  assert.equal(fallbackCalled, false);
  assert.equal(state.triggered, false);
  assert.match(result, /^primary-answer-for-/);
});

test('buildResilientAdapter: primary throws a transient error, fallback is configured -> falls back and onFallback fires', async () => {
  const primary = fakeAdapter('primary', {
    complete: async () => {
      throw new LlmRequestError('primary is down');
    },
  });
  const fallback = fakeAdapter('fallback');
  const { state, onFallback } = buildFallbackTracker();

  const resilient = buildResilientAdapter(primary, fallback, { model: 'fb-model' }, { onFallback });
  const result = await resilient.complete({ model: 'primary-model' });

  assert.match(result, /^fallback-answer-for-/);
  assert.equal(state.triggered, true);
  assert.match(state.reason, /primary is down/);
});

test('buildResilientAdapter: primary throws a transient error, fallback is NOT configured -> rethrows the original error, never falls back', async () => {
  const primary = fakeAdapter('primary', {
    complete: async () => {
      throw new LlmRequestError('primary is down');
    },
  });
  const fallback = fakeAdapter('fallback', { configured: false });
  const { state, onFallback } = buildFallbackTracker();

  const resilient = buildResilientAdapter(primary, fallback, { model: 'fb-model' }, { onFallback });
  await assert.rejects(() => resilient.complete({ model: 'primary-model' }), LlmRequestError);
  assert.equal(state.triggered, false);
});

test('buildResilientAdapter: primary throws AiProviderCapabilityError -> rethrows immediately, never falls back (a modality mismatch, not an outage)', async () => {
  const primary = fakeAdapter('primary', {
    complete: async () => {
      throw new AiProviderCapabilityError('no audio support');
    },
  });
  let fallbackCalled = false;
  const fallback = fakeAdapter('fallback', {
    complete: async () => {
      fallbackCalled = true;
    },
  });
  const { onFallback } = buildFallbackTracker();

  const resilient = buildResilientAdapter(primary, fallback, {}, { onFallback });
  await assert.rejects(() => resilient.complete({}), AiProviderCapabilityError);
  assert.equal(fallbackCalled, false);
});

test('buildResilientAdapter: isConfigured is true if EITHER primary or fallback is configured', () => {
  const bothConfigured = buildResilientAdapter(
    fakeAdapter('p', { configured: true }),
    fakeAdapter('f', { configured: true }),
    {},
  );
  assert.equal(bothConfigured.isConfigured({}), true);

  const onlyFallback = buildResilientAdapter(
    fakeAdapter('p', { configured: false }),
    fakeAdapter('f', { configured: true }),
    {},
  );
  assert.equal(onlyFallback.isConfigured({}), true);

  const neither = buildResilientAdapter(
    fakeAdapter('p', { configured: false }),
    fakeAdapter('f', { configured: false }),
    {},
  );
  assert.equal(neither.isConfigured({}), false);
});

test('buildResilientAdapter: a method the primary does not export is simply absent on the wrapped adapter (e.g. claude.js has no countTokens)', () => {
  const primary = { name: 'claude', isConfigured: () => true, complete: async () => 'x' }; // no countTokens
  const fallback = fakeAdapter('fallback');
  const resilient = buildResilientAdapter(primary, fallback, {});
  assert.equal('countTokens' in resilient, false);
});

test('buildResilientAdapter: supportsCapability/getCapabilityProfile answer for the PRIMARY only, never wrapped', () => {
  const primary = {
    name: 'gemini',
    isConfigured: () => true,
    complete: async () => 'x',
    supportsCapability: (cfg, capability) => capability === 'multimodal_image',
    getCapabilityProfile: () => ({ capabilities: { multimodal_image: true } }),
  };
  const fallback = fakeAdapter('fallback');
  const resilient = buildResilientAdapter(primary, fallback, {});
  assert.equal(resilient.supportsCapability({}, 'multimodal_image'), true);
  assert.equal(resilient.supportsCapability({}, 'multimodal_video'), false);
  assert.deepEqual(resilient.getCapabilityProfile({}), { capabilities: { multimodal_image: true } });
});

test('buildFallbackTracker: state starts untriggered, one tracker per resolved config (not shared across two independent calls)', () => {
  const a = buildFallbackTracker();
  const b = buildFallbackTracker();
  a.onFallback('complete', new Error('x'));
  assert.equal(a.state.triggered, true);
  assert.equal(b.state.triggered, false);
});
