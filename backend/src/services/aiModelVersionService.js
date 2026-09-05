'use strict';

// CEO Vertex/Gemini audit #41 (2026-08-30) — Model Version Pinning/
// Alerting: "Google model silent-a maathina, namakku theriyanumla"
// (if Google silently changes the model, we'd never know). This is a
// DETECTOR, not a pin — this codebase has no mechanism to force Vertex
// to serve a specific dated snapshot when a college's config names an
// alias like 'gemini-3.7-flash' (Google resolves the alias server-side,
// not this app); what IS buildable without a live GCP project to probe
// is noticing when the RESOLVED version changes mid-flight.
//
// In-memory only (a plain Map, process lifetime) — a real limitation,
// stated plainly rather than hidden: a restart forgets every previously
// observed version and the next call for each (college, provider,
// model) key is treated as a fresh baseline, never a drift. This is a
// deliberate, honest v1 given no persistent store was asked for and no
// live GCP signal exists to seed one from on boot — same "don't build
// what can't be measured yet" restraint this project's other ADLs
// already apply. A future pass could persist this in the
// `configurations` table if drift alerts prove valuable enough to
// survive a restart.

const { logWarn } = require('../logging/logger');

const lastObserved = new Map();

function versionKey(collegeId, provider, configuredModel) {
  return `${collegeId}::${provider}::${configuredModel}`;
}

// Called once per successful decision-call response that carries a
// modelVersion (aiService.js's own call site) — a response with no
// modelVersion field (every non-Gemini adapter, or a Gemini response
// shape this hasn't been live-verified against) is silently skipped,
// never treated as "no version" drift.
function recordObservedVersion(collegeId, provider, configuredModel, observedVersion) {
  if (!observedVersion) return { drifted: false };
  const key = versionKey(collegeId, provider, configuredModel);
  const previous = lastObserved.get(key);
  lastObserved.set(key, observedVersion);
  if (previous === undefined || previous === observedVersion) {
    return { drifted: false, observedVersion };
  }
  logWarn('ai_model_version_drift_detected', {
    collegeId,
    provider,
    configuredModel,
    previousVersion: previous,
    observedVersion,
  });
  return {
    drifted: true,
    previousVersion: previous,
    observedVersion,
  };
}

// Read side for the ops-status admin endpoint (routes/aiConfig.js) —
// undefined when no call has been observed for this exact key since the
// last process restart, never a guessed/default value.
function getLastObservedVersion(collegeId, provider, configuredModel) {
  return lastObserved.get(versionKey(collegeId, provider, configuredModel));
}

// Test-only — same precedent as vertexCapabilityRegistry.js's own
// _resetCacheForTests: this module holds real, shared, module-level
// state, so a test suite needs a way to clear it between cases rather
// than each test picking an ever-more-unique key to dodge pollution.
function _resetForTests() {
  lastObserved.clear();
}

module.exports = { recordObservedVersion, getLastObservedVersion, _resetForTests };
