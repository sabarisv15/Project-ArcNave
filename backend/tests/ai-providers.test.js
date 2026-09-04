'use strict';

// Unit tests for the aiProviders adapter registry — no live network
// calls to any real vendor (each OpenAI-compatible adapter's own
// request-shape behavior is already proven against mocked fetch in
// ai-service.test.js; this file proves the shared interface contract
// every adapter must satisfy, and getAdapter's own resolution/error
// behavior).

const test = require('node:test');
const assert = require('node:assert/strict');
const aiProviders = require('../src/services/aiProviders');
const { contextFromFlatPrompts } = require('../src/services/aiContextAssembly');
const vertexCapabilityRegistry = require('../src/services/vertexCapabilityRegistry');

const REQUIRED_METHODS = ['isConfigured', 'complete', 'completeWithTools', 'embed', 'generateImage'];

test('aiProviders: every registered adapter implements the full common interface', () => {
  for (const providerName of aiProviders.KNOWN_PROVIDERS) {
    const adapter = aiProviders.getAdapter(providerName);
    for (const method of REQUIRED_METHODS) {
      assert.equal(typeof adapter[method], 'function', `${providerName}.${method} must be a function`);
    }
  }
});

test('aiProviders.getAdapter: known providers resolve to their own module', () => {
  assert.equal(aiProviders.getAdapter('gemini').name, 'gemini');
  assert.equal(aiProviders.getAdapter('claude').name, 'claude');
  assert.equal(aiProviders.getAdapter('self_hosted').name, 'self_hosted');
  assert.equal(aiProviders.getAdapter('openai').name, 'openai');
});

test('aiProviders: supportsVision is explicit per adapter, never inferred from name', () => {
  assert.equal(aiProviders.getAdapter('claude').supportsVision, true);
  assert.equal(aiProviders.getAdapter('gemini').supportsVision, true);
  assert.equal(aiProviders.getAdapter('openai').supportsVision, true);
  assert.equal(aiProviders.getAdapter('self_hosted').supportsVision, false);
});

test('aiProviders.getAdapter: an unknown provider name throws AiProviderUnknownError', () => {
  assert.throws(() => aiProviders.getAdapter('some_vendor_nobody_built'), aiProviders.AiProviderUnknownError);
});

test('Phase 8: gemini/vertex_maas adapters expose getCapabilityProfile/supportsCapability, routed through the shared registry', () => {
  vertexCapabilityRegistry._resetCacheForTests();
  const gemini = aiProviders.getAdapter('gemini');
  assert.equal(typeof gemini.getCapabilityProfile, 'function');
  assert.equal(typeof gemini.supportsCapability, 'function');
  const profile = gemini.getCapabilityProfile({ projectId: 'p', location: 'global', model: 'gemini-3.8-flash' });
  assert.equal(profile.modelId, 'gemini-3.8-flash');
  assert.equal(
    gemini.supportsCapability({ projectId: 'p', location: 'global', model: 'gemini-3.8-flash' }, 'multimodal_audio'),
    true,
  );
  assert.equal(
    gemini.supportsCapability({ projectId: 'p', location: 'global', model: 'gemini-3.8-flash' }, 'batch_prediction'),
    false,
  );

  const vertexMaas = aiProviders.getAdapter('vertex_maas');
  assert.equal(typeof vertexMaas.getCapabilityProfile, 'function');
  assert.equal(typeof vertexMaas.supportsCapability, 'function');
  // No curated entry exists for any MaaS model — must fall back to
  // "nothing asserted", consistent with this adapter's own static
  // supportsVision=false/supportsAudioVideo=false, never contradicting it.
  assert.equal(
    vertexMaas.supportsCapability(
      { projectId: 'p', location: 'global', model: 'qwen/qwen3-next-80b-a3b-thinking-maas' },
      'multimodal_image',
    ),
    false,
  );
});

test('Phase 8: non-Vertex adapters (claude/openai/self_hosted) do not claim to export a capability registry function', () => {
  for (const providerName of ['claude', 'openai', 'self_hosted']) {
    const adapter = aiProviders.getAdapter(providerName);
    assert.equal(adapter.getCapabilityProfile, undefined, `${providerName} must not fake a Vertex capability profile`);
  }
});

test('gemini/selfHosted/openai adapters: isConfigured is false with an empty config', () => {
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

// Image generation (RS-AIG-025) — claude/self_hosted have no real
// vendor image API, same honest-limitation shape claude's own embed()
// already established above; openai/gemini have real ones.
test('claude/self_hosted adapters: generateImage() throws AiProviderCapabilityError, no fetch attempted', async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
  };
  try {
    await assert.rejects(
      () => aiProviders.getAdapter('claude').generateImage({ apiKey: 'k' }, { prompt: 'a red bicycle' }),
      aiProviders.AiProviderCapabilityError,
    );
    await assert.rejects(
      () =>
        aiProviders
          .getAdapter('self_hosted')
          .generateImage({ baseUrl: 'https://example.com' }, { prompt: 'a red bicycle' }),
      aiProviders.AiProviderCapabilityError,
    );
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(fetchCalled, false);
});

test('openai adapter.generateImage: posts to /images/generations and decodes data[0].b64_json into a PNG buffer', async () => {
  const openai = aiProviders.getAdapter('openai');
  const originalFetch = global.fetch;
  let capturedBody;
  let capturedPath;
  global.fetch = async (url, options) => {
    capturedPath = url;
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from('fake-png').toString('base64') }] }),
    };
  };
  try {
    const result = await openai.generateImage({ apiKey: 'k' }, { prompt: 'a red bicycle' });
    assert.ok(capturedPath.includes('/images/generations'));
    assert.equal(capturedBody.prompt, 'a red bicycle');
    assert.equal(result.mimeType, 'image/png');
    assert.equal(result.imageBuffer.toString(), 'fake-png');
  } finally {
    global.fetch = originalFetch;
  }
});

test('openai adapter.generateImage: unconfigured -> LlmNotConfiguredError, no fetch attempted', async () => {
  const openai = aiProviders.getAdapter('openai');
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
  };
  try {
    await assert.rejects(
      () => openai.generateImage({}, { prompt: 'a red bicycle' }),
      /LlmNotConfiguredError|no LLM provider is configured/,
    );
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(fetchCalled, false);
});

test('gemini adapter.generateImage: posts to the Imagen :predict endpoint and decodes predictions[0].bytesBase64Encoded', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const originalFetch = global.fetch;
  let capturedPath;
  let capturedBody;
  global.fetch = async (url, options) => {
    capturedPath = url;
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        predictions: [{ bytesBase64Encoded: Buffer.from('fake-png').toString('base64'), mimeType: 'image/png' }],
      }),
    };
  };
  try {
    const result = await gemini.generateImage({ projectId: 'p', accessToken: 't' }, { prompt: 'a red bicycle' });
    assert.ok(capturedPath.includes(':predict'));
    assert.equal(capturedBody.instances[0].prompt, 'a red bicycle');
    assert.equal(result.mimeType, 'image/png');
    assert.equal(result.imageBuffer.toString(), 'fake-png');
  } finally {
    global.fetch = originalFetch;
  }
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
      contextFromFlatPrompts({
        systemPrompt: 's',
        userPrompt: 'u',
        tools: [
          { name: 'tool_a', description: 'A', params: {} },
          { name: 'tool_b', description: 'B', params: {} },
        ],
      }),
    );
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(capturedHeaders['anthropic-beta'], 'prompt-caching-2024-07-31');
  assert.equal(capturedBody.tools[0].cache_control, undefined, 'only the LAST tool gets the breakpoint');
  assert.deepEqual(capturedBody.tools[1].cache_control, { type: 'ephemeral' });
});

