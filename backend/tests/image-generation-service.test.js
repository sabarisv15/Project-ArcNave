'use strict';

// Unit tests for AI image generation (RS-AIG-025) — mirrors
// web-retrieval-service.test.js's own shape (the opt-in/not-enabled
// check is genuinely the same pattern, verified against the real
// fetchTrustedPage precedent before this service was built the same
// way). generateImage itself is proven against a mocked adapter, no
// live vendor call.

const test = require('node:test');
const assert = require('node:assert/strict');
const imageGenerationService = require('../src/services/imageGenerationService');
const configurationService = require('../src/services/configurationService');
const documentService = require('../src/services/documentService');

function fakeClient() {
  return { query: async () => ({ rows: [] }) };
}

test('generateImage: empty prompt -> ImageGenerationValidationError, no config lookup', async (t) => {
  const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => { throw new Error('should not be called'); });
  t.after(() => getConfigMock.mock.restore());
  await assert.rejects(
    () => imageGenerationService.generateImage(fakeClient(), { prompt: '  ' }, { collegeId: 'college-a', actorUserId: 'u1' }),
    imageGenerationService.ImageGenerationValidationError,
  );
});

test('generateImage: prompt over the length cap -> ImageGenerationValidationError', async (t) => {
  const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => { throw new Error('should not be called'); });
  t.after(() => getConfigMock.mock.restore());
  await assert.rejects(
    () => imageGenerationService.generateImage(fakeClient(), { prompt: 'x'.repeat(2001) }, { collegeId: 'college-a', actorUserId: 'u1' }),
    imageGenerationService.ImageGenerationValidationError,
  );
});

test('generateImage: not enabled for this college -> ImageGenerationNotEnabledError, no AI config resolved', async (t) => {
  const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
  const getAiConfigMock = t.mock.method(configurationService, 'getAiConfig', async () => { throw new Error('should not be called'); });
  t.after(() => { getConfigMock.mock.restore(); getAiConfigMock.mock.restore(); });
  await assert.rejects(
    () => imageGenerationService.generateImage(fakeClient(), { prompt: 'a red bicycle' }, { collegeId: 'college-a', actorUserId: 'u1' }),
    imageGenerationService.ImageGenerationNotEnabledError,
  );
});

test('generateImage: enabled -> calls the resolved adapter.generateImage and saves via documentService.uploadPersonalDocument', async (t) => {
  const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => ({
    configuration: { enabled: true },
  }));
  const fakeAdapter = {
    name: 'openai',
    generateImage: async (cfg, { prompt }) => {
      assert.equal(prompt, 'a red bicycle');
      return { imageBuffer: Buffer.from('fake-png-bytes'), mimeType: 'image/png' };
    },
  };
  const getAiConfigMock = t.mock.method(configurationService, 'getAiConfig', async () => ({
    provider: 'openai', config: {}, adapter: fakeAdapter,
  }));
  const uploadMock = t.mock.method(documentService, 'uploadPersonalDocument', async (client, fields, opts) => {
    assert.equal(fields.collegeId, 'college-a');
    assert.equal(fields.folderName, 'AI Artifacts');
    assert.equal(fields.mimeType, 'image/png');
    assert.ok(Buffer.isBuffer(fields.fileBuffer));
    assert.equal(opts.actorUserId, 'u1');
    return { id: 'doc-1', file_name: fields.fileName, mime_type: fields.mimeType, title: fields.title };
  });
  t.after(() => { getConfigMock.mock.restore(); getAiConfigMock.mock.restore(); uploadMock.mock.restore(); });

  const result = await imageGenerationService.generateImage(
    fakeClient(), { prompt: 'a red bicycle' }, { collegeId: 'college-a', actorUserId: 'u1' },
  );
  assert.equal(result.id, 'doc-1');
  assert.equal(uploadMock.mock.calls.length, 1);
});

test('generateImage: a provider with no real image API (e.g. Claude) surfaces its own capability error, not a silent no-op', async (t) => {
  const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => ({
    configuration: { enabled: true },
  }));
  class FakeCapabilityError extends Error {}
  const fakeAdapter = {
    name: 'claude',
    generateImage: async () => { throw new FakeCapabilityError('claude has no image-generation endpoint'); },
  };
  const getAiConfigMock = t.mock.method(configurationService, 'getAiConfig', async () => ({
    provider: 'claude', config: {}, adapter: fakeAdapter,
  }));
  t.after(() => { getConfigMock.mock.restore(); getAiConfigMock.mock.restore(); });

  await assert.rejects(
    () => imageGenerationService.generateImage(fakeClient(), { prompt: 'a red bicycle' }, { collegeId: 'college-a', actorUserId: 'u1' }),
    FakeCapabilityError,
  );
});
