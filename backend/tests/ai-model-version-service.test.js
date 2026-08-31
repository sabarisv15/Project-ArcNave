'use strict';

// Unit tests for aiModelVersionService.js (CEO Vertex/Gemini audit #41,
// 2026-08-30 — Model Version Pinning/Alerting). See that file's own
// header for why this is a drift DETECTOR (in-memory, process-lifetime)
// rather than a real pin or a persisted alert history.

const test = require('node:test');
const assert = require('node:assert/strict');
const aiModelVersionService = require('../src/services/aiModelVersionService');

test.beforeEach(() => {
  aiModelVersionService._resetForTests();
});

test('getLastObservedVersion: undefined before any call has been recorded for a given key', () => {
  assert.equal(aiModelVersionService.getLastObservedVersion('c1', 'gemini', 'gemini-3.7-flash'), undefined);
});

test('recordObservedVersion: the FIRST observation is a baseline, never reported as drift', () => {
  const result = aiModelVersionService.recordObservedVersion(
    'c1',
    'gemini',
    'gemini-3.7-flash',
    'gemini-3.7-flash-002',
  );
  assert.equal(result.drifted, false);
  assert.equal(
    aiModelVersionService.getLastObservedVersion('c1', 'gemini', 'gemini-3.7-flash'),
    'gemini-3.7-flash-002',
  );
});

test('recordObservedVersion: the SAME version observed again is not drift', () => {
  aiModelVersionService.recordObservedVersion('c1', 'gemini', 'gemini-3.7-flash', 'gemini-3.7-flash-002');
  const result = aiModelVersionService.recordObservedVersion(
    'c1',
    'gemini',
    'gemini-3.7-flash',
    'gemini-3.7-flash-002',
  );
  assert.equal(result.drifted, false);
});

test('recordObservedVersion: a DIFFERENT version than last observed is reported as drift, with both versions named', () => {
  aiModelVersionService.recordObservedVersion('c1', 'gemini', 'gemini-3.7-flash', 'gemini-3.7-flash-002');
  const result = aiModelVersionService.recordObservedVersion(
    'c1',
    'gemini',
    'gemini-3.7-flash',
    'gemini-3.7-flash-003',
  );
  assert.equal(result.drifted, true);
  assert.equal(result.previousVersion, 'gemini-3.7-flash-002');
  assert.equal(result.observedVersion, 'gemini-3.7-flash-003');
  // The new version becomes the baseline for the NEXT comparison.
  assert.equal(
    aiModelVersionService.getLastObservedVersion('c1', 'gemini', 'gemini-3.7-flash'),
    'gemini-3.7-flash-003',
  );
});

test('recordObservedVersion: a falsy/undefined observedVersion is a no-op — never overwrites an existing baseline, never reported as drift', () => {
  aiModelVersionService.recordObservedVersion('c1', 'gemini', 'gemini-3.7-flash', 'gemini-3.7-flash-002');
  const result = aiModelVersionService.recordObservedVersion('c1', 'gemini', 'gemini-3.7-flash', undefined);
  assert.equal(result.drifted, false);
  assert.equal(
    aiModelVersionService.getLastObservedVersion('c1', 'gemini', 'gemini-3.7-flash'),
    'gemini-3.7-flash-002',
  );
});

test('recordObservedVersion: different (collegeId, provider, model) keys are tracked independently, never cross-contaminating', () => {
  aiModelVersionService.recordObservedVersion('college-a', 'gemini', 'gemini-3.7-flash', 'v1');
  aiModelVersionService.recordObservedVersion('college-b', 'gemini', 'gemini-3.7-flash', 'v9');
  assert.equal(aiModelVersionService.getLastObservedVersion('college-a', 'gemini', 'gemini-3.7-flash'), 'v1');
  assert.equal(aiModelVersionService.getLastObservedVersion('college-b', 'gemini', 'gemini-3.7-flash'), 'v9');
});
