'use strict';

// Unit tests for the aiProviders adapter registry — no live network
// calls to any real vendor (nim.js's own request-shape behavior is
// already proven against mocked fetch in ai-service.test.js; this file
// proves the shared interface contract every adapter must satisfy, and
// getAdapter's own resolution/error behavior).

const test = require('node:test');
const assert = require('node:assert/strict');
const aiProviders = require('../src/services/aiProviders');

const REQUIRED_METHODS = ['isConfigured', 'complete', 'completeWithTools', 'embed'];

test('aiProviders: every registered adapter implements the full common interface', () => {
  for (const providerName of aiProviders.KNOWN_PROVIDERS) {
    const adapter = aiProviders.getAdapter(providerName);
    for (const method of REQUIRED_METHODS) {
      assert.equal(typeof adapter[method], 'function', `${providerName}.${method} must be a function`);
    }
  }
});

test('aiProviders.getAdapter: known providers resolve to their own module', () => {
  assert.equal(aiProviders.getAdapter('nim').name, 'nim');
  assert.equal(aiProviders.getAdapter('gemini').name, 'gemini');
  assert.equal(aiProviders.getAdapter('claude').name, 'claude');
  assert.equal(aiProviders.getAdapter('self_hosted').name, 'self_hosted');
  assert.equal(aiProviders.getAdapter('openai').name, 'openai');
});

test('aiProviders: supportsVision is explicit per adapter, never inferred from name', () => {
  assert.equal(aiProviders.getAdapter('claude').supportsVision, true);
  assert.equal(aiProviders.getAdapter('gemini').supportsVision, true);
  assert.equal(aiProviders.getAdapter('openai').supportsVision, true);
  assert.equal(aiProviders.getAdapter('nim').supportsVision, false);
  assert.equal(aiProviders.getAdapter('self_hosted').supportsVision, false);
});

test('aiProviders.getAdapter: an unknown provider name throws AiProviderUnknownError', () => {
  assert.throws(
    () => aiProviders.getAdapter('some_vendor_nobody_built'),
    aiProviders.AiProviderUnknownError,
  );
});

test('nim/gemini/selfHosted/openai adapters: isConfigured is false with an empty config', () => {
  assert.equal(aiProviders.getAdapter('nim').isConfigured({}), false);
  assert.equal(aiProviders.getAdapter('gemini').isConfigured({}), false);
  assert.equal(aiProviders.getAdapter('self_hosted').isConfigured({}), false);
  assert.equal(aiProviders.getAdapter('claude').isConfigured({}), false);
  assert.equal(aiProviders.getAdapter('openai').isConfigured({}), false);
});

test('openai adapter: isConfigured requires apiKey specifically', () => {
  const openai = aiProviders.getAdapter('openai');
  assert.equal(openai.isConfigured({ apiKey: 'k' }), true);
  assert.equal(openai.isConfigured({ baseUrl: 'https://example.com' }), false);
});

test('selfHosted adapter: isConfigured requires baseUrl specifically, not apiKey', () => {
  const selfHosted = aiProviders.getAdapter('self_hosted');
  assert.equal(selfHosted.isConfigured({ apiKey: 'k', baseUrl: undefined }), false);
  assert.equal(selfHosted.isConfigured({ apiKey: undefined, baseUrl: 'http://localhost:8000' }), true);
});

test('claude adapter: embed() throws AiProviderCapabilityError — a real vendor limitation, not a silent fake', async () => {
  const claude = aiProviders.getAdapter('claude');
  await assert.rejects(
    () => claude.embed({ apiKey: 'k' }, ['text'], { inputType: 'passage' }),
    aiProviders.AiProviderCapabilityError,
  );
});

test('claude adapter.completeWithTools: a cache_control breakpoint is set on the LAST tool only, and the caching beta header is sent (P1.2)', async () => {
  const claude = aiProviders.getAdapter('claude');
  const originalFetch = global.fetch;
  let capturedBody;
  let capturedHeaders;
  global.fetch = async (url, options) => {
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    };
  };
  try {
    await claude.completeWithTools(
      { apiKey: 'k', model: 'claude-x' },
      {
        systemPrompt: 's',
        userPrompt: 'u',
        tools: [
          { name: 'tool_a', description: 'A', params: {} },
          { name: 'tool_b', description: 'B', params: {} },
        ],
      },
    );
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(capturedHeaders['anthropic-beta'], 'prompt-caching-2024-07-31');
  assert.equal(capturedBody.tools[0].cache_control, undefined, 'only the LAST tool gets the breakpoint');
  assert.deepEqual(capturedBody.tools[1].cache_control, { type: 'ephemeral' });
});

test('nim/gemini/selfHosted/openai adapters: complete()/embed() throw LlmNotConfiguredError when unconfigured, no fetch attempted', async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; };
  try {
    for (const providerName of ['nim', 'gemini', 'self_hosted', 'openai']) {
      const adapter = aiProviders.getAdapter(providerName);
      // eslint-disable-next-line no-await-in-loop
      await assert.rejects(
        () => adapter.complete({}, { systemPrompt: 's', userPrompt: 'u' }),
        aiProviders.LlmNotConfiguredError,
      );
    }
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

// --- Vision content blocks (real chat-image attachment support) ---

const ONE_PIXEL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function capturedRequestBody(fn) {
  const originalFetch = global.fetch;
  let capturedBody;
  global.fetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({}) };
  };
  try {
    await fn();
  } finally {
    global.fetch = originalFetch;
  }
  return capturedBody;
}

