'use strict';

// Unit tests for aiService.js's resolveMediaSupport (Phase 8 — Vertex
// Capability Layer), exported for direct unit testing (same precedent as
// verifyResearchNumericClaims). Proves: a Vertex-backed adapter
// (supportsCapability present) routes through the real registry lookup
// per modality, never OR-ing an unverified capability onto a verified
// one; a non-Vertex adapter (no supportsCapability) falls back to its
// existing static supportsVision/supportsAudioVideo exactly as before —
// zero behavior change for claude/openai/self_hosted.

const test = require('node:test');
const assert = require('node:assert/strict');
const aiService = require('../src/services/aiService');
const vertexCapabilityRegistry = require('../src/services/vertexCapabilityRegistry');

const { resolveMediaSupport } = aiService;

test.beforeEach(() => {
  vertexCapabilityRegistry._resetCacheForTests();
});

test('resolveMediaSupport: a Vertex-backed adapter (supportsCapability) is checked per modality via the registry', () => {
  const adapter = {
    supportsCapability: (cfg, capability) => vertexCapabilityRegistry.hasCapability(cfg, capability),
  };
  const cfg = { projectId: 'p', location: 'global', model: 'gemini-3.8-flash' };
  const result = resolveMediaSupport(adapter, cfg, [{ mimeType: 'image/png' }], [{ mimeType: 'audio/wav' }]);
  assert.equal(result.imagesSupported, true);
  assert.equal(result.imageAnalysisUnavailable, false);
  assert.equal(result.mediaSupported, true);
  assert.equal(result.mediaAnalysisUnavailable, false);
});

test('resolveMediaSupport: an unrecognized model reports every modality unavailable, never a guessed true', () => {
  const adapter = {
    supportsCapability: (cfg, capability) => vertexCapabilityRegistry.hasCapability(cfg, capability),
  };
  const cfg = { projectId: 'p', location: 'global', model: 'gemini-99.9-nonexistent' };
  const result = resolveMediaSupport(adapter, cfg, [{ mimeType: 'image/png' }], [{ mimeType: 'audio/wav' }]);
  assert.equal(result.imagesSupported, false);
  assert.equal(result.imageAnalysisUnavailable, true);
  assert.equal(result.mediaSupported, false);
  assert.equal(result.mediaAnalysisUnavailable, true);
});

test('resolveMediaSupport: no attachments means no unavailable note either way, regardless of adapter support', () => {
  const adapter = { supportsCapability: () => false };
  const result = resolveMediaSupport(adapter, {}, [], []);
  assert.equal(result.imagesSupported, false);
  assert.equal(result.imageAnalysisUnavailable, false);
  assert.equal(result.mediaSupported, false);
  assert.equal(result.mediaAnalysisUnavailable, false);
});

test('resolveMediaSupport: a non-Vertex adapter with no supportsCapability falls back to its static supportsVision/supportsAudioVideo unchanged', () => {
  const supportedAdapter = { supportsVision: true, supportsAudioVideo: false };
  const supported = resolveMediaSupport(supportedAdapter, {}, [{ mimeType: 'image/png' }], [{ mimeType: 'audio/wav' }]);
  assert.equal(supported.imagesSupported, true);
  assert.equal(supported.imageAnalysisUnavailable, false);
  assert.equal(supported.mediaSupported, false);
  assert.equal(supported.mediaAnalysisUnavailable, true);

  const unsupportedAdapter = { supportsVision: false, supportsAudioVideo: false };
  const unsupported = resolveMediaSupport(unsupportedAdapter, {}, [{ mimeType: 'image/png' }], []);
  assert.equal(unsupported.imagesSupported, false);
  assert.equal(unsupported.imageAnalysisUnavailable, true);
});
