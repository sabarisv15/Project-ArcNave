'use strict';

// Unit tests for sandboxExecutionService.js (ADL-059) — the ARCNAVE-side
// client half of the code-execution sandbox. The "not configured" tests
// below explicitly clear config.sandboxServiceUrl/sandboxServiceToken
// for their own duration rather than assuming they're globally unset —
// a real sandbox is now deployed and configured on at least one real
// dev machine (ADL-059's own first deployment), so this suite must pass
// regardless of whether SANDBOX_SERVICE_URL happens to be set in the
// ambient environment it runs in.

const test = require('node:test');
const assert = require('node:assert/strict');
const sandboxExecutionService = require('../src/services/sandboxExecutionService');
const aiToolRegistry = require('../src/services/aiToolRegistry');
const config = require('../src/config');

function withSandboxUnconfigured(fn) {
  return async () => {
    const originalUrl = config.sandboxServiceUrl;
    const originalToken = config.sandboxServiceToken;
    config.sandboxServiceUrl = null;
    config.sandboxServiceToken = null;
    try {
      await fn();
    } finally {
      config.sandboxServiceUrl = originalUrl;
      config.sandboxServiceToken = originalToken;
    }
  };
}

test('sandboxExecutionService.executeCode — not configured', async (t) => {
  await t.test('throws SandboxNotConfiguredError when SANDBOX_SERVICE_URL/TOKEN are unset', withSandboxUnconfigured(async () => {
    await assert.rejects(
      sandboxExecutionService.executeCode({ code: 'print(1)' }),
      sandboxExecutionService.SandboxNotConfiguredError,
    );
  }));
});

test('sandboxExecutionService — request validation precedence', async (t) => {
  await t.test('configuration is checked before request validation — empty code against an unconfigured sandbox still surfaces SandboxNotConfiguredError, not a validation error', withSandboxUnconfigured(async () => {
    await assert.rejects(
      sandboxExecutionService.executeCode({ code: '' }),
      sandboxExecutionService.SandboxNotConfiguredError,
    );
  }));

  await t.test('code and file size ceilings are exported and sane', () => {
    assert.equal(sandboxExecutionService.MAX_CODE_CHARS, 20000);
    assert.equal(sandboxExecutionService.MAX_FILE_BYTES, 5 * 1024 * 1024);
  });
});

test('execute_code tool registration (ADL-059)', async (t) => {
  await t.test('registered, L1, Internal, reachable by every tenant role, not humanOnly', () => {
    const tool = aiToolRegistry.getTool('execute_code');
    assert.ok(tool, 'expected execute_code to be registered');
    assert.equal(tool.level, 'L1');
    assert.equal(tool.dataClassification, 'Internal');
    assert.deepEqual([...tool.allowedRoles].sort(), ['class_tutor', 'hod', 'principal', 'staff']);
    assert.ok(!tool.humanOnly);
  });

  await t.test('attachmentId is optional; code is required', () => {
    const tool = aiToolRegistry.getTool('execute_code');
    assert.deepEqual(tool.params.required, ['code']);
    assert.ok('attachmentId' in tool.params.properties);
  });

  await t.test('an invalid (non-uuid) attachmentId is rejected before any sandbox call', async () => {
    const tool = aiToolRegistry.getTool('execute_code');
    await assert.rejects(
      tool.handler(null, { code: 'print(1)', attachmentId: 'not-a-uuid' }, { userId: 'u1', role: 'staff', collegeId: 'c1' }),
      aiToolRegistry.AiToolInvalidParamsError,
    );
  });
});