test('claude adapter.completeWithTools: images build the real Anthropic multipart content shape (images first, text last)', async () => {
  const claude = aiProviders.getAdapter('claude');
  const body = await capturedRequestBody(() => claude.completeWithTools(
    { apiKey: 'k', model: 'claude-x' },
    {
      systemPrompt: 's',
      userPrompt: 'what is in this image?',
      tools: [{ name: 'tool_a', description: 'A', params: {} }],
      images: [{ mimeType: 'image/png', base64: ONE_PIXEL_PNG_BASE64 }],
    },
  ).catch(() => {})); // response has no content[] block — the request shape is what's under test

  const content = body.messages[0].content;
  assert.ok(Array.isArray(content));
  assert.deepEqual(content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: ONE_PIXEL_PNG_BASE64 } });
  assert.deepEqual(content[1], { type: 'text', text: 'what is in this image?' });
});

test('claude adapter.complete: with no images, content stays a plain string (unchanged shape)', async () => {
  const claude = aiProviders.getAdapter('claude');
  const body = await capturedRequestBody(() => claude.completeWithMeta(
    { apiKey: 'k', model: 'claude-x' },
    { systemPrompt: 's', userPrompt: 'u' },
  ).catch(() => {}));
  assert.equal(body.messages[0].content, 'u');
});

test('gemini adapter.completeWithTools: images build the real Gemini inline_data parts shape (images first, text last)', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const body = await capturedRequestBody(() => gemini.completeWithTools(
    { projectId: 'p', accessToken: 't', model: 'gemini-x' },
    {
      systemPrompt: 's',
      userPrompt: 'what is in this image?',
      tools: [{ name: 'tool_a', description: 'A', params: {} }],
      images: [{ mimeType: 'image/png', base64: ONE_PIXEL_PNG_BASE64 }],
    },
  ).catch(() => {}));

  const parts = body.contents[0].parts;
  assert.deepEqual(parts[0], { inline_data: { mime_type: 'image/png', data: ONE_PIXEL_PNG_BASE64 } });
  assert.deepEqual(parts[1], { text: 'what is in this image?' });
});

test('gemini adapter.complete: with no images, parts stays text-only (unchanged shape)', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const body = await capturedRequestBody(() => gemini.completeWithMeta(
    { projectId: 'p', accessToken: 't', model: 'gemini-x' },
    { systemPrompt: 's', userPrompt: 'u' },
  ).catch(() => {}));
  assert.deepEqual(body.contents[0].parts, [{ text: 'u' }]);
});

test('openai adapter.completeWithTools: images build the real OpenAI image_url content shape (text first, images after)', async () => {
  const openai = aiProviders.getAdapter('openai');
  const body = await capturedRequestBody(() => openai.completeWithTools(
    { apiKey: 'k', model: 'gpt-x' },
    {
      systemPrompt: 's',
      userPrompt: 'what is in this image?',
      tools: [{ name: 'tool_a', description: 'A', params: {} }],
      images: [{ mimeType: 'image/png', base64: ONE_PIXEL_PNG_BASE64 }],
    },
  ).catch(() => {}));

  const content = body.messages[1].content;
  assert.deepEqual(content[0], { type: 'text', text: 'what is in this image?' });
  assert.deepEqual(content[1], { type: 'image_url', image_url: { url: `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}` } });
});

test('gemini adapter.completeWithTools: additionalProperties is stripped (recursively) from every tool schema — real Gemini API rejects it (\'Unknown name "additionalProperties"\'), caught live against the actual endpoint', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const body = await capturedRequestBody(() => gemini.completeWithTools(
    { projectId: 'p', accessToken: 't', model: 'gemini-x' },
    {
      systemPrompt: 's',
      userPrompt: 'u',
      tools: [{
        name: 'tool_a',
        description: 'A',
        params: {
          type: 'object',
          properties: {
            nested: { type: 'object', properties: { x: { type: 'string' } }, additionalProperties: false },
          },
          additionalProperties: false,
        },
      }],
    },
  ).catch(() => {}));

  const parameters = body.tools[0].functionDeclarations[0].parameters;
  assert.equal('additionalProperties' in parameters, false, 'top-level additionalProperties must be stripped');
  assert.equal('additionalProperties' in parameters.properties.nested, false, 'nested additionalProperties must be stripped too');
  // Everything else in the schema survives unchanged.
  assert.equal(parameters.type, 'object');
  assert.equal(parameters.properties.nested.properties.x.type, 'string');
});

test('openai adapter.complete: with no images, content stays a plain string (unchanged shape)', async () => {
  const openai = aiProviders.getAdapter('openai');
  const body = await capturedRequestBody(() => openai.completeWithMeta(
    { apiKey: 'k', model: 'gpt-x' },
    { systemPrompt: 's', userPrompt: 'u' },
  ).catch(() => {}));
  assert.equal(body.messages[1].content, 'u');
});
