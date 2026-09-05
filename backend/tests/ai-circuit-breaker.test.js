'use strict';

// Unit tests for aiProviders/circuitBreaker.js and its wiring into
// aiProviderFallbackService.wrapMethod (P3 4.9 — "circuit breakers,
// timeouts, graceful fallback"). Pure unit tests over hand-built fake
// adapters and an injected clock — no real provider, no network, no
// sleeping through a 30s cooldown.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LlmRequestError,
  LlmNotConfiguredError,
  AiProviderCapabilityError,
} = require('../src/services/aiProviders/errors');
const circuitBreaker = require('../src/services/aiProviders/circuitBreaker');
const { buildResilientAdapter, buildFallbackTracker } = require('../src/services/aiProviderFallbackService');

const {
  shouldAttemptPrimary,
  recordSuccess,
  recordFailure,
  inspect,
  reset,
  FAILURE_THRESHOLD,
  COOLDOWN_MS,
  STATE_CLOSED,
  STATE_OPEN,
  STATE_HALF_OPEN,
} = circuitBreaker;

test.beforeEach(() => reset());

function failNTimes(name, n, now = 1000) {
  for (let i = 0; i < n; i++) recordFailure(name, new LlmRequestError('outage'), now);
}

// --- the breaker in isolation -------------------------------------

test('starts closed, and a fresh provider is always attempted', () => {
  assert.equal(inspect('vertex').state, STATE_CLOSED);
  assert.equal(shouldAttemptPrimary('vertex'), true);
});

test('opens only on the FAILURE_THRESHOLD-th consecutive outage, not the first', () => {
  failNTimes('vertex', FAILURE_THRESHOLD - 1);
  assert.equal(inspect('vertex').state, STATE_CLOSED, 'below threshold must stay closed');
  assert.equal(shouldAttemptPrimary('vertex', 1000), true);

  failNTimes('vertex', 1);
  assert.equal(inspect('vertex').state, STATE_OPEN);
});

test('a success resets the failure count, so non-consecutive failures never open it', () => {
  failNTimes('vertex', FAILURE_THRESHOLD - 1);
  recordSuccess('vertex');
  assert.equal(inspect('vertex').failures, 0);

  failNTimes('vertex', FAILURE_THRESHOLD - 1);
  assert.equal(inspect('vertex').state, STATE_CLOSED);
});

test('LlmNotConfiguredError never counts toward opening (a per-college credential fault, not a provider outage)', () => {
  for (let i = 0; i < FAILURE_THRESHOLD * 3; i++) {
    recordFailure('vertex', new LlmNotConfiguredError('no key for this college'));
  }
  assert.equal(inspect('vertex').state, STATE_CLOSED);
  assert.equal(inspect('vertex').failures, 0);
});

test('AiProviderCapabilityError never counts toward opening either', () => {
  for (let i = 0; i < FAILURE_THRESHOLD * 3; i++) {
    recordFailure('vertex', new AiProviderCapabilityError('no embeddings'));
  }
  assert.equal(inspect('vertex').state, STATE_CLOSED);
});

test('an open breaker skips the primary during cooldown, then half-opens for exactly one probe', () => {
  const openedAt = 1000;
  failNTimes('vertex', FAILURE_THRESHOLD, openedAt);
  assert.equal(inspect('vertex').state, STATE_OPEN);

  // Inside the cooldown: primary is skipped.
  assert.equal(shouldAttemptPrimary('vertex', openedAt + COOLDOWN_MS - 1), false);

  // Cooldown elapsed: this call becomes the single probe.
  assert.equal(shouldAttemptPrimary('vertex', openedAt + COOLDOWN_MS), true);
  assert.equal(inspect('vertex').state, STATE_HALF_OPEN);

  // A second concurrent call while the probe is still in flight does NOT
  // also hit the primary.
  assert.equal(shouldAttemptPrimary('vertex', openedAt + COOLDOWN_MS + 1), false);
});

test('a successful probe closes the breaker', () => {
  const openedAt = 1000;
  failNTimes('vertex', FAILURE_THRESHOLD, openedAt);
  shouldAttemptPrimary('vertex', openedAt + COOLDOWN_MS); // probe
  recordSuccess('vertex');

  assert.equal(inspect('vertex').state, STATE_CLOSED);
  assert.equal(shouldAttemptPrimary('vertex', openedAt + COOLDOWN_MS + 1), true);
});

test('a failed probe re-opens immediately for a fresh cooldown, without re-accumulating the threshold', () => {
  const openedAt = 1000;
  failNTimes('vertex', FAILURE_THRESHOLD, openedAt);

  const probeAt = openedAt + COOLDOWN_MS;
  shouldAttemptPrimary('vertex', probeAt); // half-open probe
  recordFailure('vertex', new LlmRequestError('still down'), probeAt);

  assert.equal(inspect('vertex').state, STATE_OPEN);
  assert.equal(inspect('vertex').openedAt, probeAt, 'cooldown restarts from the probe, not the original opening');
  assert.equal(shouldAttemptPrimary('vertex', probeAt + COOLDOWN_MS - 1), false);
});