// ARCNAVE modernization P2 (PDF 1.4 / clash C2) — explicit Vertex prompt caching.
test('gemini adapter.completeWithTools: a cachedSystemInstructionName references the cache and drops the inline systemInstruction', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const originalFetch = global.fetch;
  let body;
  global.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) };
  };
  try {
    await gemini.completeWithTools(
      { projectId: 'p', accessToken: 't', model: 'gemini-3.8-flash', location: 'global' },
      contextFromFlatPrompts({
        systemPrompt: 'the big stable policy + catalogue prefix',
        userPrompt: 'Question: attendance?',
        tools: [{ name: 'attendance_summary', description: 'A', params: {} }],
        cachedSystemInstructionName: 'projects/x/locations/global/cachedContents/42',
      }),
    );
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(body.cachedContent, 'projects/x/locations/global/cachedContents/42');
  assert.equal(body.systemInstruction, undefined, 'system text is not re-sent when the cache is referenced');
  assert.ok(body.tools, 'tools are still sent inline (they can grow within a turn)');
});

test('gemini adapter.completeWithTools: a stale cachedContent (HTTP 404) is retried once inline, turn does not fail', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const originalFetch = global.fetch;
  const bodies = [];
  let n = 0;
  global.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    n += 1;
    if (n === 1) return { ok: false, status: 404, text: async () => 'CachedContent not found' };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'recovered' }] } }] }) };
  };
  try {
    const res = await gemini.completeWithTools(
      { projectId: 'p', accessToken: 't', model: 'gemini-3.8-flash', location: 'global' },
      contextFromFlatPrompts({
        systemPrompt: 'the big stable policy + catalogue prefix',
        userPrompt: 'Question: attendance?',
        tools: [{ name: 'attendance_summary', description: 'A', params: {} }],
        cachedSystemInstructionName: 'projects/x/locations/global/cachedContents/stale',
      }),
    );
    assert.equal(res.text, 'recovered');
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(bodies.length, 2, 'one cached attempt, one inline retry');
  assert.equal(bodies[0].cachedContent, 'projects/x/locations/global/cachedContents/stale');
  assert.equal(bodies[1].cachedContent, undefined);
  assert.equal(bodies[1].systemInstruction.parts[0].text, 'the big stable policy + catalogue prefix');
});

// Claude-on-Vertex (added 2026-08-22) — the request-shape contract
// live-verified against a real project (project-8bcf740a-a7bd-4aea-974,
// claude-sonnet-5: a 429 RESOURCE_EXHAUSTED naming the real base model
// confirms correct routing; this project's Vertex quota for Claude is 0
// pending a Google-reviewed increase, not a shape/auth problem).

test('claude adapter: isConfigured is true with projectId alone, no apiKey needed (Vertex mode)', () => {
  const claude = aiProviders.getAdapter('claude');
  assert.equal(claude.isConfigured({ projectId: 'p' }), true);
  assert.equal(claude.isConfigured({ apiKey: 'k' }), true);
  assert.equal(claude.isConfigured({}), false);
});

test('claude adapter (Vertex mode): posts to the real aiplatform.googleapis.com publisher-model URL, Bearer-authed, model in the URL not the body', async () => {
  const claude = aiProviders.getAdapter('claude');
  const originalFetch = global.fetch;
  let capturedUrl;
  let capturedHeaders;
  let capturedBody;
  global.fetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
  };
  try {
    await claude.completeWithMeta(
      { projectId: 'project-8bcf740a-a7bd-4aea-974', accessToken: 't', model: 'claude-sonnet-5' },
      contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' }),
    );
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(
    capturedUrl,
    'https://aiplatform.googleapis.com/v1/projects/project-8bcf740a-a7bd-4aea-974/locations/global/publishers/anthropic/models/claude-sonnet-5:rawPredict',
  );
  assert.equal(capturedHeaders.authorization, 'Bearer t');
  assert.equal(capturedHeaders['x-api-key'], undefined, 'Vertex mode must never send the direct-API key header');
  assert.equal(capturedBody.model, undefined, 'model is in the URL on Vertex, never the body');
  assert.equal(capturedBody.anthropic_version, 'vertex-2023-10-16');
});

test('claude adapter (Vertex mode): streaming uses :streamRawPredict and never sends a body-level stream flag', async () => {
  const claude = aiProviders.getAdapter('claude');
  const originalFetch = global.fetch;
  let capturedUrl;
  let capturedBody;
  // eslint-disable-next-line require-yield -- an intentionally empty SSE
  // body: iterateSseLines only needs response.body to be async-iterable
  // (a real `for await` target, per sse.js's own comment), not a
  // Streams-API reader.
  async function* emptyBody() {}
  global.fetch = async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return { ok: true, body: emptyBody() };
  };
  try {
    await claude.completeStream(
      { projectId: 'p', accessToken: 't', model: 'claude-sonnet-5' },
      contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' }),
      () => {},
    );
  } finally {
    global.fetch = originalFetch;
  }

  assert.match(capturedUrl, /:streamRawPredict$/);
  assert.equal(capturedBody.stream, undefined, 'Vertex has no body-level stream flag — the URL verb selects it');
});

test("claude adapter: projectId wins over apiKey when both are present (Vertex is configurationService's only mechanism for this provider today)", async () => {
  const claude = aiProviders.getAdapter('claude');
  const originalFetch = global.fetch;
  let capturedHeaders;
  global.fetch = async (url, options) => {
    capturedHeaders = options.headers;
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
  };
  try {
    await claude.completeWithMeta(
      { projectId: 'p', accessToken: 't', apiKey: 'should-be-ignored', model: 'claude-sonnet-5' },
      contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' }),
    );
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(capturedHeaders.authorization, 'Bearer t');
  assert.equal(capturedHeaders['x-api-key'], undefined);
});

test('gemini/selfHosted/openai adapters: complete()/embed() throw LlmNotConfiguredError when unconfigured, no fetch attempted', async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    return { ok: true, json: async () => ({}) };
  };
  try {
    for (const providerName of ['gemini', 'self_hosted', 'openai']) {
      const adapter = aiProviders.getAdapter(providerName);
      // eslint-disable-next-line no-await-in-loop
      await assert.rejects(
        () => adapter.complete({}, contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' })),
        aiProviders.LlmNotConfiguredError,
      );
    }
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

// --- Vision content blocks (real chat-image attachment support) ---

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

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
  const body = await capturedRequestBody(() =>
    claude
      .completeWithTools(
        { apiKey: 'k', model: 'claude-x' },
        contextFromFlatPrompts({
          systemPrompt: 's',
          userPrompt: 'what is in this image?',
          tools: [{ name: 'tool_a', description: 'A', params: {} }],
          images: [{ mimeType: 'image/png', base64: ONE_PIXEL_PNG_BASE64 }],
        }),
      )
      .catch(() => {}),
  ); // response has no content[] block — the request shape is what's under test

  const content = body.messages[0].content;
  assert.ok(Array.isArray(content));
  assert.deepEqual(content[0], {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: ONE_PIXEL_PNG_BASE64 },
  });
  assert.deepEqual(content[1], { type: 'text', text: 'what is in this image?' });
});

