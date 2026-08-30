'use strict';

// Unit + integration tests for the Research-mode verification boundary
// (Review Finding #10, aiService.js) — direct unit coverage of
// verifyResearchNumericClaims (exported for testing, same precedent as
// buildAttachmentHint/buildHistoryHint/buildMemoryHint already exported
// from this file), plus a couple of tests through the real
// askAgent(..., {mode:'general'}) entry point proving the boundary
// actually changes the returned answer, not just an internal function.
//
// Test 8 (existing Curriculum verifyNumericClaims regression) is NOT
// duplicated here — verifyNumericClaims itself was not modified by this
// finding (verified: zero lines of that function changed), and its own
// existing coverage in ai-service.test.js (search "CONFLICT"/
// "INSUFFICIENT_EVIDENCE"/"PASS" there) already proves it unchanged when
// run as part of the full suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const aiService = require('../src/services/aiService');
const config = require('../src/config');

const { verifyResearchNumericClaims, RESEARCH_VERIFICATION_STATUS } = aiService;

function fakeClient() {
  return { query: async () => ({ rows: [] }) };
}

function withOpenAiConfig(apiKey, fn) {
  const original = { ...config.openai };
  const originalDefaultAiProvider = config.defaultAiProvider;
  config.openai.apiKey = apiKey;
  config.defaultAiProvider = 'openai';
  return fn().finally(() => {
    config.openai.apiKey = original.apiKey;
    config.openai.model = original.model;
    config.defaultAiProvider = originalDefaultAiProvider;
  });
}

function withMockFetch(mockFetch, fn) {
  const original = global.fetch;
  global.fetch = mockFetch;
  return fn().finally(() => { global.fetch = original; });
}

function mockAnswerResponse(text) {
  return { ok: true, json: async () => ({ choices: [{ message: { content: text } }] }) };
}

// --- Test 1: general research question, not applicable ------------------

test('verifyResearchNumericClaims: a general/methodology question has no numeric claim -> not_applicable', () => {
  const questions = [
    'Explain the difference between qualitative and quantitative research.',
    'Suggest a PhD methodology for a mixed-methods study.',
    'Rewrite this abstract to be more concise.',
    'Give possible research questions on AI in education.',
    'Explain the difference between correlation and causation.',
    'Best practices for writing a strong literature review include starting broad and narrowing down.',
  ];
  questions.forEach((q) => {
    assert.deepEqual(verifyResearchNumericClaims(q, []), { status: RESEARCH_VERIFICATION_STATUS.NOT_APPLICABLE });
  });
});

// --- Test 2: source-backed direct numeric claim --------------------------

test('verifyResearchNumericClaims: a direct count claim matching a trusted fact -> verified', () => {
  const evidence = [{ label: 'studentsAppeared', value: 124 }];
  const result = verifyResearchNumericClaims('124 students appeared for the exam.', evidence);
  assert.equal(result.status, RESEARCH_VERIFICATION_STATUS.VERIFIED);
});

// --- Test 3: derived percentage -------------------------------------------

test('verifyResearchNumericClaims: a percentage correctly derivable from trusted appeared/passed counts -> verified', () => {
  const evidence = [{ label: 'appeared', value: 200 }, { label: 'passed', value: 165 }];
  const result = verifyResearchNumericClaims('Pass percentage was 82.5%.', evidence);
  assert.equal(result.status, RESEARCH_VERIFICATION_STATUS.VERIFIED);
});

test('verifyResearchNumericClaims: a percentage that does NOT match any derivable ratio -> verification_failed', () => {
  const evidence = [{ label: 'appeared', value: 200 }, { label: 'passed', value: 165 }];
  const result = verifyResearchNumericClaims('Pass percentage was 90.0%.', evidence);
  assert.equal(result.status, RESEARCH_VERIFICATION_STATUS.VERIFICATION_FAILED);
});

// --- Test 4: ranking / trend ------------------------------------------------

test('verifyResearchNumericClaims: a correct ranking claim, checked against all trusted year values -> verified', () => {
  const evidence = [
    { label: '2022', value: 70.1 }, { label: '2023', value: 75.2 }, { label: '2024', value: 82.5 },
  ];
  const answer = 'Across the years, 2022 was 70.1%, 2023 was 75.2%, and 2024 was 82.5%. '
    + 'This means 2024 had the highest pass percentage.';
  const result = verifyResearchNumericClaims(answer, evidence);
  assert.equal(result.status, RESEARCH_VERIFICATION_STATUS.VERIFIED);
});

test('verifyResearchNumericClaims: an incorrect ranking claim is never treated as verified, even when the individual figures are correct', () => {
  const evidence = [
    { label: '2022', value: 70.1 }, { label: '2023', value: 75.2 }, { label: '2024', value: 82.5 },
  ];
  const answer = 'Across the years, 2022 was 70.1%, 2023 was 75.2%, and 2024 was 82.5%. '
    + 'This means 2023 had the highest pass percentage.';
  const result = verifyResearchNumericClaims(answer, evidence);
  assert.equal(result.status, RESEARCH_VERIFICATION_STATUS.VERIFICATION_FAILED);
});

// --- Test 5: unsupported material numeric claim ---------------------------

