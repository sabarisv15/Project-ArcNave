'use strict';

// Unit coverage for routes/ai.js's resolveThinkingLevel boundary (P3
// 1.11) — attached to the exported createAiRouter factory as
// `.resolveThinkingLevel` purely for this kind of direct test, without
// spinning up a real Express app + DB (see that file's own comment on
// the export). Requires config.js's env-var validation like any other
// route/service test in this suite — real values are already present
// in the Docker test environment (docker-compose.yml), same as every
// other file here.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const createAiRouter = require('../src/routes/ai');

const { resolveThinkingLevel } = createAiRouter;

test('resolveThinkingLevel: an explicit label always wins, regardless of question difficulty', () => {
  assert.equal(resolveThinkingLevel('fast', 'why did attendance drop, compare and analyze the trend?'), 'LOW');
  assert.equal(resolveThinkingLevel('deep', 'hi'), 'HIGH');
  assert.equal(resolveThinkingLevel('balanced', 'hi'), 'MEDIUM');
});

test('resolveThinkingLevel: a missing label auto-classifies from the question (P3 1.11)', () => {
  assert.equal(resolveThinkingLevel(undefined, 'hi'), 'LOW');
  assert.equal(resolveThinkingLevel(null, 'hi'), 'LOW');
  assert.equal(
    resolveThinkingLevel(
      undefined,
      'Compare this term and last term, why the drop? What strategy do you recommend?',
    ),
    'HIGH',
  );
});

test('resolveThinkingLevel: an empty-string label is treated the same as missing (auto-classifies)', () => {
  assert.equal(
    resolveThinkingLevel('', 'Compare this term and last term, why the drop? What strategy do you recommend?'),
    'HIGH',
  );
});

test('resolveThinkingLevel: an unrecognized (garbage) label falls back to the fixed default, never auto-classifies', () => {
  // A malformed request is a caller bug, not "let the backend decide" —
  // it must not silently get a different escalation behavior than
  // before this feature existed.
  assert.equal(
    resolveThinkingLevel('bogus', 'Compare this term and last term, why the drop? What strategy do you recommend?'),
    'LOW',
  );
});

test('resolveThinkingLevel: missing label with no question at all stays at the fixed default', () => {
  assert.equal(resolveThinkingLevel(undefined, undefined), 'LOW');
});
