'use strict';

// P3 4.9 — contract tests for routes/ai.js, the first of the noisiest
// routes to get real zod schemas (middleware/validate.js pattern,
// routes/auth.js's /auth/login precedent). ai.test.js already proves
// business behavior for valid requests end to end; this file proves the
// SCHEMA LAYER itself: a genuinely wrong-typed field gets a clean 400
// from validate() instead of whatever undefined behavior a raw type
// mismatch would otherwise produce downstream, a well-formed request is
// unaffected by the new middleware, and the schema is really the one
// serving GET /api/v1/openapi.json — not a second, driftable copy.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const config = require('../src/config');
const { seedPrincipalPosition, cleanupPositionRows } = require('./helpers/positionFixtures');
const embeddingService = require('../src/services/embeddingService');

// Same reasoning as ai.test.js's own top comment — no real semantic
// tool-retrieval network call in this file.
embeddingService.isAvailable = () => false;

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'AiContractPass123!';

function requestJson(baseUrl, path, method, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const reqHeaders = { ...headers };
    if (payload !== undefined) {
      reqHeaders['content-type'] = 'application/json';
      reqHeaders['content-length'] = Buffer.byteLength(payload);
    }
    const req = http.request(url, { method, headers: reqHeaders }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsedBody = null;
        try {
          parsedBody = text ? JSON.parse(text) : null;
        } catch {
          parsedBody = text;
        }
        resolve({ status: res.statusCode, body: parsedBody });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function get(baseUrl, path, headers) {
  return requestJson(baseUrl, path, 'GET', { headers });
}

function post(baseUrl, path, headers, body) {
  return requestJson(baseUrl, path, 'POST', { headers, body });
}

function hostFor(subdomain) {
  return `${subdomain}.arcnave.test`;
}

async function seedTenant(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const college = {
    collegeId: `aic${suffix}`,
    subdomain: `aicontract${suffix}`,
    address: 'contract-test-address',
  };
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain, address) VALUES ($1, $1, $2, $3)', [
    college.collegeId,
    college.subdomain,
    college.address,
  ]);
  const passwordHash = await security.hashPassword(PASSWORD);
  const userResult = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'principaluser', 'principaluser@example.com', $2, 'principal', true) RETURNING id`,
    [college.collegeId, passwordHash],
  );
  const userId = userResult.rows[0].id;
  await adminPool.query(`INSERT INTO staff (college_id, user_id, full_name) VALUES ($1, $2, 'Contract Test Principal')`, [
    college.collegeId,
    userId,
  ]);
  await seedPrincipalPosition(adminPool, { collegeId: college.collegeId, userId });
  return { ...college, userId };
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM ai_usage_counters WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('ai.js contract', async (t) => {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.on('listening', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const college = await seedTenant(adminPool);

  const originalDefaultAiProvider = config.defaultAiProvider;
  config.defaultAiProvider = 'openai';

  t.after(async () => {
    config.defaultAiProvider = originalDefaultAiProvider;
    await new Promise((resolve) => server.close(resolve));
    await cleanupTenant(adminPool, college);
    await adminPool.end();
  });

  async function login() {
    const resp = await requestJson(baseUrl, '/api/v1/auth/login', 'POST', {
      headers: { host: hostFor(college.subdomain) },
      body: { username: 'principaluser', password: PASSWORD },
    });
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  function headers(token) {
    return { host: hostFor(college.subdomain), authorization: `Bearer ${token}` };
  }

  await t.test('GET /api/v1/openapi.json lists ai.js paths, sourced from the same schema validate() enforces', async () => {
    const resp = await get(baseUrl, '/api/v1/openapi.json', { host: hostFor(college.subdomain) });
    assert.equal(resp.status, 200);
    assert.ok(resp.body.paths['/ai/ask'], '/ai/ask documented');
    assert.ok(resp.body.paths['/ai/ask'].post, 'POST /ai/ask documented');
    assert.ok(resp.body.paths['/ai/ask/stream'].post, 'POST /ai/ask/stream documented');
    assert.ok(resp.body.paths['/ai/workflow/execute'].post, 'POST /ai/workflow/execute documented');
    assert.ok(resp.body.paths['/ai/tools/{name}/invoke'].post, 'POST /ai/tools/{name}/invoke documented');
    // The generated requestBody schema for /ai/ask really is askSchema's
    // own shape, not a hand-copied description — question is listed as
    // a string-typed property.
    const askRequestSchema =
      resp.body.paths['/ai/ask'].post.requestBody.content['application/json'].schema;
    assert.equal(askRequestSchema.properties.question.type, 'string');
  });

  await t.test('POST /ai/ask with a well-formed body is unaffected by the new validate() middleware', async () => {
    const token = await login();
    const resp = await post(baseUrl, '/api/v1/ai/ask', headers(token), {
      question: 'What is my college address?',
    });
    // No provider configured in this test's default state (config.openai.apiKey
    // untouched here) — the point isn't a successful AI answer (ai.test.js
    // already proves that end to end), it's that a schema-conformant body
    // reaches aiService at all, never rejected by validate() itself. A
    // downstream 503 (LlmNotConfiguredError) or 200 both prove that; a 400
    // with the validate() shape would not.
    assert.notEqual(resp.status, 400);
  });

  await t.test('POST /ai/ask with question sent as the wrong type gets a clean 400 from validate(), never a 500', async () => {
    const token = await login();
    const resp = await post(baseUrl, '/api/v1/ai/ask', headers(token), { question: 12345 });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
    assert.ok(Array.isArray(resp.body.errors));
    assert.ok(resp.body.errors.some((e) => e.path === 'body.question'));
  });

  await t.test('POST /ai/ask with attachment_ids sent as a non-array gets a clean 400', async () => {
    const token = await login();
    const resp = await post(baseUrl, '/api/v1/ai/ask', headers(token), {
      question: 'hi',
      attachment_ids: 'not-an-array',
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('POST /ai/ask with an empty body (no question at all) is NOT rejected by validate() — the existing aiService.askAgent business-validation message is unchanged', async () => {
    const token = await login();
    const resp = await post(baseUrl, '/api/v1/ai/ask', headers(token), {});
    // Falls through to aiService.askAgent, which throws
    // AiServiceValidationError -> mapAiToolError -> 400 with ITS OWN
    // message — never validate()'s generic 'Invalid request' shape. This
    // is the schema-permissiveness contract 4.9's own comment in ai.js
    // documents: never duplicate business-layer requiredness.
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'question is required and must be a non-empty string');
  });

  await t.test('POST /ai/tools/:name/invoke with a well-formed body is unaffected by validate()', async () => {
    const token = await login();
    const resp = await post(baseUrl, '/api/v1/ai/tools/get_college_profile/invoke', headers(token), { params: {} });
    assert.equal(resp.status, 200);
  });

  await t.test('POST /ai/tools/:name/invoke with params sent as the wrong type gets a clean 400', async () => {
    const token = await login();
    const resp = await post(baseUrl, '/api/v1/ai/tools/get_college_profile/invoke', headers(token), {
      params: 'not-an-object',
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('POST /ai/workflow/execute with steps sent as the wrong type gets a clean 400 from validate()', async () => {
    const token = await login();
    const resp = await post(baseUrl, '/api/v1/ai/workflow/execute', headers(token), { steps: 'not-an-array' });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('POST /ai/workflow/execute with steps entirely omitted is NOT rejected by validate() — the route\'s own message is unchanged', async () => {
    const token = await login();
    const resp = await post(baseUrl, '/api/v1/ai/workflow/execute', headers(token), {});
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'steps is required and must be a non-empty array');
  });
});
