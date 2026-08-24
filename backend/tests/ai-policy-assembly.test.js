'use strict';

// ADR-030 P1 — deterministic, pure/sync assembly tests for
// aiPolicyAssembly.buildPolicy. No DB, no fetch mocking, no live model
// call: this is exactly the class of test the ADR's P0.5 phasing calls
// "deterministic assembly tests... run every commit", as opposed to the
// separate provider behavioral suite (scripts/ai-behavioral-suite.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const aiPolicyAssembly = require('../src/services/aiPolicyAssembly');

const {
  CORE, CONTINUITY, TOOL_SELECTION, PLAN, FILE, ARTIFACT, MODE_PREFIX, buildPolicy,
} = aiPolicyAssembly;

function baseState(overrides = {}) {
  return {
    mode: 'curriculum', hasHistory: false, toolCount: 0, hasFileTool: false, focusEntityType: null, ...overrides,
  };
}

test('buildPolicy: CORE is always present, and alone when no other gate is true', () => {
  const policy = buildPolicy(baseState());
  assert.ok(policy.includes(CORE));
  assert.equal(policy, CORE);
});

test('buildPolicy: CONTINUITY included only when hasHistory is true', () => {
  assert.ok(!buildPolicy(baseState({ hasHistory: false })).includes(CONTINUITY));
  assert.ok(buildPolicy(baseState({ hasHistory: true })).includes(CONTINUITY));
});

test('buildPolicy: TOOL_SELECTION included only when toolCount > 0', () => {
  assert.ok(!buildPolicy(baseState({ toolCount: 0 })).includes(TOOL_SELECTION));
  assert.ok(buildPolicy(baseState({ toolCount: 1 })).includes(TOOL_SELECTION));
});

test('buildPolicy: PLAN included only when toolCount >= 2 (matches askAgent\'s own plan-meta-tool gate)', () => {
  assert.ok(!buildPolicy(baseState({ toolCount: 1 })).includes(PLAN));
  assert.ok(buildPolicy(baseState({ toolCount: 2 })).includes(PLAN));
});

test('buildPolicy: TOOL_SELECTION present without PLAN when exactly one tool is offered', () => {
  const policy = buildPolicy(baseState({ toolCount: 1 }));
  assert.ok(policy.includes(TOOL_SELECTION));
  assert.ok(!policy.includes(PLAN));
});

test('buildPolicy: FILE included only when hasFileTool is true', () => {
  assert.ok(!buildPolicy(baseState({ hasFileTool: false })).includes(FILE));
  assert.ok(buildPolicy(baseState({ hasFileTool: true })).includes(FILE));
});

test('buildPolicy: ARTIFACT included only when focusEntityType is exactly "artifact"', () => {
  assert.ok(!buildPolicy(baseState({ focusEntityType: null })).includes(ARTIFACT));
  assert.ok(!buildPolicy(baseState({ focusEntityType: 'student' })).includes(ARTIFACT));
  assert.ok(buildPolicy(baseState({ focusEntityType: 'artifact' })).includes(ARTIFACT));
});

test('buildPolicy: every module can be simultaneously present', () => {
  const policy = buildPolicy(baseState({
    hasHistory: true, toolCount: 2, hasFileTool: true, focusEntityType: 'artifact',
  }));
  assert.ok(policy.includes(CORE));
  assert.ok(policy.includes(CONTINUITY));
  assert.ok(policy.includes(TOOL_SELECTION));
  assert.ok(policy.includes(PLAN));
  assert.ok(policy.includes(FILE));
  assert.ok(policy.includes(ARTIFACT));
});

test('buildPolicy: assembly order is fixed (CORE first, ARTIFACT last) regardless of state field order', () => {
  const stateA = {
    focusEntityType: 'artifact', hasFileTool: true, toolCount: 2, hasHistory: true, mode: 'curriculum',
  };
  const stateB = baseState({
    hasHistory: true, toolCount: 2, hasFileTool: true, focusEntityType: 'artifact',
  });
  const policyA = buildPolicy(stateA);
  const policyB = buildPolicy(stateB);
  assert.equal(policyA, policyB, 'field order on the state object must not affect assembly order');
  assert.equal(policyA.indexOf(CORE), 0);
  assert.ok(policyA.indexOf(CONTINUITY) < policyA.indexOf(TOOL_SELECTION));
  assert.ok(policyA.indexOf(TOOL_SELECTION) < policyA.indexOf(PLAN));
  assert.ok(policyA.indexOf(PLAN) < policyA.indexOf(FILE));
  assert.ok(policyA.indexOf(FILE) < policyA.indexOf(ARTIFACT));
});

test('buildPolicy: deterministic — same state in, byte-identical string out, state left unmutated', () => {
  const state = baseState({ hasHistory: true, toolCount: 3, hasFileTool: true, focusEntityType: 'artifact' });
  const snapshot = JSON.stringify(state);
  const first = buildPolicy(state);
  const second = buildPolicy(state);
  assert.equal(first, second);
  assert.equal(JSON.stringify(state), snapshot, 'buildPolicy must not mutate its input');
});

test('buildPolicy: modules are joined with a blank line, matching every existing call site\'s separator', () => {
  const policy = buildPolicy(baseState({ hasHistory: true }));
  assert.equal(policy, `${CORE}\n\n${CONTINUITY}`);
});

// Content-provenance smoke tests — a cheap regression guard against an
// accidental edit silently dropping a live-caught fix during the P1
// extraction from the old flat AGENT_SYSTEM_PROMPT/CONVERSATIONAL_POLICY
// constants.
test('CORE retains the identity-masking anchor phrase (live-caught Gemini self-identification gap)', () => {
  assert.match(CORE, /never state, confirm, or imply which underlying AI provider/);
});

test('CORE retains the action-truthfulness anchor phrase', () => {
  assert.match(CORE, /Never claim to have taken an action/);
});

test('TOOL_SELECTION retains the never-invent-a-placeholder anchor phrase (live-caught NIM tool-happy gap)', () => {
  assert.match(TOOL_SELECTION, /NEVER invent a placeholder value/);
});

test('FILE retains the never-say-you-cannot-produce-a-document anchor phrase', () => {
  assert.match(FILE, /NEVER tell the user you cannot produce a document/);
});

test('CONTINUITY retains the no-repeat-greeting anchor phrase', () => {
  assert.match(CONTINUITY, /Never repeat a greeting, self-introduction/);
});

test('MODE_PREFIX.general starts with the exact sentence an existing ai-service.test.js assertion depends on', () => {
  assert.match(MODE_PREFIX.general, /^You are ARCNAVE's assistant, currently in Research mode/);
});

test('MODE_PREFIX.curriculum is a short mode-identity opener distinct from CORE', () => {
  assert.match(MODE_PREFIX.curriculum, /^You are ARCNAVE's campus assistant/);
  assert.ok(!CORE.startsWith('You are ARCNAVE'), 'CORE must be mode-agnostic, not open with a mode identity line');
});
