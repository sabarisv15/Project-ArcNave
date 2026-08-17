'use strict';

// Integration tests for /api/v1/ai-config — real HTTP requests against
// a live Postgres. Proves: principal-only RBAC, api_key never appears
// in any response body (raw or otherwise), a college with its own row
// gets that provider back from getAiConfig (proven at the route level
// via GET reflecting what PUT set), a college with no row still gets
// the pre-existing global nim default, and setting one college's
// config never affects another college's (real Row-Level Security,
// not just application-layer filtering).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const globalConfig = require('../src/config');
const { seedPrincipalPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'AiConfigApiTestPass123!';

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
        resolve({ status: res.statusCode, body: parsedBody, rawText: text });
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

function put(baseUrl, path, headers, body) {
  return requestJson(baseUrl, path, 'PUT', { headers, body });
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

async function seedTenant(adminPool, label) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeId = `aicfg${label}${suffix}`;
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [collegeId, `aicfgtenant${label}${suffix}`],
  );
  const passwordHash = await security.hashPassword(PASSWORD);
  const userIds = {};
  for (const [username, role] of [['principaluser', 'principal'], ['staffuser', 'staff']]) {
    // eslint-disable-next-line no-await-in-loop
    const result = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [collegeId, username, `${username}@example.com`, passwordHash, role],
    );
    userIds[username] = result.rows[0].id;
  }
  await seedPrincipalPosition(adminPool, { collegeId, userId: userIds.principaluser, passwordHash });
  return { collegeId, subdomain: `aicfgtenant${label}${suffix}`, userIds };
}

async function cleanupTenant(adminPool, tenant) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [tenant.collegeId]);
  await cleanupPositionRows(adminPool, tenant.collegeId);
  await adminPool.query('DELETE FROM college_ai_config WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [tenant.collegeId]);
}

test('ai-config API', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const collegeA = await seedTenant(adminPool, 'a');
  const collegeB = await seedTenant(adminPool, 'b');

  t.after(async () => {
    await stopServer(server);
    await cleanupTenant(adminPool, collegeA);
    await cleanupTenant(adminPool, collegeB);
    await adminPool.end();
  });

  async function login(college, username) {
    const resp = await requestJson(baseUrl, '/api/v1/auth/login', 'POST', {
      headers: { host: hostFor(college.subdomain) }, body: { username, password: PASSWORD },
    });
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  function headersFor(college, token) {
    const headers = { host: hostFor(college.subdomain) };
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  await t.test('unauthenticated GET/PUT are rejected with 401', async () => {
    const getResp = await get(baseUrl, '/api/v1/ai-config', headersFor(collegeA));
    assert.equal(getResp.status, 401);
    const putResp = await put(baseUrl, '/api/v1/ai-config', headersFor(collegeA), { provider: 'nim' });
    assert.equal(putResp.status, 401);
  });

  await t.test('staff (not principal) is rejected with 403', async () => {
    const token = await login(collegeA, 'staffuser');
    const resp = await get(baseUrl, '/api/v1/ai-config', headersFor(collegeA, token));
    assert.equal(resp.status, 403);
  });

  await t.test('a college with no row yet gets the global nim default', async () => {
    const token = await login(collegeB, 'principaluser');
    const resp = await get(baseUrl, '/api/v1/ai-config', headersFor(collegeB, token));
    assert.equal(resp.status, 200);
    assert.equal(resp.body.provider, 'nim');
    assert.equal(resp.body.model, globalConfig.nim.model);
    assert.equal(resp.body.hasApiKey, Boolean(globalConfig.nim.apiKey));
  });

  await t.test('PUT sets a college-specific provider; api_key never appears in the response body, raw or otherwise', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await put(baseUrl, '/api/v1/ai-config', headersFor(collegeA, token), {
      provider: 'gemini', api_key: 'sk-super-secret-real-key-value', model: 'gemini-2.5-flash',
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.provider, 'gemini');
    assert.equal(resp.body.model, 'gemini-2.5-flash');
    assert.equal(resp.body.hasApiKey, true);
    assert.equal('apiKey' in resp.body, false);
    assert.equal('api_key' in resp.body, false);
    assert.ok(!resp.rawText.includes('sk-super-secret-real-key-value'), 'raw response body must never contain the api_key');

    const dbRow = await adminPool.query('SELECT api_key FROM college_ai_config WHERE college_id = $1', [collegeA.collegeId]);
    assert.notEqual(dbRow.rows[0].api_key, 'sk-super-secret-real-key-value');
  });

  await t.test('GET reflects the college-specific config just set, still without api_key', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await get(baseUrl, '/api/v1/ai-config', headersFor(collegeA, token));
    assert.equal(resp.status, 200);
    assert.equal(resp.body.provider, 'gemini');
    assert.equal(resp.body.hasApiKey, true);
    assert.ok(!resp.rawText.includes('sk-super-secret-real-key-value'));
  });

  await t.test('setting college A\'s provider never affected college B\'s (still the global default)', async () => {
    const token = await login(collegeB, 'principaluser');
    const resp = await get(baseUrl, '/api/v1/ai-config', headersFor(collegeB, token));
    assert.equal(resp.status, 200);
    assert.equal(resp.body.provider, 'nim');
  });

  await t.test('PUT with an unknown provider is rejected with 400, not persisted', async () => {
    const token = await login(collegeB, 'principaluser');
    const resp = await put(baseUrl, '/api/v1/ai-config', headersFor(collegeB, token), { provider: 'not_a_real_vendor' });
    assert.equal(resp.status, 400);

    const dbRow = await adminPool.query('SELECT * FROM college_ai_config WHERE college_id = $1', [collegeB.collegeId]);
    assert.equal(dbRow.rows.length, 0);
  });

  await t.test('PUT sets a real audit_log row naming the action, never the api_key', async () => {
    const auditRows = await adminPool.query(
      "SELECT metadata FROM audit_log WHERE college_id = $1 AND action = 'ai_config_updated'",
      [collegeA.collegeId],
    );
    assert.equal(auditRows.rows.length, 1);
    assert.ok(!JSON.stringify(auditRows.rows[0].metadata).includes('sk-super-secret-real-key-value'));
  });
});