test('claude adapter.complete: with no images, content stays a plain string (unchanged shape)', async () => {
  const claude = aiProviders.getAdapter('claude');
  const body = await capturedRequestBody(() =>
    claude
      .completeWithMeta(
        { apiKey: 'k', model: 'claude-x' },
        contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' }),
      )
      .catch(() => {}),
  );
  assert.equal(body.messages[0].content, 'u');
});

test('gemini adapter.completeWithTools: images build the real Gemini inline_data parts shape (images first, text last)', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const body = await capturedRequestBody(() =>
    gemini
      .completeWithTools(
        { projectId: 'p', accessToken: 't', model: 'gemini-x' },
        contextFromFlatPrompts({
          systemPrompt: 's',
          userPrompt: 'what is in this image?',
          tools: [{ name: 'tool_a', description: 'A', params: {} }],
          images: [{ mimeType: 'image/png', base64: ONE_PIXEL_PNG_BASE64 }],
        }),
      )
      .catch(() => {}),
  );

  const parts = body.contents[0].parts;
  assert.deepEqual(parts[0], { inline_data: { mime_type: 'image/png', data: ONE_PIXEL_PNG_BASE64 } });
  assert.deepEqual(parts[1], { text: 'what is in this image?' });
});

test('gemini adapter.complete: with no images, parts stays text-only (unchanged shape)', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const body = await capturedRequestBody(() =>
    gemini
      .completeWithMeta(
        { projectId: 'p', accessToken: 't', model: 'gemini-x' },
        contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' }),
      )
      .catch(() => {}),
  );
  assert.deepEqual(body.contents[0].parts, [{ text: 'u' }]);
});

// Regression test for the P0 finding from the AI red-team evaluation
// session (2026-08-21): a hanging Gemini request previously got a fresh
// REQUEST_TIMEOUT_MS (30s) on every one of withRetry's own MAX_ATTEMPTS
// (3), compounding to ~90s+ for a single postJson-based call
// (completeWithMeta/completeWithTools/embed all share it) — long enough
// to collide with the per-request DB transaction's own
// idle_in_transaction_session_timeout (90s, db-role-timeouts.test.js)
// and, before a separate fix to tenantTransaction.js, crash the whole
// backend process. MAX_TOTAL_LATENCY_MS now bounds the WHOLE operation
// (every retry combined), not just each individual attempt — proven
// here with a genuinely hanging mock fetch (rejects only when the
// AbortSignal actually fires, never on its own), so a real early abort
// is what's being measured, not just a fast-failing mock that would
// pass even without the fix.
test('gemini adapter.completeWithMeta: a hanging request is aborted well within the overall time budget, never the old ~90s worst case', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const originalFetch = global.fetch;
  global.fetch = (url, options) =>
    new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  const startedAt = Date.now();
  try {
    await assert.rejects(
      () =>
        gemini.completeWithMeta(
          { projectId: 'p', accessToken: 't', maxTotalLatencyMs: 150 },
          contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' }),
        ),
      aiProviders.LlmRequestError,
    );
  } finally {
    global.fetch = originalFetch;
  }
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 5000, `expected the call to give up within a few seconds of the 150ms budget, took ${elapsed}ms`);
});

test('openai adapter.completeWithTools: images build the real OpenAI image_url content shape (text first, images after)', async () => {
  const openai = aiProviders.getAdapter('openai');
  const body = await capturedRequestBody(() =>
    openai
      .completeWithTools(
        { apiKey: 'k', model: 'gpt-x' },
        contextFromFlatPrompts({
          systemPrompt: 's',
          userPrompt: 'what is in this image?',
          tools: [{ name: 'tool_a', description: 'A', params: {} }],
          images: [{ mimeType: 'image/png', base64: ONE_PIXEL_PNG_BASE64 }],
        }),
      )
      .catch(() => {}),
  );

  const content = body.messages[1].content;
  assert.deepEqual(content[0], { type: 'text', text: 'what is in this image?' });
  assert.deepEqual(content[1], {
    type: 'image_url',
    image_url: { url: `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}` },
  });
});

// ADR-030 P3 follow-up (config.experimentalZeroToolFastPath) — Gemini's
// real API rejects `tools: [{ functionDeclarations: [] }]` (a non-empty
// outer array wrapping zero declarations is invalid; only OMITTING
// `tools` entirely is), so a genuinely empty tools array must drop the
// field, not send it empty. Regression guard for that exact bug: without
// the `tools.length > 0` gate in gemini.js, this request body would carry
// `tools: [{ functionDeclarations: [] }]` and fail against the real API.
test('gemini adapter.completeWithTools: an empty tools array omits the `tools` field entirely, never `tools: [{ functionDeclarations: [] }]`', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const body = await capturedRequestBody(() =>
    gemini
      .completeWithTools(
        { projectId: 'p', accessToken: 't', model: 'gemini-x' },
        contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u', tools: [] }),
      )
      .catch(() => {}),
  );

  assert.equal(Object.prototype.hasOwnProperty.call(body, 'tools'), false);
});

test('gemini adapter.completeWithTools: additionalProperties is stripped (recursively) from every tool schema — real Gemini API rejects it (\'Unknown name "additionalProperties"\'), caught live against the actual endpoint', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const body = await capturedRequestBody(() =>
    gemini
      .completeWithTools(
        { projectId: 'p', accessToken: 't', model: 'gemini-x' },
        contextFromFlatPrompts({
          systemPrompt: 's',
          userPrompt: 'u',
          tools: [
            {
              name: 'tool_a',
              description: 'A',
              params: {
                type: 'object',
                properties: {
                  nested: { type: 'object', properties: { x: { type: 'string' } }, additionalProperties: false },
                },
                additionalProperties: false,
              },
            },
          ],
        }),
      )
      .catch(() => {}),
  );

  const parameters = body.tools[0].functionDeclarations[0].parameters;
  assert.equal('additionalProperties' in parameters, false, 'top-level additionalProperties must be stripped');
  assert.equal(
    'additionalProperties' in parameters.properties.nested,
    false,
    'nested additionalProperties must be stripped too',
  );
  // Everything else in the schema survives unchanged.
  assert.equal(parameters.type, 'object');
  assert.equal(parameters.properties.nested.properties.x.type, 'string');
});

test('openai adapter.complete: with no images, content stays a plain string (unchanged shape)', async () => {
  const openai = aiProviders.getAdapter('openai');
  const body = await capturedRequestBody(() =>
    openai
      .completeWithMeta({ apiKey: 'k', model: 'gpt-x' }, contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' }))
      .catch(() => {}),
  );
  assert.equal(body.messages[1].content, 'u');
});

// CEO Vertex/Gemini audit #12/C3 (2026-08-30) — structured-output
// enforcement. gemini.js/openai.js map an attached responseSchema to
// their own native mechanism; a call with none must produce the exact
// same request shape as before (no generationConfig/response_format
// regression for every existing caller that never sets it).
test('gemini adapter.completeWithMeta: no responseSchema means no responseMimeType/responseSchema on the wire (unchanged shape)', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const body = await capturedRequestBody(() =>
    gemini
      .completeWithMeta(
        { projectId: 'p', accessToken: 't', model: 'gemini-x' },
        contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' }),
      )
      .catch(() => {}),
  );
  assert.equal('responseMimeType' in body.generationConfig, false);
  assert.equal('responseSchema' in body.generationConfig, false);
});

