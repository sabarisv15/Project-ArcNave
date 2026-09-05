'use strict';

// Unit tests for aiService.js's logAttachmentTokenPreflight (CEO Vertex/
// Gemini audit #34, 2026-08-30 — "Token Counting Preflight"), exported
// for direct unit testing (same precedent as resolveMediaSupport).
// Behavior-only, same reasoning documentExtractionService's own tests
// already apply: logWarn is destructured at require-time in aiService.js
// (`const { logWarn } = require('../logging/logger')`), so mocking
// logger.logWarn via t.mock.method would never reach aiService's already-
// captured reference — these tests prove what logAttachmentTokenPreflight
// actually DOES (calls countTokens with the right content, skips when it
// shouldn't, never throws out of a real turn), not what it logs.

const test = require('node:test');
const assert = require('node:assert/strict');
const aiService = require('../src/services/aiService');
const { flattenToPrompts } = require('../src/services/aiContextAssembly');

const { logAttachmentTokenPreflight, TOKEN_PREFLIGHT_WARN_THRESHOLD } = aiService;

test('logAttachmentTokenPreflight: an adapter with no countTokens is skipped entirely, never throws', () => {
  const adapter = {}; // claude/openai/self_hosted shape — no countTokens export
  assert.doesNotThrow(() =>
    logAttachmentTokenPreflight({
      adapter,
      aiConfig: {},
      identityContext: { collegeId: 'c1' },
      attachmentHint: 'some attachment text',
      images: [],
      media: [],
    }),
  );
});

test('logAttachmentTokenPreflight: nothing attached (no hint, no images, no media) never calls countTokens', () => {
  let callCount = 0;
  const adapter = {
    countTokens: async () => {
      callCount += 1;
      return { totalTokens: 1 };
    },
  };
  logAttachmentTokenPreflight({
    adapter,
    aiConfig: {},
    identityContext: { collegeId: 'c1' },
    attachmentHint: '',
    images: [],
    media: [],
  });
  assert.equal(callCount, 0);
});

test('logAttachmentTokenPreflight: an attachmentHint present calls countTokens with that text as the measured content', () => {
  let capturedContext;
  const adapter = {
    countTokens: async (cfg, arcnaveContext) => {
      capturedContext = arcnaveContext;
      return { totalTokens: 500 };
    },
  };
  logAttachmentTokenPreflight({
    adapter,
    aiConfig: { model: 'm' },
    identityContext: { collegeId: 'c1' },
    attachmentHint: 'the document says X',
    images: [],
    media: [],
  });
  assert.equal(flattenToPrompts(capturedContext).userPrompt, 'the document says X');
});

test('logAttachmentTokenPreflight: images/media alone (no text hint) still triggers a measurement', () => {
  let callCount = 0;
  const adapter = {
    countTokens: async () => {
      callCount += 1;
      return { totalTokens: 10 };
    },
  };
  logAttachmentTokenPreflight({
    adapter,
    aiConfig: {},
    identityContext: { collegeId: 'c1' },
    attachmentHint: '',
    images: [{ mimeType: 'image/png', base64: 'x' }],
    media: [],
  });
  assert.equal(callCount, 1);
});

test('logAttachmentTokenPreflight: a countTokens rejection is swallowed, never surfaces as an unhandled rejection or a throw', async () => {
  const adapter = {
    countTokens: async () => {
      throw new Error('boom');
    },
  };
  assert.doesNotThrow(() =>
    logAttachmentTokenPreflight({
      adapter,
      aiConfig: {},
      identityContext: { collegeId: 'c1' },
      attachmentHint: 'x',
      images: [],
      media: [],
    }),
  );
  // Let the rejected promise's own .catch() handler actually run before
  // the test process moves on — otherwise a real bug (no .catch at all)
  // would only surface as a flaky "unhandled rejection" on a LATER test.
  await new Promise((resolve) => setImmediate(resolve));
});

test('TOKEN_PREFLIGHT_WARN_THRESHOLD is exported and is a positive number (sanity — a caller could otherwise silently compare against undefined)', () => {
  assert.equal(typeof TOKEN_PREFLIGHT_WARN_THRESHOLD, 'number');
  assert.ok(TOKEN_PREFLIGHT_WARN_THRESHOLD > 0);
});
