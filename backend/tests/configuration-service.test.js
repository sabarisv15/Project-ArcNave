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

test('getAiConfig: no per-college row falls back to the global nim default, unchanged from pre-existing behavior', async (t) => {
  const findMock = t.mock.method(aiConfigRepository, 'findByCollegeId', async () => null);
  t.after(() => findMock.mock.restore());

  const result = await configurationService.getAiConfig({}, 'college-with-no-row');

  assert.equal(result.provider, 'nim');
  assert.equal(result.adapter.name, 'nim');
  assert.equal(result.config.apiKey, globalConfig.nim.apiKey);
  assert.equal(result.config.model, globalConfig.nim.model);
  assert.equal(result.config.embeddingModel, globalConfig.nim.embeddingModel);
});

test('getAiConfig: a college with its own row uses its own provider/decrypted key, not the global default', async (t) => {
  const encryptedKey = cryptoUtil.encryptSecret('college-specific-real-key');
  const findMock = t.mock.method(aiConfigRepository, 'findByCollegeId', async () => ({
    provider: 'gemini', api_key: encryptedKey, model: 'gemini-2.5-flash', embedding_model: 'text-embedding-004', base_url: null,
  }));
  t.after(() => findMock.mock.restore());

  const result = await configurationService.getAiConfig({}, 'college-with-a-row');

  assert.equal(result.provider, 'gemini');
  assert.equal(result.adapter.name, 'gemini');
  assert.equal(result.config.apiKey, 'college-specific-real-key');
  assert.equal(result.config.model, 'gemini-2.5-flash');
});

test('getAiConfig: switching one college to a different provider never touches another college\'s config (independent repository calls)', async (t) => {
  const rows = {
    'college-a': { provider: 'claude', api_key: cryptoUtil.encryptSecret('a-key'), model: 'claude-sonnet-4', embedding_model: null, base_url: null },
  };
  const findMock = t.mock.method(aiConfigRepository, 'findByCollegeId', async (client, collegeId) => rows[collegeId] || null);
  t.after(() => findMock.mock.restore());

  const a = await configurationService.getAiConfig({}, 'college-a');
  const b = await configurationService.getAiConfig({}, 'college-b');

  assert.equal(a.provider, 'claude');
  assert.equal(a.config.apiKey, 'a-key');
  assert.equal(b.provider, 'nim');
  assert.equal(b.config.apiKey, globalConfig.nim.apiKey);
});

test('setAiConfig: rejects an unknown provider before any DB write', async (t) => {
  const upsertMock = t.mock.method(aiConfigRepository, 'upsert', async () => { throw new Error('should not be called'); });
  t.after(() => upsertMock.mock.restore());

  await assert.rejects(
    () => configurationService.setAiConfig({}, 'college-a', { provider: 'not_a_real_vendor', apiKey: 'x' }, { userId: 'u1' }),
    (require('../src/services/aiProviders')).AiProviderUnknownError,
  );
  assert.equal(upsertMock.mock.callCount(), 0);
});

test('setAiConfig: encrypts api_key before it reaches the repository, and never returns the raw key or its ciphertext', async (t) => {
  const upsertMock = t.mock.method(aiConfigRepository, 'upsert', async (client, fields) => ({
    id: 'cfg-1', college_id: fields.collegeId, provider: fields.provider, api_key: fields.apiKey, model: fields.model, embedding_model: fields.embeddingModel, base_url: fields.baseUrl, updated_at: new Date(),
  }));
  const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
  t.after(() => {
    upsertMock.mock.restore();
    auditMock.mock.restore();
  });

  const result = await configurationService.setAiConfig({}, 'college-a', {
    provider: 'nim', apiKey: 'sk-real-secret-value', model: 'meta/llama-3.1-8b-instruct',
  }, { userId: 'u1' });

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
