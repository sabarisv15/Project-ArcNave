'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTamilDigits,
  extractCountClaims,
  TAMIL_COUNT_CLAIM_PATTERN,
} = require('../src/services/aiNumericClaimLocaleSupport');

// Mirrors aiService.js's own COUNT_CLAIM_PATTERN exactly (P3 1.13's
// module is designed to slot in alongside it) — duplicated here only so
// this test file has no dependency on aiService.js, which a separate
// concurrent session is editing this same day.
const ENGLISH_COUNT_CLAIM_PATTERN =
  /\b(\d+)\s+(records?|students?|staff|results?|entries|entry|items?|rows?|classes?|periods?|sessions?|departments?|notifications?|documents?|teachers?|faculty|marks?|fees?|payments?|approvals?|requests?|absentees?|messages?|alerts?|arrears?)\b/gi;

test('normalizeTamilDigits converts Tamil numeral glyphs to ASCII', () => {
  assert.equal(normalizeTamilDigits('௧௦'), '10');
  assert.equal(normalizeTamilDigits('௭'), '7');
  assert.equal(normalizeTamilDigits('௦'), '0');
});

test('normalizeTamilDigits leaves ASCII digits and other text unchanged', () => {
  assert.equal(normalizeTamilDigits('10 students'), '10 students');
  assert.equal(normalizeTamilDigits('மாணவர்கள்'), 'மாணவர்கள்');
});

test('normalizeTamilDigits handles a string mixing Tamil and ASCII digits', () => {
  // "5 out of ௧௦" — a realistic OCR/hand-typed mixed-script case.
  assert.equal(normalizeTamilDigits('5 out of ௧௦'), '5 out of 10');
});

test('normalizeTamilDigits is a no-op on non-string input', () => {
  assert.equal(normalizeTamilDigits(null), null);
  assert.equal(normalizeTamilDigits(undefined), undefined);
  assert.equal(normalizeTamilDigits(42), 42);
});

test('TAMIL_COUNT_CLAIM_PATTERN matches ASCII digits directly followed by a Tamil count noun', () => {
  const matches = [...'இன்று 10 மாணவர்கள் வந்தனர்'.matchAll(TAMIL_COUNT_CLAIM_PATTERN)];
  assert.equal(matches.length, 1);
  assert.equal(matches[0][1], '10');
});

test('TAMIL_COUNT_CLAIM_PATTERN does not match a bare digit with no Tamil noun following', () => {
  const matches = [...'ஆண்டு 2026 இல்'.matchAll(TAMIL_COUNT_CLAIM_PATTERN)];
  assert.equal(matches.length, 0);
});

test('extractCountClaims catches a Tamil-digit-glyph claim an English-only pattern would silently miss', () => {
  const claims = extractCountClaims('௧௦ மாணவர்கள் வந்தனர்', ENGLISH_COUNT_CLAIM_PATTERN);
  assert.deepEqual(claims, [10]);
});

test('extractCountClaims catches a mixed-language claim (English digit + Tamil noun)', () => {
  const claims = extractCountClaims('இன்று 7 மாணவர்கள் வந்தனர்', ENGLISH_COUNT_CLAIM_PATTERN);
  assert.deepEqual(claims, [7]);
});

test('extractCountClaims still catches a plain English claim via the supplied pattern', () => {
  const claims = extractCountClaims('12 students appeared today', ENGLISH_COUNT_CLAIM_PATTERN);
  assert.deepEqual(claims, [12]);
});

test('extractCountClaims combines English and Tamil claims from the same answer', () => {
  const claims = extractCountClaims('12 students appeared, ௫ மாணவர்கள் இல்லை', ENGLISH_COUNT_CLAIM_PATTERN);
  assert.deepEqual(
    claims.sort((a, b) => a - b),
    [5, 12],
  );
});

test('extractCountClaims returns empty array when no English pattern is supplied and no Tamil claim exists', () => {
  assert.deepEqual(extractCountClaims('no numeric claim here', undefined), []);
});

test('extractCountClaims returns empty array for non-string input', () => {
  assert.deepEqual(extractCountClaims(null, ENGLISH_COUNT_CLAIM_PATTERN), []);
  assert.deepEqual(extractCountClaims(undefined, ENGLISH_COUNT_CLAIM_PATTERN), []);
});

test('extractCountClaims does not double-count a claim already normalized from Tamil digits, even with an English pattern supplied', () => {
  // "௧௦" normalizes to "10", which then only matches the Tamil noun
  // pattern (மாணவர்கள்), never the English one (no English noun here) —
  // confirms normalization happens exactly once, not per-pattern.
  const claims = extractCountClaims('௧௦ மாணவர்கள்', ENGLISH_COUNT_CLAIM_PATTERN);
  assert.deepEqual(claims, [10]);
});