test('gemini adapter.completeWithMeta: an attached responseSchema sets responseMimeType/responseSchema without disturbing maxOutputTokens/thinkingConfig', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const schema = { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] };
  const body = await capturedRequestBody(() =>
    gemini
      .completeWithMeta(
        { projectId: 'p', accessToken: 't', model: 'gemini-x' },
        contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u', responseSchema: schema }),
      )
      .catch(() => {}),
  );
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(body.generationConfig.responseSchema, schema);
  assert.equal(body.generationConfig.maxOutputTokens, 65_536);
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'LOW');
});

test('openai adapter.completeWithMeta: no responseSchema means no response_format on the wire (unchanged shape)', async () => {
  const openai = aiProviders.getAdapter('openai');
  const body = await capturedRequestBody(() =>
    openai
      .completeWithMeta({ apiKey: 'k', model: 'gpt-x' }, contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' }))
      .catch(() => {}),
  );
  assert.equal('response_format' in body, false);
});

test('openai adapter.completeWithMeta: an attached responseSchema maps to response_format: json_schema, strict', async () => {
  const openai = aiProviders.getAdapter('openai');
  const schema = { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] };
  const body = await capturedRequestBody(() =>
    openai
      .completeWithMeta(
        { apiKey: 'k', model: 'gpt-x' },
        contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u', responseSchema: schema }),
      )
      .catch(() => {}),
  );
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.response_format.json_schema.schema, schema);
});

// P3 1.12 — "forced-format replies only half-supported ... only two
// providers enforce it natively." Every adapter now honors an attached
// responseSchema natively; these replace the old
// "claude/self_hosted ignore it harmlessly" test, which asserted the
// exact gap this item closes.
test('selfHosted/vertexMaas adapters (OpenAI-compatible): no responseSchema means no response_format on the wire (unchanged shape)', async () => {
  const selfHostedBody = await capturedRequestBody(() =>
    aiProviders
      .getAdapter('self_hosted')
      .completeWithMeta(
        { baseUrl: 'http://x', model: 'm' },
        contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' }),
      )
      .catch(() => {}),
  );
  assert.equal('response_format' in selfHostedBody, false);
});

test('selfHosted adapter.completeWithMeta: an attached responseSchema maps to response_format: json_schema, strict (same OpenAI-compatible shape as openai.js)', async () => {
  const schema = { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] };
  const body = await capturedRequestBody(() =>
    aiProviders
      .getAdapter('self_hosted')
      .completeWithMeta(
        { baseUrl: 'http://x', model: 'm' },
        contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u', responseSchema: schema }),
      )
      .catch(() => {}),
  );
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.response_format.json_schema.schema, schema);
  assert.equal(body.messages[1].content, 'u');
});

test('vertexMaas adapter.completeWithMeta: an attached responseSchema maps to response_format: json_schema, strict', async () => {
  const schema = { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] };
  const body = await capturedRequestBody(() =>
    aiProviders
      .getAdapter('vertex_maas')
      .completeWithMeta(
        { projectId: 'p', accessToken: 't', model: 'qwen/qwen3-next-80b-a3b-thinking-maas' },
        contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u', responseSchema: schema }),
      )
      .catch(() => {}),
  );
  assert.equal(body.response_format.type, 'json_schema');
  assert.deepEqual(body.response_format.json_schema.schema, schema);
});

test('claude adapter.completeWithMeta: no responseSchema means no tools/tool_choice on the wire (unchanged shape)', async () => {
  const body = await capturedRequestBody(() =>
    aiProviders
      .getAdapter('claude')
      .completeWithMeta(
        { apiKey: 'k', model: 'claude-x' },
        contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' }),
      )
      .catch(() => {}),
  );
  assert.equal('tools' in body, false);
  assert.equal('tool_choice' in body, false);
  assert.equal(body.messages[0].content, 'u');
});

test('claude adapter.completeWithMeta: an attached responseSchema forces a single structured_output tool call (no native response_format field on Anthropic’s API)', async () => {
  const schema = { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] };
  const body = await capturedRequestBody(() =>
    aiProviders
      .getAdapter('claude')
      .completeWithMeta(
        { apiKey: 'k', model: 'claude-x' },
        contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u', responseSchema: schema }),
      )
      .catch(() => {}),
  );
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].name, 'structured_output');
  assert.deepEqual(body.tools[0].input_schema, schema);
  assert.deepEqual(body.tool_choice, { type: 'tool', name: 'structured_output' });
  assert.equal(body.messages[0].content, 'u');
});

test('claude adapter.completeWithMeta: a forced tool_use response is re-serialized to a JSON string (same string contract as gemini/openai)', async () => {
  const claude = aiProviders.getAdapter('claude');
  const schema = { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] };
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      content: [{ type: 'tool_use', name: 'structured_output', input: { x: 'value' } }],
      usage: { input_tokens: 5, output_tokens: 3 },
    }),
  });
  try {
    const { text, usage } = await claude.completeWithMeta(
      { apiKey: 'k', model: 'claude-x' },
      contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u', responseSchema: schema }),
    );
    assert.equal(text, JSON.stringify({ x: 'value' }));
    // ADL-100 — extractUsage now always includes cachedTokens (undefined
    // here since this mocked response carries no cache_read_input_tokens,
    // same as a real uncached Anthropic call).
    assert.deepEqual(usage, { inputTokens: 5, outputTokens: 3, cachedTokens: undefined });
  } finally {
    global.fetch = originalFetch;
  }
});

test('claude adapter.completeWithMeta: a missing forced tool_use block throws rather than silently returning nothing', async () => {
  const claude = aiProviders.getAdapter('claude');
  const schema = { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] };
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ content: [] }) });
  try {
    await assert.rejects(
      () =>
        claude.completeWithMeta(
          { apiKey: 'k', model: 'claude-x' },
          contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u', responseSchema: schema }),
        ),
      /structured_output/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

// Mocks fetch and returns BOTH the request body sent and the real
// resolved value the caller's function returned — capturedRequestBody/
// capturedRequestBodyWithResponse above only ever return the request
// body, which is enough for shape-of-the-outgoing-request tests but not
// for asserting what completeWithMeta/completeWithTools's own RETURN
// value contains (thoughtSummary, logprobsResult, totalTokens, ...).
async function capturedRequestAndResult(fn, responsePayload) {
  const originalFetch = global.fetch;
  let capturedBody;
  global.fetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => responsePayload };
  };
  let result;
  try {
    result = await fn();
  } finally {
    global.fetch = originalFetch;
  }
  return { body: capturedBody, result };
}

// CEO Vertex/Gemini audit #26 (2026-08-30) — Thinking Levels.
test('gemini adapter.completeWithMeta: thinkingLevel overrides GENERATION_CONFIG.thinkingConfig.thinkingLevel on the wire', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const { body } = await capturedRequestAndResult(
    () =>
      gemini
        .completeWithMeta(
          { projectId: 'p', accessToken: 't', model: 'gemini-x' },
          contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u', thinkingLevel: 'HIGH' }),
        )
        .catch(() => {}),
    {},
  );
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'HIGH');
});

