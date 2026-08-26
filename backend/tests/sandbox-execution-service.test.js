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
const artifactService = require('../src/services/artifactService');
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

test('sandboxExecutionService.executeCode — outputFile/expectFormulasIn validation (consumer-tool-adaptation file-generation slice)', async (t) => {
  // Configured so these reach request validation rather than
  // SandboxNotConfiguredError — none of these should ever attempt a
  // network call, so no fetch mock is needed for this group.
  const originalUrl = config.sandboxServiceUrl;
  const originalToken = config.sandboxServiceToken;
  t.beforeEach(() => {
    config.sandboxServiceUrl = 'https://sandbox.example.test';
    config.sandboxServiceToken = 'test-token';
  });
  t.afterEach(() => {
    config.sandboxServiceUrl = originalUrl;
    config.sandboxServiceToken = originalToken;
  });

  await t.test('rejects an empty outputFile', async () => {
    await assert.rejects(
      sandboxExecutionService.executeCode({ code: 'print(1)', outputFile: '' }),
      sandboxExecutionService.SandboxValidationError,
    );
  });

  await t.test('rejects expectFormulasIn given without outputFile', async () => {
    await assert.rejects(
      sandboxExecutionService.executeCode({ code: 'print(1)', expectFormulasIn: ['A1'] }),
      sandboxExecutionService.SandboxValidationError,
    );
  });

  await t.test('rejects a non-array expectFormulasIn', async () => {
    await assert.rejects(
      sandboxExecutionService.executeCode({ code: 'print(1)', outputFile: 'out.xlsx', expectFormulasIn: 'A1' }),
      sandboxExecutionService.SandboxValidationError,
    );
  });

  await t.test('rejects an expectFormulasIn entry that is not a short non-empty string', async () => {
    await assert.rejects(
      sandboxExecutionService.executeCode({ code: 'print(1)', outputFile: 'out.xlsx', expectFormulasIn: [''] }),
      sandboxExecutionService.SandboxValidationError,
    );
    await assert.rejects(
      sandboxExecutionService.executeCode({ code: 'print(1)', outputFile: 'out.xlsx', expectFormulasIn: [123] }),
      sandboxExecutionService.SandboxValidationError,
    );
  });

  await t.test('accepts a valid outputFile with a valid expectFormulasIn (passes validation, then attempts the real network call and fails there instead)', async () => {
    // No fetch mock installed in this sub-test — asserting it gets PAST
    // validation and fails on the actual network attempt (a real,
    // unreachable test host) is enough to prove validation accepted it.
    await assert.rejects(
      sandboxExecutionService.executeCode({ code: 'print(1)', outputFile: 'out.xlsx', expectFormulasIn: ['Summary!B2:B9'] }),
      sandboxExecutionService.SandboxExecutionError,
    );
  });
});

test('sandboxExecutionService.executeCode — files/verification pass through a mocked sandbox response', async (t) => {
  const originalUrl = config.sandboxServiceUrl;
  const originalToken = config.sandboxServiceToken;
  const originalFetch = globalThis.fetch;
  config.sandboxServiceUrl = 'https://sandbox.example.test';
  config.sandboxServiceToken = 'test-token';

  t.after(() => {
    config.sandboxServiceUrl = originalUrl;
    config.sandboxServiceToken = originalToken;
    globalThis.fetch = originalFetch;
  });

  await t.test('a verified file and its report come through untouched', async () => {
    const verification = { verdict: 'passed', passed: true, reason: 'ok', formulaCellCount: 2, expectedFormulaCellCount: 2 };
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        stdout: 'built\n',
        stderr: '',
        exitCode: 0,
        files: [{ name: 'out.xlsx', contentBase64: 'AAAA' }],
        verification,
      }),
    });
    const result = await sandboxExecutionService.executeCode({
      code: 'print(1)', outputFile: 'out.xlsx', expectFormulasIn: ['Summary!B2:B9'],
    });
    assert.deepEqual(result.files, [{ name: 'out.xlsx', contentBase64: 'AAAA' }]);
    assert.deepEqual(result.verification, verification);
  });

  await t.test('a plain call with no outputFile always returns files: [] and verification: null, even if the sandbox sent something', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        stdout: '1\n', stderr: '', exitCode: 0,
      }),
    });
    const result = await sandboxExecutionService.executeCode({ code: 'print(1)' });
    assert.deepEqual(result.files, []);
    assert.equal(result.verification, null);
  });

  await t.test('a returned file exceeding MAX_RETURNED_FILE_BYTES is rejected, not silently truncated', async () => {
    const oversizedBase64 = 'A'.repeat(Math.ceil((sandboxExecutionService.MAX_RETURNED_FILE_BYTES + 1024) / 0.75));
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        stdout: '', stderr: '', exitCode: 0,
        files: [{ name: 'huge.xlsx', contentBase64: oversizedBase64 }],
        verification: null,
      }),
    });
    await assert.rejects(
      sandboxExecutionService.executeCode({ code: 'print(1)', outputFile: 'huge.xlsx' }),
      sandboxExecutionService.SandboxExecutionError,
    );
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

  await t.test('saveAs/expectFormulasIn are declared, optional params', () => {
    const tool = aiToolRegistry.getTool('execute_code');
    assert.ok('saveAs' in tool.params.properties);
    assert.ok('expectFormulasIn' in tool.params.properties);
    assert.deepEqual(tool.params.required, ['code']);
  });
});

