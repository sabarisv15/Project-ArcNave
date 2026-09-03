'use strict';

// Unit tests for ConfigurationService's getAiConfig/setAiConfig — no
// live Postgres: aiConfigRepository and auditLogRepository are stubbed
// via node:test's built-in mock, same technique document-service.test.js
// already uses for its own dependencies.

const test = require('node:test');
const assert = require('node:assert/strict');
const aiConfigRepository = require('../src/repositories/aiConfigRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const cryptoUtil = require('../src/cryptoUtil');
const globalConfig = require('../src/config');
const configurationService = require('../src/services/configurationService');

test('getAiConfig: no per-college row falls back to the global openai default when DEFAULT_AI_PROVIDER=openai', async (t) => {
  const findMock = t.mock.method(aiConfigRepository, 'findByCollegeId', async () => null);
  t.after(() => findMock.mock.restore());
  // openai's global block was added alongside the NIM removal (ADL-051)
  // specifically so DEFAULT_AI_PROVIDER=openai is a real, working
  // choice — this test proves that block resolves correctly, the same
  // way the dedicated gemini/claude tests below prove theirs. Force it
  // regardless of a real dev/deployment environment's own
  // DEFAULT_AI_PROVIDER override (e.g. a local .env.local.sh set to
  // 'gemini' to run the dev server against a real key).
  const originalDefaultAiProvider = globalConfig.defaultAiProvider;
  const originalOpenaiApiKey = globalConfig.openai.apiKey;
  globalConfig.defaultAiProvider = 'openai';
  globalConfig.openai.apiKey = 'openai-real-key';
  t.after(() => {
    globalConfig.defaultAiProvider = originalDefaultAiProvider;
    globalConfig.openai.apiKey = originalOpenaiApiKey;
  });

  const result = await configurationService.getAiConfig({}, 'college-with-no-row');

  assert.equal(result.provider, 'openai');
  assert.equal(result.adapter.name, 'openai');
  assert.equal(result.config.apiKey, globalConfig.openai.apiKey);
  assert.equal(result.config.model, globalConfig.openai.model);
  assert.equal(result.config.embeddingModel, globalConfig.openai.embeddingModel);
});

test('getAiConfig: a college with its own row uses its own provider/decrypted key, not the global default', async (t) => {
  const encryptedKey = cryptoUtil.encryptSecret('college-specific-real-key');
  const findMock = t.mock.method(aiConfigRepository, 'findByCollegeId', async () => ({
    provider: 'gemini',
    api_key: encryptedKey,
    model: 'gemini-2.5-flash',
    embedding_model: 'text-embedding-004',
    base_url: null,
  }));
  t.after(() => findMock.mock.restore());

  const result = await configurationService.getAiConfig({}, 'college-with-a-row');

  assert.equal(result.provider, 'gemini');
  assert.equal(result.adapter.name, 'gemini');
  assert.equal(result.config.apiKey, 'college-specific-real-key');
  assert.equal(result.config.model, 'gemini-2.5-flash');
});

test("getAiConfig: switching one college to a different provider never touches another college's config (independent repository calls)", async (t) => {
  const rows = {
    'college-a': {
      provider: 'claude',
      api_key: cryptoUtil.encryptSecret('a-key'),
      model: 'claude-sonnet-4',
      embedding_model: null,
      base_url: null,
    },
  };
  const findMock = t.mock.method(
    aiConfigRepository,
    'findByCollegeId',
    async (client, collegeId) => rows[collegeId] || null,
  );
  t.after(() => findMock.mock.restore());
  // See the previous test's own comment — this test asserts college-b
  // falls back to the global default (openai, forced below) specifically.
  const originalDefaultAiProvider = globalConfig.defaultAiProvider;
  globalConfig.defaultAiProvider = 'openai';
  t.after(() => {
    globalConfig.defaultAiProvider = originalDefaultAiProvider;
  });

  const a = await configurationService.getAiConfig({}, 'college-a');
  const b = await configurationService.getAiConfig({}, 'college-b');

  assert.equal(a.provider, 'claude');
  assert.equal(a.config.apiKey, 'a-key');
  assert.equal(b.provider, 'openai');
  assert.equal(b.config.apiKey, globalConfig.openai.apiKey);
});

test('getAiConfig: DEFAULT_AI_PROVIDER=gemini routes a no-row college to the global gemini config', async (t) => {
  const findMock = t.mock.method(aiConfigRepository, 'findByCollegeId', async () => null);
  t.after(() => findMock.mock.restore());
  const originalDefaultAiProvider = globalConfig.defaultAiProvider;
  const originalGeminiProjectId = globalConfig.gemini.projectId;
  const originalGeminiModel = globalConfig.gemini.model;
  globalConfig.defaultAiProvider = 'gemini';
  globalConfig.gemini.projectId = 'gemini-real-project';
  globalConfig.gemini.model = 'gemini-3.8-flash';
  t.after(() => {
    globalConfig.defaultAiProvider = originalDefaultAiProvider;
    globalConfig.gemini.projectId = originalGeminiProjectId;
    globalConfig.gemini.model = originalGeminiModel;
  });

  const result = await configurationService.getAiConfig({}, 'college-with-no-row');

  assert.equal(result.provider, 'gemini');
  assert.equal(result.adapter.name, 'gemini');
  assert.equal(result.config.projectId, 'gemini-real-project');
  assert.equal(result.config.model, 'gemini-3.8-flash');
});

test('getAiConfig: an unrecognized DEFAULT_AI_PROVIDER (typo, or a provider with no global block) falls back to gemini rather than throwing', async (t) => {
  const findMock = t.mock.method(aiConfigRepository, 'findByCollegeId', async () => null);
  t.after(() => findMock.mock.restore());
  const originalDefaultAiProvider = globalConfig.defaultAiProvider;
  // self_hosted has no global env-backed block (per-college-only by
  // design — see GLOBAL_CONFIG_BUILDERS's own comment). claude/openai
  // both gained one (Vertex AI/plain apiKey respectively) so neither
  // fits this test's premise anymore — see their own dedicated tests.
  globalConfig.defaultAiProvider = 'self_hosted';
  t.after(() => {
    globalConfig.defaultAiProvider = originalDefaultAiProvider;
  });

  const result = await configurationService.getAiConfig({}, 'college-with-no-row');

  assert.equal(result.provider, 'gemini');
});

test('getAiConfig: DEFAULT_AI_PROVIDER=claude resolves via its own global Vertex AI block (projectId, not apiKey)', async (t) => {
  const findMock = t.mock.method(aiConfigRepository, 'findByCollegeId', async () => null);
  t.after(() => findMock.mock.restore());
  const originalDefaultAiProvider = globalConfig.defaultAiProvider;
  const originalClaudeConfig = globalConfig.claude;
  globalConfig.defaultAiProvider = 'claude';
  globalConfig.claude = {
    projectId: 'claude-real-project',
    location: null,
    model: 'claude-sonnet-5',
    fastModel: null,
  };
  t.after(() => {
    globalConfig.defaultAiProvider = originalDefaultAiProvider;
    globalConfig.claude = originalClaudeConfig;
  });

  const result = await configurationService.getAiConfig({}, 'college-with-no-row');

  assert.equal(result.provider, 'claude');
  assert.equal(result.adapter.name, 'claude');
  assert.equal(result.config.projectId, 'claude-real-project');
  assert.equal(result.config.model, 'claude-sonnet-5');
});

// --- Review Finding #7 (2026-08-29) — resolveAiConfig, the only place
// config.experimentalReasoningModel is allowed to change what a college
// gets. Every test here restores globalConfig.experimentalReasoningModel
// itself (not mock.method — it's a plain config value, not a function).

function withExperimentalReasoningModel(value, fn) {
  const original = globalConfig.experimentalReasoningModel;
  globalConfig.experimentalReasoningModel = value;
  return fn().finally(() => {
    globalConfig.experimentalReasoningModel = original;
  });
}

test('resolveAiConfig (Test 1): a college with explicit config wins even when the experiment is enabled', async (t) => {
  const findMock = t.mock.method(aiConfigRepository, 'findByCollegeId', async () => ({
    provider: 'gemini',
    api_key: null,
    model: 'approved-model',
    embedding_model: null,
    base_url: null,
  }));
  t.after(() => findMock.mock.restore());

  await withExperimentalReasoningModel('experimental-model', async () => {
    const result = await configurationService.resolveAiConfig({}, 'college-a', { allowExperimentalFallback: true });
    assert.equal(result.provider, 'gemini');
    assert.equal(result.config.model, 'approved-model');
    assert.equal(result.configSource, 'college_explicit');
    assert.equal(result.experimentalOverrideApplied, false);
  });
});

test('resolveAiConfig (Test 2): a college with explicit config is used identically when the experiment is disabled', async (t) => {
  const findMock = t.mock.method(aiConfigRepository, 'findByCollegeId', async () => ({
    provider: 'gemini',
    api_key: null,
    model: 'approved-model',
    embedding_model: null,
    base_url: null,
  }));
  t.after(() => findMock.mock.restore());

  await withExperimentalReasoningModel(null, async () => {
    const result = await configurationService.resolveAiConfig({}, 'college-a', { allowExperimentalFallback: true });
    assert.equal(result.provider, 'gemini');
    assert.equal(result.config.model, 'approved-model');
    assert.equal(result.configSource, 'college_explicit');
    assert.equal(result.experimentalOverrideApplied, false);
  });
});

test('resolveAiConfig (Test 3): no explicit college config + experiment enabled + caller opts in -> the experimental model applies', async (t) => {
  const findMock = t.mock.method(aiConfigRepository, 'findByCollegeId', async () => null);
  t.after(() => findMock.mock.restore());

  await withExperimentalReasoningModel('experimental-model', async () => {
    const result = await configurationService.resolveAiConfig({}, 'college-b', { allowExperimentalFallback: true });
    assert.equal(result.provider, 'vertex_maas');
    assert.equal(result.config.model, 'experimental-model');
    assert.equal(result.configSource, 'experimental_fallback');
    assert.equal(result.experimentalOverrideApplied, true);
  });
});

test('resolveAiConfig (Test 4): no explicit college config + experiment disabled -> the existing normal platform default applies, never an experimental provider', async (t) => {
  const findMock = t.mock.method(aiConfigRepository, 'findByCollegeId', async () => null);
  t.after(() => findMock.mock.restore());

  await withExperimentalReasoningModel(null, async () => {
    const result = await configurationService.resolveAiConfig({}, 'college-b', { allowExperimentalFallback: true });
    assert.notEqual(result.provider, 'vertex_maas');
    assert.equal(result.configSource, 'platform_default');
    assert.equal(result.experimentalOverrideApplied, false);
  });
});

// Test 5 (AI disabled/opted-out college) — college_ai_config has no
// enabled/disabled or opt-out column at all (see schema.sql), so there is
// no data-model state to fabricate here. The closest real mechanism this
// codebase actually has is the CALLER's own allowExperimentalFallback
// opt-in (askAgent's two reasoning-mode call sites pass true; every other
// configurationService.getAiConfig caller never passes through
// resolveAiConfig at all) — this test covers that the experiment can
// never apply when a caller doesn't ask for it, regardless of the global
// flag or the college's own config shape.
test('resolveAiConfig (Test 5, documented limitation): a caller that does not opt in never receives the experimental override, whatever the college/global state', async (t) => {
  const findMock = t.mock.method(aiConfigRepository, 'findByCollegeId', async () => null);
  t.after(() => findMock.mock.restore());

  await withExperimentalReasoningModel('experimental-model', async () => {
    const result = await configurationService.resolveAiConfig({}, 'college-b', { allowExperimentalFallback: false });
    assert.notEqual(result.provider, 'vertex_maas');
    assert.equal(result.experimentalOverrideApplied, false);
  });
});

test("resolveAiConfig (Test 6): tenant isolation — one college's explicit config and another's fallback never leak into each other", async (t) => {
  const rows = {
    'college-a': {
      provider: 'gemini',
      api_key: null,
      model: 'approved-model',
      embedding_model: null,
      base_url: null,
    },
  };
  const findMock = t.mock.method(
    aiConfigRepository,
    'findByCollegeId',
    async (client, collegeId) => rows[collegeId] || null,
  );
  t.after(() => findMock.mock.restore());

  await withExperimentalReasoningModel('experimental-model', async () => {
    const a = await configurationService.resolveAiConfig({}, 'college-a', { allowExperimentalFallback: true });
    const b = await configurationService.resolveAiConfig({}, 'college-b', { allowExperimentalFallback: true });
    assert.equal(a.provider, 'gemini');
    assert.equal(a.configSource, 'college_explicit');
    assert.equal(b.provider, 'vertex_maas');
    assert.equal(b.configSource, 'experimental_fallback');
    // Neither result carries the other college's model string.
    assert.notEqual(a.config.model, b.config.model);
  });
});

test('resolveAiConfig (Test 7): an explicit but invalid college config (unknown provider) throws — the experiment never becomes an accidental bypass for a broken explicit config', async (t) => {
  const findMock = t.mock.method(aiConfigRepository, 'findByCollegeId', async () => ({
    provider: 'not_a_real_vendor',
    api_key: null,
    model: 'whatever',
    embedding_model: null,
    base_url: null,
  }));
  t.after(() => findMock.mock.restore());

  await withExperimentalReasoningModel('experimental-model', async () => {
    await assert.rejects(
      () => configurationService.resolveAiConfig({}, 'college-a', { allowExperimentalFallback: true }),
      require('../src/services/aiProviders').AiProviderUnknownError,
    );
  });
});

test('setAiConfig: rejects an unknown provider before any DB write', async (t) => {
  const upsertMock = t.mock.method(aiConfigRepository, 'upsert', async () => {
    throw new Error('should not be called');
  });
  t.after(() => upsertMock.mock.restore());

  await assert.rejects(
    () =>
      configurationService.setAiConfig(
        {},
        'college-a',
        { provider: 'not_a_real_vendor', apiKey: 'x' },
        { userId: 'u1' },
      ),
    require('../src/services/aiProviders').AiProviderUnknownError,
  );
  assert.equal(upsertMock.mock.callCount(), 0);
});

test('setAiConfig: encrypts api_key before it reaches the repository, and never returns the raw key or its ciphertext', async (t) => {
  const upsertMock = t.mock.method(aiConfigRepository, 'upsert', async (client, fields) => ({
    id: 'cfg-1',
    college_id: fields.collegeId,
    provider: fields.provider,
    api_key: fields.apiKey,
    model: fields.model,
    embedding_model: fields.embeddingModel,
    base_url: fields.baseUrl,
    updated_at: new Date(),
  }));
  const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
  t.after(() => {
    upsertMock.mock.restore();
    auditMock.mock.restore();
  });

  const result = await configurationService.setAiConfig(
    {},
    'college-a',
    {
      provider: 'openai',
      apiKey: 'sk-real-secret-value',
      model: 'gpt-4o',
    },
    { userId: 'u1' },
  );

  const [, upsertFields] = upsertMock.mock.calls[0].arguments;
  assert.notEqual(upsertFields.apiKey, 'sk-real-secret-value');
  assert.equal(cryptoUtil.decryptSecret(upsertFields.apiKey), 'sk-real-secret-value');

  assert.equal(result.hasApiKey, true);
  assert.equal(JSON.stringify(result).includes('sk-real-secret-value'), false);
  assert.equal('apiKey' in result, false);
  assert.equal('api_key' in result, false);

  const [, auditFields] = auditMock.mock.calls[0].arguments;
  assert.equal(auditFields.action, 'ai_config_updated');
  assert.equal(JSON.stringify(auditFields.metadata).includes('sk-real-secret-value'), false);
});