test('gemini adapter.completeWithTools: thinkingLevel reaches the decision call too, not just plain complete()', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const { body } = await capturedRequestAndResult(
    () =>
      gemini
        .completeWithTools(
          { projectId: 'p', accessToken: 't', model: 'gemini-x' },
          contextFromFlatPrompts({
            systemPrompt: 's',
            userPrompt: 'u',
            tools: [{ name: 'tool_a', description: 'A', params: {} }],
            thinkingLevel: 'MEDIUM',
          }),
        )
        .catch(() => {}),
    {},
  );
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'MEDIUM');
});

// CEO Vertex/Gemini audit #27 (2026-08-30) — Thinking Trace Visibility.
// The real regression this ADL caught: a thought part carries its own
// `.text` exactly like a real answer part, distinguished only by
// `part.thought === true` — a naive join would splice it into the
// visible answer.
test('gemini adapter.completeWithMeta: a thought part is split out of the visible text and returned separately as thoughtSummary', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const { body, result } = await capturedRequestAndResult(
    () =>
      gemini.completeWithMeta(
        { projectId: 'p', accessToken: 't', model: 'gemini-x' },
        contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u', includeThoughts: true }),
      ),
    {
      candidates: [
        {
          content: {
            parts: [{ text: 'reasoning about the question...', thought: true }, { text: 'the real answer' }],
          },
        },
      ],
    },
  );
  assert.equal(body.generationConfig.thinkingConfig.includeThoughts, true);
  assert.equal(result.text, 'the real answer');
  assert.equal(result.thoughtSummary, 'reasoning about the question...');
});

test('gemini adapter.completeWithMeta: no thought parts in the response means thoughtSummary is undefined, never an empty string', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const { result } = await capturedRequestAndResult(
    () =>
      gemini.completeWithMeta(
        { projectId: 'p', accessToken: 't', model: 'gemini-x' },
        contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' }),
      ),
    {
      candidates: [{ content: { parts: [{ text: 'the real answer' }] } }],
    },
  );
  assert.equal(result.text, 'the real answer');
  assert.equal(result.thoughtSummary, undefined);
});

test('gemini adapter.completeWithTools: a thought part alongside a function call is split out and never becomes part of toolName/arguments', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const { result } = await capturedRequestAndResult(
    () =>
      gemini.completeWithTools(
        { projectId: 'p', accessToken: 't', model: 'gemini-x' },
        contextFromFlatPrompts({
          systemPrompt: 's',
          userPrompt: 'u',
          tools: [{ name: 'tool_a', description: 'A', params: {} }],
          includeThoughts: true,
        }),
      ),
    {
      candidates: [
        {
          content: {
            parts: [{ text: 'thinking...', thought: true }, { functionCall: { name: 'tool_a', args: { x: 1 } } }],
          },
        },
      ],
    },
  );
  assert.equal(result.type, 'tool_call');
  assert.equal(result.toolName, 'tool_a');
  assert.equal(result.thoughtSummary, 'thinking...');
});

// CEO Vertex/Gemini audit #39 (2026-08-30) — Logprobs, internal
// diagnostics only.
test('gemini adapter.completeWithMeta: logprobsTopK sets responseLogprobs/logprobs on the wire and surfaces logprobsResult on the return value', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const { body, result } = await capturedRequestAndResult(
    () =>
      gemini.completeWithMeta(
        { projectId: 'p', accessToken: 't', model: 'gemini-x' },
        contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u', logprobsTopK: 3 }),
      ),
    {
      candidates: [{ content: { parts: [{ text: 'answer' }] }, logprobsResult: { chosenCandidates: [] } }],
    },
  );
  assert.equal(body.generationConfig.responseLogprobs, true);
  assert.equal(body.generationConfig.logprobs, 3);
  assert.deepEqual(result.logprobsResult, { chosenCandidates: [] });
});

test('gemini adapter.completeWithMeta: no logprobsTopK means no responseLogprobs/logprobs on the wire and no logprobsResult on the return value', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const { body, result } = await capturedRequestAndResult(
    () =>
      gemini.completeWithMeta(
        { projectId: 'p', accessToken: 't', model: 'gemini-x' },
        contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' }),
      ),
    {
      candidates: [{ content: { parts: [{ text: 'answer' }] }, logprobsResult: { chosenCandidates: [] } }],
    },
  );
  assert.equal('responseLogprobs' in body.generationConfig, false);
  assert.equal('logprobs' in body.generationConfig, false);
  assert.equal(result.logprobsResult, undefined);
});

// CEO Vertex/Gemini audit #34 (2026-08-30) — Token Counting Preflight.
test('gemini adapter.countTokens: posts to the real :countTokens endpoint and returns totalTokens', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const { body, result } = await capturedRequestAndResult(
    () =>
      gemini.countTokens(
        { projectId: 'p', accessToken: 't', model: 'gemini-x' },
        contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' }),
      ),
    { totalTokens: 12345 },
  );
  assert.equal(body.contents[0].parts[0].text, 'u');
  assert.equal(
    'generationConfig' in body,
    false,
    'countTokens must never send a generationConfig — it is not a generation call',
  );
  assert.equal(result.totalTokens, 12345);
});

test('gemini adapter.countTokens: a non-numeric totalTokens throws rather than returning a bad count', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({}) }); // no totalTokens at all
  try {
    await assert.rejects(
      () =>
        gemini.countTokens(
          { projectId: 'p', accessToken: 't', model: 'gemini-x' },
          contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' }),
        ),
      aiProviders.LlmRequestError,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('gemini adapter.countTokens: unconfigured -> LlmNotConfiguredError, no fetch attempted', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  await assert.rejects(
    () => gemini.countTokens({}, contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' })),
    aiProviders.LlmNotConfiguredError,
  );
});

// CEO Vertex/Gemini audit #37/C14 (2026-08-30) — Batch Prediction.
test('gemini adapter.submitBatchPredictionJob: posts to the real batchPredictionJobs endpoint with gcsSource/gcsDestination', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const { body, result } = await capturedRequestAndResult(
    () =>
      gemini.submitBatchPredictionJob(
        { projectId: 'p', accessToken: 't', model: 'gemini-x' },
        { displayName: 'my-job', gcsInputUri: 'gs://bucket/in.jsonl', gcsOutputUriPrefix: 'gs://bucket/out/' },
      ),
    { name: 'projects/p/locations/global/batchPredictionJobs/123', state: 'JOB_STATE_PENDING' },
  );
  assert.equal(body.inputConfig.gcsSource.uris[0], 'gs://bucket/in.jsonl');
  assert.equal(body.outputConfig.gcsDestination.outputUriPrefix, 'gs://bucket/out/');
  assert.equal(body.model, 'publishers/google/models/gemini-x');
  assert.equal(result.jobName, 'projects/p/locations/global/batchPredictionJobs/123');
  assert.equal(result.state, 'JOB_STATE_PENDING');
});

test('gemini adapter.submitBatchPredictionJob: refuses without gcsInputUri/gcsOutputUriPrefix — this codebase has no GCS routing to supply them from', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  await assert.rejects(
    () =>
      gemini.submitBatchPredictionJob(
        { projectId: 'p', accessToken: 't', model: 'gemini-x' },
        { displayName: 'my-job' },
      ),
    aiProviders.LlmRequestError,
  );
});

