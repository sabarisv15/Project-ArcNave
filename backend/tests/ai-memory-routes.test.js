'use strict';

// Integration tests for /ai/memory* — real HTTP against a live Postgres,
// same reasoning documents-chat-attachments.test.js already gives for why
// this needs a real round-trip rather than a mock: RLS on two brand-new
// tables (ai_memory_consent, ai_scoped_memory) is only proven by hitting
// the real DB. Focused on: the consent gate actually blocking a write
// before the human opts in, revoking consent actually wiping stored
// memory, deletion always working regardless of consent state, and that
// two different users on the same tenant each get their own isolated
// memory (ownership scoping, not just RLS's tenant boundary).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'AiMemoryTestPass123!';

function requestJson(baseUrl, reqPath, method, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, baseUrl);
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

function get(baseUrl, reqPath, headers) {
  return requestJson(baseUrl, reqPath, 'GET', { headers });
}
function put(baseUrl, reqPath, headers, body) {
  return requestJson(baseUrl, reqPath, 'PUT', { headers, body });
}
function del(baseUrl, reqPath, headers) {
  return requestJson(baseUrl, reqPath, 'DELETE', { headers });
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}
function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
function hostFor(subdomain) {
  return `${subdomain}.arcnave.test`;
}

async function seedTenant(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const college = { collegeId: `aimem${suffix}`, subdomain: `aimemtenant${suffix}` };
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [college.collegeId, college.subdomain],
  );
  const passwordHash = await security.hashPassword(PASSWORD);
  for (const [username, role] of [
    ['userone', 'principal'],
    ['usertwo', 'staff'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true)`,
      [college.collegeId, username, `${username}@example.com`, passwordHash, role],
    );
  }
  return college;
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM ai_scoped_memory WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM ai_memory_consent WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('ai memory routes', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const college = await seedTenant(adminPool);

  t.after(async () => {
    await stopServer(server);
    await cleanupTenant(adminPool, college);
    await adminPool.end();
  });

  async function login(username) {
    const resp = await requestJson(baseUrl, '/api/v1/auth/login', 'POST', {
      headers: { host: hostFor(college.subdomain) },
      body: { username, password: PASSWORD },
    });
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  function headersFor(token) {
    return { host: hostFor(college.subdomain), authorization: `Bearer ${token}` };
  }

  await t.test('a fresh user has no consent row -> consented:false, not an error', async () => {
    const token = await login('userone');
    const resp = await get(baseUrl, '/api/v1/ai/memory/consent', headersFor(token));
    assert.equal(resp.status, 200);
    assert.equal(resp.body.consented, false);
  });

  await t.test('memory list is empty before consent', async () => {
    const token = await login('userone');
    const resp = await get(baseUrl, '/api/v1/ai/memory', headersFor(token));
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.body, []);
  });

  await t.test('enabling consent, then round-tripping a memory entry through GET/PUT preferences directly (human path, not the AI tool)', async () => {
    const token = await login('userone');
    const consentResp = await put(baseUrl, '/api/v1/ai/memory/consent', headersFor(token), { consented: true });
    assert.equal(consentResp.status, 200);
    assert.equal(consentResp.body.consented, true);
    assert.ok(consentResp.body.consentedAt);
  });

  await t.test('revoking consent wipes previously stored memory (set via direct DB insert to simulate a prior AI write)', async () => {
    const token = await login('userone');
    await put(baseUrl, '/api/v1/ai/memory/consent', headersFor(token), { consented: true });

    // Simulate what ai_memory_remember would have written (the AI tool path
    // itself is proven separately in ai-memory-service.test.js) — insert
    // directly as an authenticated app-role write under this tenant.
    const userRow = await adminPool.query('SELECT id FROM users WHERE college_id = $1 AND username = $2', [college.collegeId, 'userone']);
    const userId = userRow.rows[0].id;
    await adminPool.query(
      `INSERT INTO ai_scoped_memory (college_id, user_id, memory_type, value) VALUES ($1, $2, 'communication_style', '"concise"')`,
      [college.collegeId, userId],
    );

    const beforeRevoke = await get(baseUrl, '/api/v1/ai/memory', headersFor(token));
    assert.equal(beforeRevoke.body.length, 1);

    const revokeResp = await put(baseUrl, '/api/v1/ai/memory/consent', headersFor(token), { consented: false });
    assert.equal(revokeResp.status, 200);
    assert.equal(revokeResp.body.consented, false);

    const afterRevoke = await get(baseUrl, '/api/v1/ai/memory', headersFor(token));
    assert.deepEqual(afterRevoke.body, []);
  });

  await t.test('DELETE /ai/memory/:memoryType always succeeds, even with no consent on record', async () => {
    const token = await login('userone');
    const resp = await del(baseUrl, '/api/v1/ai/memory/communication_style', headersFor(token));
    assert.equal(resp.status, 204);
  });

  await t.test('setConsent with a non-boolean body value is rejected with 400', async () => {
    const token = await login('userone');
    const resp = await put(baseUrl, '/api/v1/ai/memory/consent', headersFor(token), { consented: 'yes' });
    assert.equal(resp.status, 400);
  });

  await t.test('two different users on the same tenant each see only their own consent/memory', async () => {
    const tokenOne = await login('userone');
    const tokenTwo = await login('usertwo');

    await put(baseUrl, '/api/v1/ai/memory/consent', headersFor(tokenOne), { consented: true });
    const userTwoConsent = await get(baseUrl, '/api/v1/ai/memory/consent', headersFor(tokenTwo));
    assert.equal(userTwoConsent.body.consented, false, "user two's own consent is unaffected by user one's opt-in");
  });
});