test('circuits are independent per provider name', () => {
  failNTimes('vertex', FAILURE_THRESHOLD);
  assert.equal(inspect('vertex').state, STATE_OPEN);
  assert.equal(inspect('openai').state, STATE_CLOSED);
  assert.equal(shouldAttemptPrimary('openai'), true);
});

// --- the breaker as wired into the fallback adapter ---------------

function fakeAdapter(name, { configured = true, complete } = {}) {
  return {
    name,
    supportsVision: true,
    supportsAudioVideo: false,
    isConfigured: () => configured,
    complete: complete || (async () => `${name}-answer`),
  };
}

test('wired: after the threshold is reached, the primary stops being called at all and traffic goes straight to the fallback', async () => {
  let primaryCalls = 0;
  const primary = fakeAdapter('primary', {
    complete: async () => {
      primaryCalls += 1;
      throw new LlmRequestError('vertex is down');
    },
  });
  const fallback = fakeAdapter('fallback');
  const { onFallback } = buildFallbackTracker();
  const resilient = buildResilientAdapter(primary, fallback, { model: 'fb' }, { onFallback });

  // Threshold failures: each one still hits the primary, then falls back.
  for (let i = 0; i < FAILURE_THRESHOLD; i++) {
    assert.equal(await resilient.complete({ model: 'p' }), 'fallback-answer');
  }
  assert.equal(primaryCalls, FAILURE_THRESHOLD);
  assert.equal(inspect('primary').state, STATE_OPEN);

  // Breaker now open — the next calls skip the dead primary entirely.
  // This is the whole point: no wasted retry/timeout budget.
  assert.equal(await resilient.complete({ model: 'p' }), 'fallback-answer');
  assert.equal(await resilient.complete({ model: 'p' }), 'fallback-answer');
  assert.equal(primaryCalls, FAILURE_THRESHOLD, 'primary must not be called again while the breaker is open');
});

test('wired: an open breaker still fires onFallback, so the audit row records that the turn did not use the primary', async () => {
  const primary = fakeAdapter('primary', {
    complete: async () => {
      throw new LlmRequestError('down');
    },
  });
  const fallback = fakeAdapter('fallback');
  const { state, onFallback } = buildFallbackTracker();
  const resilient = buildResilientAdapter(primary, fallback, { model: 'fb' }, { onFallback });

  for (let i = 0; i < FAILURE_THRESHOLD; i++) await resilient.complete({ model: 'p' });
  state.triggered = false;
  state.reason = null;

  await resilient.complete({ model: 'p' });
  assert.equal(state.triggered, true);
  assert.match(state.reason, /circuit open for primary/);
});

test('wired: with NO usable fallback, an open breaker still attempts the primary rather than failing the call outright', async () => {
  let primaryCalls = 0;
  const primary = fakeAdapter('primary', {
    complete: async () => {
      primaryCalls += 1;
      throw new LlmRequestError('down');
    },
  });
  // Fallback exists as an object but is not configured -> not usable.
  const fallback = fakeAdapter('fallback', { configured: false });
  const resilient = buildResilientAdapter(primary, fallback, { model: 'fb' });

  for (let i = 0; i < FAILURE_THRESHOLD; i++) {
    await assert.rejects(() => resilient.complete({ model: 'p' }), LlmRequestError);
  }
  assert.equal(inspect('primary').state, STATE_OPEN);

  // Open breaker, no fallback: the primary is STILL tried. A breaker
  // must never convert a might-have-worked call into a certain failure.
  await assert.rejects(() => resilient.complete({ model: 'p' }), LlmRequestError);
  assert.equal(primaryCalls, FAILURE_THRESHOLD + 1);
});

test('wired: a healthy primary never opens the breaker and never touches the fallback', async () => {
  let fallbackCalls = 0;
  const primary = fakeAdapter('primary');
  const fallback = fakeAdapter('fallback', {
    complete: async () => {
      fallbackCalls += 1;
      return 'nope';
    },
  });
  const resilient = buildResilientAdapter(primary, fallback, { model: 'fb' });

  for (let i = 0; i < FAILURE_THRESHOLD * 2; i++) {
    assert.equal(await resilient.complete({ model: 'p' }), 'primary-answer');
  }
  assert.equal(fallbackCalls, 0);
  assert.equal(inspect('primary').state, STATE_CLOSED);
});

test('wired: an intermittent primary (fail, succeed, fail) never opens the breaker', async () => {
  let call = 0;
  const primary = fakeAdapter('primary', {
    complete: async () => {
      call += 1;
      if (call % 2 === 1) throw new LlmRequestError('blip');
      return 'primary-answer';
    },
  });
  const fallback = fakeAdapter('fallback');
  const resilient = buildResilientAdapter(primary, fallback, { model: 'fb' });

  for (let i = 0; i < FAILURE_THRESHOLD * 2; i++) await resilient.complete({ model: 'p' });
  assert.equal(inspect('primary').state, STATE_CLOSED, 'alternating failures are not a sustained outage');
});