// Round 10 P2/P3 finding: the round-8 output-token-bound fix (each
// adapter's own MAX_TOKENS/MAX_OUTPUT_TOKENS, closing what used to be a
// fully-unbounded response on most adapters) had a real asymmetry in
// coverage — every adapter's shared request-shape tests above happen to
// exercise gemini/selfHosted/claude/openai's request bodies for OTHER
// reasons (images, tool schemas, caching), but none of them actually
// assert the token-bound field/value survives on the wire, and only
// through incidental body inspection, not a named assertion — so a
// regression (e.g. a future refactor accidentally dropping max_tokens
// from one adapter but not the others) would pass silently. One
// assertion per adapter, same capturedRequestBody helper every other
// request-shape test in this file already uses.
test('every provider adapter sends an explicit output-token bound on the wire (round 8 fix, previously only informally exercised)', async () => {
  const geminiBody = await capturedRequestBody(() =>
    aiProviders
      .getAdapter('gemini')
      .completeWithMeta(
        { projectId: 'p', accessToken: 't', model: 'gemini-x' },
        contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' }),
      )
      .catch(() => {}),
  );
  assert.equal(geminiBody.generationConfig.maxOutputTokens, 65_536);

  const selfHostedBody = await capturedRequestBody(() =>
    aiProviders
      .getAdapter('self_hosted')
      .completeWithMeta(
        { baseUrl: 'http://localhost:1', model: 'sh-x' },
        contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' }),
      )
      .catch(() => {}),
  );
  assert.equal(selfHostedBody.max_tokens, 1024);

  const openaiBody = await capturedRequestBody(() =>
    aiProviders
      .getAdapter('openai')
      .completeWithMeta({ apiKey: 'k', model: 'gpt-x' }, contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' }))
      .catch(() => {}),
  );
  assert.equal(openaiBody.max_tokens, 1024);

  const claudeBody = await capturedRequestBody(() =>
    aiProviders
      .getAdapter('claude')
      .completeWithMeta(
        { apiKey: 'k', model: 'claude-x' },
        contextFromFlatPrompts({ systemPrompt: 's', userPrompt: 'u' }),
      )
      .catch(() => {}),
  );
  assert.equal(claudeBody.max_tokens, 1024);
});

// ADR-030 P2(c) — the tool-use loop's adapter contract: completeWithTools
// gains an optional third `priorTurns` parameter. Two invariants matter:
// (1) priorTurns=[]/omitted must be byte-identical to today (regression
// lock — every test above already proves this implicitly, since none of
// them pass a third argument at all), and (2) each provider's native
// multi-turn shape is built correctly, with the tool-definition list
// chain-equal across iterations (never narrowed on a continuation call).
async function capturedRequestBodyWithResponse(fn, responsePayload) {
  const originalFetch = global.fetch;
  let capturedBody;
  global.fetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => responsePayload };
  };
  try {
    await fn();
  } finally {
    global.fetch = originalFetch;
  }
  return capturedBody;
}

const P2C_TOOLS = [{ name: 'tool_a', description: 'A', params: {} }];
const P2C_CONTEXT = contextFromFlatPrompts({
  systemPrompt: 's',
  userPrompt: 'u',
  tools: P2C_TOOLS,
});

test('gemini adapter.completeWithTools: priorTurns appends functionCall/functionResponse turns after the unchanged base turn, no callId needed', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const priorTurns = [{ toolName: 'tool_a', arguments: { x: 1 }, resultText: 'RESULT_TEXT' }];
  const body = await capturedRequestBody(() =>
    gemini
      .completeWithTools({ projectId: 'p', accessToken: 't', model: 'gemini-x' }, P2C_CONTEXT, priorTurns)
      .catch(() => {}),
  );

  assert.equal(body.contents.length, 3, 'base user turn + one model/user pair');
  assert.deepEqual(body.contents[0], { role: 'user', parts: [{ text: 'u' }] });
  assert.deepEqual(body.contents[1], { role: 'model', parts: [{ functionCall: { name: 'tool_a', args: { x: 1 } } }] });
  assert.deepEqual(body.contents[2], {
    role: 'user',
    parts: [{ functionResponse: { name: 'tool_a', response: { content: 'RESULT_TEXT' } } }],
  });
});

// Live-caught regression (first real multi-tool-call ADR-030 P2(c) run
// against Vertex AI): with thinking enabled (GENERATION_CONFIG's
// thinkingLevel), a real functionCall part carries a sibling
// `thoughtSignature` field, and Vertex's real API 400s on a continuation
// request that replays a functionCall part without it — invisible to any
// hand-built mock response that doesn't happen to include that field.
// completeWithTools must both (a) capture the ENTIRE part, not just
// {name, args}, on its own tool_call response, and (b) replay that exact
// part — never a reconstructed {functionCall:{name,args}} — on the next
// continuation call.
test('gemini adapter.completeWithTools: a tool_call response carries rawToolCall (the WHOLE part, e.g. including thoughtSignature); a continuation replays it verbatim, never reconstructed', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const realPart = { functionCall: { name: 'tool_a', args: { x: 2 } }, thoughtSignature: 'opaque-signature-abc' };

  let decision;
  await capturedRequestBodyWithResponse(
    async () => {
      decision = await gemini.completeWithTools({ projectId: 'p', accessToken: 't', model: 'gemini-x' }, P2C_CONTEXT);
    },
    {
      candidates: [{ content: { parts: [realPart] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    },
  );
  assert.deepEqual(decision.rawToolCall, realPart, 'the whole part, thoughtSignature included, not just {name, args}');

  const priorTurns = [
    {
      toolName: 'tool_a',
      arguments: { x: 2 },
      resultText: 'R',
      rawToolCall: decision.rawToolCall,
    },
  ];
  const body = await capturedRequestBody(() =>
    gemini
      .completeWithTools({ projectId: 'p', accessToken: 't', model: 'gemini-x' }, P2C_CONTEXT, priorTurns)
      .catch(() => {}),
  );
  assert.deepEqual(
    body.contents[1],
    { role: 'model', parts: [realPart] },
    'replays the exact part verbatim, thoughtSignature intact — never reconstructed',
  );
});

test('gemini adapter.completeWithTools: priorTurns=[]/omitted produces a byte-identical base turn to today (regression lock)', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const withEmpty = await capturedRequestBody(() =>
    gemini.completeWithTools({ projectId: 'p', accessToken: 't', model: 'gemini-x' }, P2C_CONTEXT, []).catch(() => {}),
  );
  const omitted = await capturedRequestBody(() =>
    gemini.completeWithTools({ projectId: 'p', accessToken: 't', model: 'gemini-x' }, P2C_CONTEXT).catch(() => {}),
  );
  assert.deepEqual(withEmpty.contents, [{ role: 'user', parts: [{ text: 'u' }] }]);
  assert.deepEqual(withEmpty, omitted);
});

// ARCNAVE modernization P2 / 1.6 — historyTurns become real 'user'/'model'
// contents turns, placed BEFORE the current user turn (never after —
// that's where priorTurns' own same-turn functionCall/functionResponse
// pairs belong).
test('gemini adapter.completeWithTools: historyTurns become real user/model contents turns, placed before the current user turn', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const contextWithHistory = contextFromFlatPrompts({
    systemPrompt: 's',
    userPrompt: 'u',
    tools: P2C_TOOLS,
    historyTurns: [
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
    ],
  });
  const body = await capturedRequestBody(() =>
    gemini
      .completeWithTools({ projectId: 'p', accessToken: 't', model: 'gemini-x' }, contextWithHistory)
      .catch(() => {}),
  );
  assert.deepEqual(body.contents, [
    { role: 'user', parts: [{ text: 'earlier question' }] },
    { role: 'model', parts: [{ text: 'earlier answer' }] },
    { role: 'user', parts: [{ text: 'u' }] },
  ]);
});