test('execute_code handler — saveAs/expectFormulasIn wiring (consumer-tool-adaptation file-generation slice)', async (t) => {
  const tool = aiToolRegistry.getTool('execute_code');
  const actor = { userId: 'u1', role: 'staff', collegeId: 'c1' };

  const originalExecuteCode = sandboxExecutionService.executeCode;
  const originalCreateArtifact = artifactService.createArtifact;
  const originalAttachGeneratedFile = artifactService.attachGeneratedFile;
  t.afterEach(() => {
    sandboxExecutionService.executeCode = originalExecuteCode;
    artifactService.createArtifact = originalCreateArtifact;
    artifactService.attachGeneratedFile = originalAttachGeneratedFile;
  });

  await t.test('with no saveAs, the result is byte-identical to the pre-existing shape — no artifact/document call happens', async () => {
    let createCalled = false;
    sandboxExecutionService.executeCode = async () => ({
      stdout: '1\n', stderr: '', exitCode: 0, files: [], verification: null,
    });
    artifactService.createArtifact = async () => { createCalled = true; };

    const result = await tool.handler(null, { code: 'print(1)' }, actor);

    assert.deepEqual(result, {
      stdout: '1\n', stderr: '', exitCode: 0, files: [], verification: null,
    });
    assert.equal(createCalled, false);
  });

  await t.test('a verified file creates an artifact, attaches the file, and reports both ids — never the raw bytes', async () => {
    const verification = { verdict: 'passed', passed: true, reason: 'ok', formulaCellCount: 1, expectedFormulaCellCount: 1 };
    sandboxExecutionService.executeCode = async () => ({
      stdout: 'built\n', stderr: '', exitCode: 0, files: [{ name: 'breakdown.xlsx', contentBase64: 'AAAA' }], verification,
    });
    let createArgs = null;
    let attachArgs = null;
    artifactService.createArtifact = async (client, fields, ctx) => {
      createArgs = { fields, ctx };
      return { id: 'artifact-1' };
    };
    artifactService.attachGeneratedFile = async (client, id, payload, ctx) => {
      attachArgs = {
        id, payload, ctx,
      };
      return {
        generatedDocumentId: 'doc-1', document_file_name: 'breakdown.xlsx', document_mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    };

    const result = await tool.handler(null, {
      code: 'print("build")', saveAs: 'breakdown.xlsx', expectFormulasIn: ['Summary!B2:B9'],
    }, actor);

    assert.equal(result.attached, true);
    assert.equal(result.fileProduced, true);
    assert.equal(result.artifactId, 'artifact-1');
    assert.equal(result.generatedDocumentId, 'doc-1');
    assert.equal(result.verification, verification);
    assert.equal(result.title, 'breakdown');
    assert.ok(!('files' in result), 'raw file bytes must never ride in the tool result once attached');

    assert.equal(createArgs.fields.artifactType, 'Spreadsheet');
    assert.match(createArgs.fields.content, /print\("build"\)/);
    assert.equal(attachArgs.id, 'artifact-1');
    assert.equal(attachArgs.payload.fileName, 'breakdown.xlsx');
    assert.equal(attachArgs.payload.verification, verification);
    assert.ok(Buffer.isBuffer(attachArgs.payload.buffer));
  });

  await t.test('a failed verification never creates an artifact and never attaches a file', async () => {
    const verification = {
      verdict: 'failed', passed: false, reason: '1 expected formula cell(s) hold literal values', constants: [{ cell: 'Summary!B1' }],
    };
    sandboxExecutionService.executeCode = async () => ({
      stdout: '', stderr: '', exitCode: 0, files: [{ name: 'breakdown.xlsx', contentBase64: 'AAAA' }], verification,
    });
    let createCalled = false;
    artifactService.createArtifact = async () => { createCalled = true; return { id: 'should-not-happen' }; };

    const result = await tool.handler(null, {
      code: 'print("build")', saveAs: 'breakdown.xlsx', expectFormulasIn: ['Summary!B1'],
    }, actor);

    assert.equal(result.attached, false);
    assert.equal(result.fileProduced, true);
    assert.equal(result.verification, verification);
    assert.equal(createCalled, false);
    assert.ok(!('artifactId' in result));
  });

  await t.test('an unverified (no expectFormulasIn) result is also refused, not silently attached', async () => {
    sandboxExecutionService.executeCode = async () => ({
      stdout: '', stderr: '', exitCode: 0, files: [{ name: 'out.xlsx', contentBase64: 'AAAA' }], verification: null,
    });
    let createCalled = false;
    artifactService.createArtifact = async () => { createCalled = true; return { id: 'nope' }; };

    const result = await tool.handler(null, { code: 'print(1)', saveAs: 'out.xlsx' }, actor);

    assert.equal(result.attached, false);
    assert.equal(createCalled, false);
  });
});
