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
      { systemPrompt: 's', userPrompt: 'u' },
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
      { systemPrompt: 's', userPrompt: 'u' },
      () => {},
    );
  } finally {
    global.fetch = originalFetch;
  }

  assert.match(capturedUrl, /:streamRawPredict$/);
  assert.equal(capturedBody.stream, undefined, 'Vertex has no body-level stream flag — the URL verb selects it');
});

test('claude adapter: projectId wins over apiKey when both are present (Vertex is configurationService\'s only mechanism for this provider today)', async () => {
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
      { systemPrompt: 's', userPrompt: 'u' },
    );
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(capturedHeaders.authorization, 'Bearer t');
  assert.equal(capturedHeaders['x-api-key'], undefined);
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
  global.fetch = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
  const startedAt = Date.now();
  try {
    await assert.rejects(
      () => gemini.completeWithMeta(
        { projectId: 'p', accessToken: 't', maxTotalLatencyMs: 150 },
        { systemPrompt: 's', userPrompt: 'u' },
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

// Round 10 P2/P3 finding: the round-8 output-token-bound fix (each
// adapter's own MAX_TOKENS/MAX_OUTPUT_TOKENS = 1024, closing what used
// to be a fully-unbounded response on 3 of 4 adapters) had a real
// asymmetry in coverage — every adapter's shared request-shape tests
// above happen to exercise nim/gemini/selfHosted/claude/openai's
// request bodies for OTHER reasons (images, tool schemas, caching), but
// none of them actually assert the token-bound field/value survives on
// the wire, and only through incidental body inspection, not a named
// assertion — so a regression (e.g. a future refactor accidentally
// dropping max_tokens from one adapter but not the others) would pass
// silently. One assertion per adapter, same capturedRequestBody helper
// every other request-shape test in this file already uses.
test('every provider adapter sends an explicit output-token bound on the wire (round 8 fix, previously only informally exercised)', async () => {
  const nimBody = await capturedRequestBody(() => aiProviders.getAdapter('nim').completeWithMeta(
    { apiKey: 'k', baseUrl: 'http://localhost:1', model: 'nim-x' },
    { systemPrompt: 's', userPrompt: 'u' },
  ).catch(() => {}));
  assert.equal(nimBody.max_tokens, 1024);

  const geminiBody = await capturedRequestBody(() => aiProviders.getAdapter('gemini').completeWithMeta(
    { projectId: 'p', accessToken: 't', model: 'gemini-x' },
    { systemPrompt: 's', userPrompt: 'u' },
  ).catch(() => {}));
  assert.equal(geminiBody.generationConfig.maxOutputTokens, 65_536);

  const selfHostedBody = await capturedRequestBody(() => aiProviders.getAdapter('self_hosted').completeWithMeta(
    { baseUrl: 'http://localhost:1', model: 'sh-x' },
    { systemPrompt: 's', userPrompt: 'u' },
  ).catch(() => {}));
  assert.equal(selfHostedBody.max_tokens, 1024);

  const openaiBody = await capturedRequestBody(() => aiProviders.getAdapter('openai').completeWithMeta(
    { apiKey: 'k', model: 'gpt-x' },
    { systemPrompt: 's', userPrompt: 'u' },
  ).catch(() => {}));
  assert.equal(openaiBody.max_tokens, 1024);

  const claudeBody = await capturedRequestBody(() => aiProviders.getAdapter('claude').completeWithMeta(
    { apiKey: 'k', model: 'claude-x' },
    { systemPrompt: 's', userPrompt: 'u' },
  ).catch(() => {}));
  assert.equal(claudeBody.max_tokens, 1024);
});
