'use strict';

// Unit tests for vertexCapabilityRegistry.js (Phase 8) — pure, no live
// network calls, no DB. Proves: real per-project/region/model/version
// keying (not a flat vendor-wide guess), a conservative fallback for an
// unrecognized model (never a guessed `true`), caching, the closed
// capability-name validation, and that toSafeSummary never leaks
// anything sensitive.

const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../src/services/vertexCapabilityRegistry');

test.beforeEach(() => {
  registry._resetCacheForTests();
});

test('getCapabilityProfile: a curated model returns real, cited capability data', () => {
  const profile = registry.getCapabilityProfile({
    projectId: 'proj-1', location: 'global', modelId: 'gemini-3.7-flash',
  });
  assert.equal(profile.provider, 'vertex_ai');
  assert.equal(profile.modelId, 'gemini-3.7-flash');
  assert.equal(profile.capabilities.multimodal_audio, true);
  assert.equal(profile.capabilities.multimodal_text, true);
  assert.equal(profile.capabilities.batch_prediction, false);
  assert.equal(profile.capabilities.thinking_budget, false);
  assert.equal(profile.inputLimits.maxOutputTokens, 65536);
  assert.ok(profile.notes.length > 0);
});

test('getCapabilityProfile: an unrecognized model asserts nothing true, never a guess', () => {
  const profile = registry.getCapabilityProfile({
    projectId: 'proj-1', location: 'global', modelId: 'gemini-99.9-nonexistent',
  });
  assert.deepEqual(profile.capabilities, {});
  assert.equal(profile.verifiedAt, null);
  for (const capability of registry.VERTEX_CAPABILITIES) {
    assert.equal(registry.hasCapability({
      projectId: 'proj-1', location: 'global', model: 'gemini-99.9-nonexistent',
    }, capability), false);
  }
});

test('getCapabilityProfile: identity is keyed by project/location/model/version, not model alone', () => {
  const a = registry.getCapabilityProfile({
    projectId: 'proj-a', location: 'global', modelId: 'gemini-3.7-flash',
  });
  const b = registry.getCapabilityProfile({
    projectId: 'proj-b', location: 'us-central1', modelId: 'gemini-3.7-flash', modelVersion: '001',
  });
  assert.equal(a.projectId, 'proj-a');
  assert.equal(a.location, 'global');
  assert.equal(a.modelVersion, null);
  assert.equal(b.projectId, 'proj-b');
  assert.equal(b.location, 'us-central1');
  assert.equal(b.modelVersion, '001');
  // Same curated capability data either way — the table is keyed by
  // modelId only, but the returned profile still carries the caller's
  // own real project/location/version, never silently dropped.
  assert.deepEqual(a.capabilities, b.capabilities);
});

test('getCapabilityProfile: requires modelId', () => {
  assert.throws(() => registry.getCapabilityProfile({ projectId: 'p', location: 'global' }), TypeError);
});

test('getCapabilityProfile: caches within the TTL window, keyed per identity', () => {
  const first = registry.getCapabilityProfile({ projectId: 'proj-c', location: 'global', modelId: 'gemini-3.7-flash' });
  const second = registry.getCapabilityProfile({ projectId: 'proj-c', location: 'global', modelId: 'gemini-3.7-flash' });
  assert.equal(first, second, 'must return the exact same cached object, not rebuild it');

  const third = registry.getCapabilityProfile({ projectId: 'proj-d', location: 'global', modelId: 'gemini-3.7-flash' });
  assert.notEqual(first, third, 'a different projectId must not share the same cache entry');
});

test('getCapabilityProfile: a near-zero ttlMs re-fetches rather than serving a stale entry indefinitely', async () => {
  const first = registry.getCapabilityProfile({
    projectId: 'proj-e', location: 'global', modelId: 'gemini-3.7-flash', ttlMs: 1,
  });
  await new Promise((resolve) => { setTimeout(resolve, 5); });
  const second = registry.getCapabilityProfile({
    projectId: 'proj-e', location: 'global', modelId: 'gemini-3.7-flash', ttlMs: 1,
  });
  assert.notEqual(first, second);
  assert.deepEqual(first.capabilities, second.capabilities);
});

test('hasCapability: rejects an unknown capability name rather than silently returning false', () => {
  assert.throws(
    () => registry.hasCapability({ projectId: 'p', location: 'global', model: 'gemini-3.7-flash' }, 'not_a_real_capability'),
    TypeError,
  );
});

test('hasCapability: reads cfg.model (adapter-shaped), not cfg.modelId', () => {
  assert.equal(
    registry.hasCapability({ projectId: 'p', location: 'global', model: 'gemini-3.7-flash' }, 'multimodal_audio'),
    true,
  );
});

test('toSafeSummary: never includes projectId, and carries only product-relevant fields', () => {
  const profile = registry.getCapabilityProfile({
    projectId: 'super-secret-proj', location: 'global', modelId: 'gemini-3.7-flash',
  });
  const summary = registry.toSafeSummary(profile);
  assert.equal('projectId' in summary, false);
  assert.equal(JSON.stringify(summary).includes('super-secret-proj'), false);
  assert.deepEqual(Object.keys(summary).sort(), [
    'capabilities', 'inputLimits', 'location', 'modelId', 'modelVersion',
    'notes', 'preview', 'provider', 'supportedMimeTypes', 'verifiedAt',
  ].sort());
});