test('gemini adapter.completeWithTools: tool definitions are chain-equal across 3 iterations (0, 1, 2 prior turns) — a continuation never narrows the tool list', async () => {
  const gemini = aiProviders.getAdapter('gemini');
  const cfg = { projectId: 'p', accessToken: 't', model: 'gemini-x' };
  const turn = { toolName: 'tool_a', arguments: {}, resultText: 'R' };

  const body0 = await capturedRequestBody(() => gemini.completeWithTools(cfg, P2C_CONTEXT, []).catch(() => {}));
  const body1 = await capturedRequestBody(() => gemini.completeWithTools(cfg, P2C_CONTEXT, [turn]).catch(() => {}));
  const body2 = await capturedRequestBody(() =>
    gemini.completeWithTools(cfg, P2C_CONTEXT, [turn, turn]).catch(() => {}),
  );

  assert.deepEqual(body0.tools, body1.tools);
  assert.deepEqual(body1.tools, body2.tools);
  // Also assert the base system+user prefix never changes across iterations
  // — the actual wire-level invariant P2(c) exists to establish.
  assert.deepEqual(body0.systemInstruction, body1.systemInstruction);
  assert.deepEqual(body1.systemInstruction, body2.systemInstruction);
  assert.deepEqual(body0.contents[0], body1.contents[0]);
  assert.deepEqual(body1.contents[0], body2.contents[0]);
});

test('claude adapter.completeWithTools: priorTurns appends tool_use/tool_result messages, and a tool_use response carries callId/rawToolCall', async () => {
  const claude = aiProviders.getAdapter('claude');
  const priorTurns = [
    {
      toolName: 'tool_a',
      arguments: { x: 1 },
      callId: 'toolu_123',
      resultText: 'RESULT_TEXT',
    },
  ];
  const body = await capturedRequestBody(() =>
    claude.completeWithTools({ apiKey: 'k', model: 'claude-x' }, P2C_CONTEXT, priorTurns).catch(() => {}),
  );

  assert.equal(body.messages.length, 3);
  assert.deepEqual(body.messages[0], { role: 'user', content: 'u' });
  assert.deepEqual(body.messages[1], {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_123',
        name: 'tool_a',
        input: { x: 1 },
      },
    ],
  });
  assert.deepEqual(body.messages[2], {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'toolu_123', content: 'RESULT_TEXT' }],
  });

  const rawToolUse = {
    type: 'tool_use',
    id: 'toolu_456',
    name: 'tool_a',
    input: { x: 2 },
  };
  let decision;
  await capturedRequestBodyWithResponse(
    async () => {
      decision = await claude.completeWithTools({ apiKey: 'k', model: 'claude-x' }, P2C_CONTEXT);
    },
    { content: [rawToolUse] },
  );
  assert.equal(decision.callId, 'toolu_456');
  assert.deepEqual(decision.rawToolCall, rawToolUse);
});

test('claude adapter.completeWithTools: priorTurns=[]/omitted produces a byte-identical base turn to today (regression lock)', async () => {
  const claude = aiProviders.getAdapter('claude');
  const withEmpty = await capturedRequestBody(() =>
    claude.completeWithTools({ apiKey: 'k', model: 'claude-x' }, P2C_CONTEXT, []).catch(() => {}),
  );
  const omitted = await capturedRequestBody(() =>
    claude.completeWithTools({ apiKey: 'k', model: 'claude-x' }, P2C_CONTEXT).catch(() => {}),
  );
  assert.deepEqual(withEmpty.messages, [{ role: 'user', content: 'u' }]);
  assert.deepEqual(withEmpty, omitted);
});

// ARCNAVE modernization P2 / 1.6 — see gemini's own equivalent test for
// the shared reasoning. Claude's own text-content-block message shape.
test('claude adapter.completeWithTools: historyTurns become real user/assistant messages, placed before the current user message', async () => {
  const claude = aiProviders.getAdapter('claude');
  const contextWithHistory = contextFromFlatPrompts({
    systemPrompt: 's',
    userPrompt: 'u',
    tools: P2C_TOOLS,
    historyTurns: [
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
    ],
  });
  const body = await capturedRequestBody(() =>
    claude.completeWithTools({ apiKey: 'k', model: 'claude-x' }, contextWithHistory).catch(() => {}),
  );
  assert.deepEqual(body.messages, [
    { role: 'user', content: [{ type: 'text', text: 'earlier question' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'earlier answer' }] },
    { role: 'user', content: 'u' },
  ]);
});

test('claude adapter.completeWithTools: tool definitions are chain-equal across 3 iterations', async () => {
  const claude = aiProviders.getAdapter('claude');
  const cfg = { apiKey: 'k', model: 'claude-x' };
  const turn = { toolName: 'tool_a', arguments: {}, callId: 'c1', resultText: 'R' };

  const body0 = await capturedRequestBody(() => claude.completeWithTools(cfg, P2C_CONTEXT, []).catch(() => {}));
  const body1 = await capturedRequestBody(() => claude.completeWithTools(cfg, P2C_CONTEXT, [turn]).catch(() => {}));
  const body2 = await capturedRequestBody(() =>
    claude.completeWithTools(cfg, P2C_CONTEXT, [turn, turn]).catch(() => {}),
  );

  assert.deepEqual(body0.tools, body1.tools);
  assert.deepEqual(body1.tools, body2.tools);
  assert.deepEqual(body0.system, body1.system);
  assert.deepEqual(body1.system, body2.system);
  assert.deepEqual(body0.messages[0], body1.messages[0]);
  assert.deepEqual(body1.messages[0], body2.messages[0]);
});

test('openai adapter.completeWithTools: priorTurns appends tool_calls/role:tool messages, and a tool-call response carries callId/rawToolCall', async () => {
  const openai = aiProviders.getAdapter('openai');
  const priorTurns = [
    {
      toolName: 'tool_a',
      arguments: { x: 1 },
      callId: 'call_123',
      resultText: 'RESULT_TEXT',
    },
  ];
  const body = await capturedRequestBody(() =>
    openai.completeWithTools({ apiKey: 'k', model: 'gpt-x' }, P2C_CONTEXT, priorTurns).catch(() => {}),
  );

  assert.equal(body.messages.length, 4);
  assert.deepEqual(body.messages[2], {
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'call_123', type: 'function', function: { name: 'tool_a', arguments: '{"x":1}' } }],
  });
  assert.deepEqual(body.messages[3], { role: 'tool', tool_call_id: 'call_123', content: 'RESULT_TEXT' });

  const rawCall = {
    id: 'call_456',
    type: 'function',
    function: { name: 'tool_a', arguments: '{"x":2}' },
  };
  let decision;
  await capturedRequestBodyWithResponse(
    async () => {
      decision = await openai.completeWithTools({ apiKey: 'k', model: 'gpt-x' }, P2C_CONTEXT);
    },
    { choices: [{ message: { tool_calls: [rawCall] } }] },
  );
  assert.equal(decision.callId, 'call_456');
  assert.deepEqual(decision.rawToolCall, rawCall);
});

