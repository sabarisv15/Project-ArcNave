'use strict';

// ARCNAVE modernization P2 (PDF 1.3 / clash C1) — the greeting / small-talk
// classifier. Whitelist-only: false positives are the harm, so the bar
// for `isConversational: true` is a full-string match against a fixed
// pattern set.

const test = require('node:test');
const assert = require('node:assert/strict');

const { classify, normalise } = require('../src/services/aiGreetingClassifier');

const CONVERSATIONAL = [
  'hi',
  'Hi!!',
  '  hello   ',
  'hey there',
  'hiya',
  'Good morning',
  'good evening to you',
  'how are you',
  'how r u doing?',
  "how's it going",
  'thanks',
  'Thank you so much',
  'thx',
  'ok',
  'got it',
  'sounds good',
  'bye',
  'see you later',
  'take care',
  'vanakkam',
  'nandri',
  'nandri nanba',
  'epdi irukinga',
  'eppadi irukkinga?',
  'sari',
  'hello 🙂',
];

const NOT_CONVERSATIONAL = [
  '',
  '   ',
  'hi, how many students are in class 10?',
  'thanks, now show me the attendance report',
  'good morning, please mark attendance for section A',
  'how many periods are scheduled?',
  'hello there team, I need the fee summary for 2026',
  'ok list the staff on leave today',
  'who is the class teacher for 8B',
  'hi 123',
  'generate the timetable',
  'nandri, now export the marksheet',
  'hey can you help me with the exam schedule please and thank you',
];

test('classify: whitelisted small talk resolves isConversational = true', () => {
  for (const q of CONVERSATIONAL) {
    assert.equal(classify(q).isConversational, true, JSON.stringify(q));
  }
});

test('classify: anything carrying a task, entity, number or embedded question is NOT conversational', () => {
  for (const q of NOT_CONVERSATIONAL) {
    assert.equal(classify(q).isConversational, false, JSON.stringify(q));
  }
});

test('classify: reason tokens are stable and machine-usable', () => {
  assert.equal(classify('hi').reason, 'whitelist_match');
  assert.equal(classify('').reason, 'empty');
  assert.equal(classify('show me class 10').reason, 'contains_number');
  assert.equal(classify('hello why is the attendance page locked for me today').reason, 'too_long');
  assert.equal(classify('hi why').reason, 'no_match');
  assert.equal(classify('why is this? thanks').reason, 'embedded_question');
});

test('classify: non-string / nullish input is handled, never throws', () => {
  for (const v of [null, undefined, 42, {}, []]) {
    assert.equal(classify(v).isConversational, false);
  }
});

test('normalise: lowercases, trims, collapses whitespace, strips trailing punctuation and emoji', () => {
  assert.equal(normalise('  Hello   There!! '), 'hello there');
  assert.equal(normalise('THANKS...'), 'thanks');
  assert.equal(normalise('hi 🙂'), 'hi');
});
