'use strict';

// ADR-030 P2(c) — config.maxToolCallsPerTurn validation. Loaded fresh per
// test (delete require.cache + re-require) since config.js computes this
// value once, at module-load time, from process.env — not a getter
// re-evaluated on every access, so an already-loaded module instance
// can't be used to test different env values.
const test = require('node:test');
const assert = require('node:assert/strict');

function loadConfigWithEnv(value) {
  const original = process.env.MAX_TOOL_CALLS_PER_TURN;
  if (value === undefined) {
    delete process.env.MAX_TOOL_CALLS_PER_TURN;
  } else {
    process.env.MAX_TOOL_CALLS_PER_TURN = value;
  }
  delete require.cache[require.resolve('../src/config')];
  try {
    return require('../src/config');
  } finally {
    if (original === undefined) {
      delete process.env.MAX_TOOL_CALLS_PER_TURN;
    } else {
      process.env.MAX_TOOL_CALLS_PER_TURN = original;
    }
    delete require.cache[require.resolve('../src/config')];
  }
}

test('config.maxToolCallsPerTurn: unset/empty defaults to 1 (compatibility mode)', () => {
  assert.equal(loadConfigWithEnv(undefined).maxToolCallsPerTurn, 1);
  assert.equal(loadConfigWithEnv('').maxToolCallsPerTurn, 1);
});

test('config.maxToolCallsPerTurn: a valid integer in range 1-5 is accepted verbatim', () => {
  assert.equal(loadConfigWithEnv('1').maxToolCallsPerTurn, 1);
  assert.equal(loadConfigWithEnv('3').maxToolCallsPerTurn, 3);
  assert.equal(loadConfigWithEnv('5').maxToolCallsPerTurn, 5);
});

test('config.maxToolCallsPerTurn: "0" is rejected — not a valid tool-execution count', () => {
  assert.throws(() => loadConfigWithEnv('0'), /MAX_TOOL_CALLS_PER_TURN must be an integer between 1 and 5/);
});

test('config.maxToolCallsPerTurn: a negative value is rejected', () => {
  assert.throws(() => loadConfigWithEnv('-1'), /MAX_TOOL_CALLS_PER_TURN must be an integer between 1 and 5/);
});

test('config.maxToolCallsPerTurn: a decimal is rejected — parseInt("2.5") silently truncating to 2 must NOT happen here', () => {
  assert.throws(() => loadConfigWithEnv('2.5'), /MAX_TOOL_CALLS_PER_TURN must be an integer between 1 and 5/);
});

test('config.maxToolCallsPerTurn: trailing garbage is rejected — parseInt("3abc") silently returning 3 must NOT happen here', () => {
  assert.throws(() => loadConfigWithEnv('3abc'), /MAX_TOOL_CALLS_PER_TURN must be an integer between 1 and 5/);
});

test('config.maxToolCallsPerTurn: above the hard ceiling (6) is rejected — never raisable past 5 via env var alone', () => {
  assert.throws(() => loadConfigWithEnv('6'), /MAX_TOOL_CALLS_PER_TURN must be an integer between 1 and 5/);
});

// Review Finding #6 — PDF_PLUMBER_FALLBACK_ENABLED's own boolean parsing.
// Same delete-require.cache-and-reload technique as above, since this is
// also computed once at module-load time.
function loadConfigWithPdfPlumberEnv(value) {
  const original = process.env.PDF_PLUMBER_FALLBACK_ENABLED;
  if (value === undefined) {
    delete process.env.PDF_PLUMBER_FALLBACK_ENABLED;
  } else {
    process.env.PDF_PLUMBER_FALLBACK_ENABLED = value;
  }
  delete require.cache[require.resolve('../src/config')];
  try {
    return require('../src/config');
  } finally {
    if (original === undefined) {
      delete process.env.PDF_PLUMBER_FALLBACK_ENABLED;
    } else {
      process.env.PDF_PLUMBER_FALLBACK_ENABLED = original;
    }
    delete require.cache[require.resolve('../src/config')];
  }
}

test('config.pdfPlumberFallbackEnabled: unset resolves to the safe default (false)', () => {
  assert.equal(loadConfigWithPdfPlumberEnv(undefined).pdfPlumberFallbackEnabled, false);
});

test('config.pdfPlumberFallbackEnabled: "true" resolves to true', () => {
  assert.equal(loadConfigWithPdfPlumberEnv('true').pdfPlumberFallbackEnabled, true);
});

test('config.pdfPlumberFallbackEnabled: "false" resolves to false', () => {
  assert.equal(loadConfigWithPdfPlumberEnv('false').pdfPlumberFallbackEnabled, false);
});

test('config.pdfPlumberFallbackEnabled: an unsafe truthy string never accidentally enables it — only the exact literal "true" does', () => {
  assert.equal(loadConfigWithPdfPlumberEnv('1').pdfPlumberFallbackEnabled, false);
  assert.equal(loadConfigWithPdfPlumberEnv('yes').pdfPlumberFallbackEnabled, false);
  assert.equal(loadConfigWithPdfPlumberEnv('TRUE').pdfPlumberFallbackEnabled, false);
  assert.equal(loadConfigWithPdfPlumberEnv('').pdfPlumberFallbackEnabled, false);
});