test('openai adapter.completeWithTools: priorTurns=[]/omitted produces a byte-identical base turn to today (regression lock)', async () => {
  const openai = aiProviders.getAdapter('openai');
  const withEmpty = await capturedRequestBody(() =>
    openai.completeWithTools({ apiKey: 'k', model: 'gpt-x' }, P2C_CONTEXT, []).catch(() => {}),
  );
  const omitted = await capturedRequestBody(() =>
    openai.completeWithTools({ apiKey: 'k', model: 'gpt-x' }, P2C_CONTEXT).catch(() => {}),
  );
  assert.deepEqual(withEmpty.messages, [
    { role: 'system', content: 's' },
    { role: 'user', content: 'u' },
  ]);
  assert.deepEqual(withEmpty, omitted);
});

// ARCNAVE modernization P2 / 1.6 — see gemini's own equivalent test for
// the shared reasoning. The OpenAI-compatible convention's own plain
// {role, content} message shape needs no translation.
test('openai adapter.completeWithTools: historyTurns become real user/assistant messages, placed between system and the current user message', async () => {
  const openai = aiProviders.getAdapter('openai');
  const contextWithHistory = contextFromFlatPrompts({
    systemPrompt: 's',
    userPrompt: 'u',
    tools: P2C_TOOLS,
    historyTurns: [
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
    ],
  });
  const body = await capturedRequestBody(() =>
    openai.completeWithTools({ apiKey: 'k', model: 'gpt-x' }, contextWithHistory).catch(() => {}),
  );
  // System content also carries the 1.6 framing note whenever historyTurns
  // is non-empty (aiContextAssembly.js) — checked loosely here (starts
  // with/contains) since that exact wording is that file's own concern,
  // not this adapter's.
  assert.equal(body.messages.length, 4);
  assert.equal(body.messages[0].role, 'system');
  assert.ok(body.messages[0].content.startsWith('s'));
  assert.match(body.messages[0].content, /never new/);
  assert.deepEqual(body.messages.slice(1), [
    { role: 'user', content: 'earlier question' },
    { role: 'assistant', content: 'earlier answer' },
    { role: 'user', content: 'u' },
  ]);
});

test('openai adapter.completeWithTools: tool definitions are chain-equal across 3 iterations', async () => {
  const openai = aiProviders.getAdapter('openai');
  const cfg = { apiKey: 'k', model: 'gpt-x' };
  const turn = { toolName: 'tool_a', arguments: {}, callId: 'c1', resultText: 'R' };

  const body0 = await capturedRequestBody(() => openai.completeWithTools(cfg, P2C_CONTEXT, []).catch(() => {}));
  const body1 = await capturedRequestBody(() => openai.completeWithTools(cfg, P2C_CONTEXT, [turn]).catch(() => {}));
  const body2 = await capturedRequestBody(() =>
    openai.completeWithTools(cfg, P2C_CONTEXT, [turn, turn]).catch(() => {}),
  );

  assert.deepEqual(body0.tools, body1.tools);
  assert.deepEqual(body1.tools, body2.tools);
  assert.deepEqual(body0.messages[0], body1.messages[0]);
  assert.deepEqual(body1.messages[0], body2.messages[0]);
  assert.deepEqual(body0.messages[1], body1.messages[1]);
  assert.deepEqual(body1.messages[1], body2.messages[1]);
});

test('selfHosted adapter.completeWithTools: priorTurns appends the same OpenAI-compatible tool_calls/role:tool shape openai.js uses', async () => {
  const selfHosted = aiProviders.getAdapter('self_hosted');
  const priorTurns = [
    {
      toolName: 'tool_a',
      arguments: { x: 1 },
      callId: 'call_123',
      resultText: 'RESULT_TEXT',
    },
  ];
  const body = await capturedRequestBody(() =>
    selfHosted
      .completeWithTools({ baseUrl: 'http://localhost:1', model: 'sh-x' }, P2C_CONTEXT, priorTurns)
      .catch(() => {}),
  );

  assert.equal(body.messages.length, 4);
  assert.deepEqual(body.messages[2], {
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'call_123', type: 'function', function: { name: 'tool_a', arguments: '{"x":1}' } }],
  });
  assert.deepEqual(body.messages[3], { role: 'tool', tool_call_id: 'call_123', content: 'RESULT_TEXT' });
});

test('selfHosted adapter.completeWithTools: priorTurns=[]/omitted produces a byte-identical base turn to today (regression lock)', async () => {
  const selfHosted = aiProviders.getAdapter('self_hosted');
  const withEmpty = await capturedRequestBody(() =>
    selfHosted.completeWithTools({ baseUrl: 'http://localhost:1', model: 'sh-x' }, P2C_CONTEXT, []).catch(() => {}),
  );
  const omitted = await capturedRequestBody(() =>
    selfHosted.completeWithTools({ baseUrl: 'http://localhost:1', model: 'sh-x' }, P2C_CONTEXT).catch(() => {}),
  );
  assert.deepEqual(withEmpty.messages, [
    { role: 'system', content: 's' },
    { role: 'user', content: 'u' },
  ]);
  assert.deepEqual(withEmpty, omitted);
});

// ARCNAVE modernization P2 / 1.6 — see gemini's own equivalent test for
// the shared reasoning (same OpenAI-compatible convention openai.js uses).
test('selfHosted adapter.completeWithTools: historyTurns become real user/assistant messages, placed between system and the current user message', async () => {
  const selfHosted = aiProviders.getAdapter('self_hosted');
  const contextWithHistory = contextFromFlatPrompts({
    systemPrompt: 's',
    userPrompt: 'u',
    tools: P2C_TOOLS,
    historyTurns: [
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
    ],
  });
  const body = await capturedRequestBody(() =>
    selfHosted.completeWithTools({ baseUrl: 'http://localhost:1', model: 'sh-x' }, contextWithHistory).catch(() => {}),
  );
  // System content also carries the 1.6 framing note whenever historyTurns
  // is non-empty (aiContextAssembly.js) — checked loosely here, same as
  // openai's own equivalent test.
  assert.equal(body.messages.length, 4);
  assert.equal(body.messages[0].role, 'system');
  assert.ok(body.messages[0].content.startsWith('s'));
  assert.match(body.messages[0].content, /never new/);
  assert.deepEqual(body.messages.slice(1), [
    { role: 'user', content: 'earlier question' },
    { role: 'assistant', content: 'earlier answer' },
    { role: 'user', content: 'u' },
  ]);
});

test('selfHosted adapter.completeWithTools: tool definitions are chain-equal across 3 iterations', async () => {
  const selfHosted = aiProviders.getAdapter('self_hosted');
  const cfg = { baseUrl: 'http://localhost:1', model: 'sh-x' };
  const turn = { toolName: 'tool_a', arguments: {}, callId: 'c1', resultText: 'R' };

  const body0 = await capturedRequestBody(() => selfHosted.completeWithTools(cfg, P2C_CONTEXT, []).catch(() => {}));
  const body1 = await capturedRequestBody(() => selfHosted.completeWithTools(cfg, P2C_CONTEXT, [turn]).catch(() => {}));
  const body2 = await capturedRequestBody(() =>
    selfHosted.completeWithTools(cfg, P2C_CONTEXT, [turn, turn]).catch(() => {}),
  );

  assert.deepEqual(body0.tools, body1.tools);
  assert.deepEqual(body1.tools, body2.tools);
  assert.deepEqual(body0.messages[0], body1.messages[0]);
  assert.deepEqual(body1.messages[0], body2.messages[0]);
  assert.deepEqual(body0.messages[1], body1.messages[1]);
  assert.deepEqual(body1.messages[1], body2.messages[1]);
});
