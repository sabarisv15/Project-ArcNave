'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { classifyThinkingDepth, LEVELS } = require('../src/services/aiThinkingDepthClassifier');

test('classifyThinkingDepth returns fast for a short, simple question', () => {
  assert.equal(classifyThinkingDepth('What is the attendance today?'), LEVELS.FAST);
});

test('classifyThinkingDepth returns fast for a greeting-like message', () => {
  assert.equal(classifyThinkingDepth('hi'), LEVELS.FAST);
});

test('classifyThinkingDepth returns fast for non-string or empty input', () => {
  assert.equal(classifyThinkingDepth(null), LEVELS.FAST);
  assert.equal(classifyThinkingDepth(undefined), LEVELS.FAST);
  assert.equal(classifyThinkingDepth(''), LEVELS.FAST);
  assert.equal(classifyThinkingDepth('   '), LEVELS.FAST);
});

test('classifyThinkingDepth escalates to balanced on a single analytical keyword', () => {
  assert.equal(classifyThinkingDepth('Why did attendance drop this month?'), LEVELS.BALANCED);
});

test('classifyThinkingDepth escalates to balanced on a long question with no keyword', () => {
  const longQuestion = `${'Tell me about the student roster. '.repeat(6)}`;
  assert.ok(longQuestion.length > 150);
  assert.equal(classifyThinkingDepth(longQuestion), LEVELS.BALANCED);
});

test('classifyThinkingDepth escalates to deep on multiple analytical keywords plus a compound question', () => {
  // Keyword score alone caps at MAX_KEYWORD_SCORE (2) — deliberately
  // conservative, see the module's own comment — so reaching 'deep'
  // needs a second independent signal too (here, two question marks).
  const question = 'Compare this term and last term — why the drop? What strategy do you recommend?';
  assert.equal(classifyThinkingDepth(question), LEVELS.DEEP);
});

test('classifyThinkingDepth keyword score alone caps below deep (conservative by design)', () => {
  const question = 'Compare this term and last term, analyze the trend, and recommend a strategy.';
  assert.equal(classifyThinkingDepth(question), LEVELS.BALANCED);
});

test('classifyThinkingDepth escalates to deep on a very long, keyword-bearing compound question', () => {
  const question = `${'Why is the fee collection rate lagging behind projections this year? '.repeat(4)} Which department is worst, and what should we recommend?`;
  assert.equal(classifyThinkingDepth(question), LEVELS.DEEP);
});

test('classifyThinkingDepth treats a compound (multi-question-mark) question as a mild signal', () => {
  // Two short questions joined, no keyword — one question-mark signal
  // alone (score 1) reaches 'balanced', not 'deep'.
  assert.equal(classifyThinkingDepth("What's today's attendance? What about yesterday?"), LEVELS.BALANCED);
});

test('classifyThinkingDepth is case-insensitive on keywords', () => {
  assert.equal(classifyThinkingDepth('WHY did this happen?'), LEVELS.BALANCED);
  assert.equal(classifyThinkingDepth('Please COMPARE these two.'), LEVELS.BALANCED);
});