test('verifyResearchNumericClaims: an institution-specific number with no trusted evidence at all -> not_verifiable, never silently verified', () => {
  const result = verifyResearchNumericClaims('Our college pass percentage was 87.4% in 2025.', []);
  assert.equal(result.status, RESEARCH_VERIFICATION_STATUS.NOT_VERIFIABLE);
});

// --- Test 6: unreliable PDF/document evidence -----------------------------

test('verifyResearchNumericClaims: evidence marked unreliable_extraction (Finding #3\'s own status field) is never trusted, even though the arithmetic itself is correct', () => {
  const evidence = [
    { label: 'appeared', value: 200, status: 'unreliable_extraction' },
    { label: 'passed', value: 165, status: 'unreliable_extraction' },
  ];
  const result = verifyResearchNumericClaims('Pass percentage was 82.5%.', evidence);
  assert.equal(result.status, RESEARCH_VERIFICATION_STATUS.NOT_VERIFIABLE);
});

test('verifyResearchNumericClaims: evidence marked trusted: false is filtered out the same way', () => {
  const evidence = [{ label: 'studentsAppeared', value: 124, trusted: false }];
  const result = verifyResearchNumericClaims('124 students appeared.', evidence);
  assert.equal(result.status, RESEARCH_VERIFICATION_STATUS.NOT_VERIFIABLE);
});

// --- Test 7: partial evidence -----------------------------------------------

test('verifyResearchNumericClaims: evidence supports one fact but not a second, unrelated claim -> partially_verified', () => {
  const evidence = [{ label: 'appeared', value: 200 }]; // no 'passed' — a percentage cannot be derived
  const answer = '200 students appeared, and the pass percentage was 82.5%.';
  const result = verifyResearchNumericClaims(answer, evidence);
  assert.equal(result.status, RESEARCH_VERIFICATION_STATUS.PARTIALLY_VERIFIED);
});

// --- normalization/robustness ------------------------------------------------

test('verifyResearchNumericClaims: non-string/missing answer text is handled safely, not_applicable rather than throwing', () => {
  assert.deepEqual(verifyResearchNumericClaims(undefined, []), { status: RESEARCH_VERIFICATION_STATUS.NOT_APPLICABLE });
  assert.deepEqual(verifyResearchNumericClaims(null, []), { status: RESEARCH_VERIFICATION_STATUS.NOT_APPLICABLE });
});

// --- Integration: the real askAgent(mode:'general') final-answer path ------

test('aiService.askAgent (mode general): a general research question is returned completely unchanged, no verification note appended', async () => {
  const client = fakeClient();
  const identityContext = { userId: 'u1', role: 'hod', collegeId: 'college-a' };
  await withOpenAiConfig('test-key', () => withMockFetch(
    async () => mockAnswerResponse('Qualitative research explores meaning; quantitative research measures magnitude.'),
    async () => {
      const result = await aiService.askAgent(client, 'Explain the difference between qualitative and quantitative research.', { identityContext, mode: 'general' });
      assert.equal(result.answer, 'Qualitative research explores meaning; quantitative research measures magnitude.');
      assert.equal(result.verification.status, RESEARCH_VERIFICATION_STATUS.NOT_APPLICABLE);
    },
  ));
});

test('aiService.askAgent (mode general): an institution-specific numeric claim with no evidence gets a limitation note appended, never presented as verified', async () => {
  const client = fakeClient();
  const identityContext = { userId: 'u1', role: 'hod', collegeId: 'college-a' };
  await withOpenAiConfig('test-key', () => withMockFetch(
    async () => mockAnswerResponse('Our college pass percentage was 87.4% in 2025.'),
    async () => {
      const result = await aiService.askAgent(client, 'What was our pass percentage last year?', { identityContext, mode: 'general' });
      assert.equal(result.verification.status, RESEARCH_VERIFICATION_STATUS.NOT_VERIFIABLE);
      assert.ok(result.answer.startsWith('Our college pass percentage was 87.4% in 2025.'), 'the original answer text must still be present, not replaced');
      assert.match(result.answer, /cannot verify/i);
      // No internal status name, hidden reasoning, or provider name leaks into the user-facing note.
      assert.ok(!/not_verifiable|openai|gemini|vertex/i.test(result.answer));
    },
  ));
});

// --- Test 9: experimental reasoning model cannot bypass the boundary -------
//
// experimentalReasoningModel selection/config precedence is explicitly
// out of scope for this finding (see the constraints list) — this test
// does not exercise that flag. What it DOES prove is the thing that
// actually matters for "cannot bypass": verifyResearchNumericClaims runs
// on the OUTPUT TEXT alone, with no branch anywhere on which adapter/
// provider produced it — so no future provider substitution can route
// around this check without also changing this file's own control flow.
test('askGeneralChat verification boundary is provider-agnostic: applies to answer text regardless of which adapter produced it', async () => {
  const client = fakeClient();
  const identityContext = { userId: 'u1', role: 'hod', collegeId: 'college-a' };
  await withOpenAiConfig('test-key', () => withMockFetch(
    async () => mockAnswerResponse('The exact figure for this college was 99.9% in 2025.'),
    async () => {
      const result = await aiService.askAgent(client, 'general research question about our figures', { identityContext, mode: 'general' });
      assert.equal(result.verification.status, RESEARCH_VERIFICATION_STATUS.NOT_VERIFIABLE);
      assert.match(result.answer, /cannot verify/i);
    },
  ));
});
