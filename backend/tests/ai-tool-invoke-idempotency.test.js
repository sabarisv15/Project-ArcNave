'use strict';

// Regression test for the P1 finding from the pre-launch audit: POST
// /ai/tools/:name/invoke had no idempotency protection — a retry or
// double-click could double-execute an L1/L2 write tool. Fixed by
// aiService.invokeToolIdempotent (opt-in via an Idempotency-Key
// header) — see the idempotency_keys migration's own comment for the
// crash-timing analysis this test's assertions are built on.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedPrincipalPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'IdempotencyTestPass123!';

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
        resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function post(baseUrl, path, headers, body) {
  return requestJson(baseUrl, path, 'POST', { headers, body });
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
  const college = { collegeId: `idem${suffix}`, subdomain: `idemtenant${suffix}` };
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [college.collegeId, college.subdomain],
  );
  const passwordHash = await security.hashPassword(PASSWORD);
  const result = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'principaluser', 'principaluser@example.com', $2, 'principal', true) RETURNING id`,
    [college.collegeId, passwordHash],
  );
  const userId = result.rows[0].id;
  await adminPool.query("INSERT INTO staff (college_id, user_id, full_name) VALUES ($1, $2, 'Test Principal')", [college.collegeId, userId]);
  await seedPrincipalPosition(adminPool, { collegeId: college.collegeId, userId });
  return { ...college, userId };
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM idempotency_keys WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM notifications WHERE college_id = $1', [college.collegeId]);
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('AI tool-invoke idempotency', async (t) => {
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

  async function login() {
    const resp = await post(baseUrl, '/api/v1/auth/login', { host: hostFor(college.subdomain) }, { username: 'principaluser', password: PASSWORD });
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  function headersFor(token, idempotencyKey) {
    const headers = { host: hostFor(college.subdomain), authorization: `Bearer ${token}` };
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    return headers;
  }

  function draftParams(toAddress) {
    return { channel: 'email', toAddress, subject: 'test', body: 'idempotency test body' };
  }

  async function countNotifications(toAddress) {
    const result = await adminPool.query(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE college_id = $1 AND to_address = $2',
      [college.collegeId, toAddress],
    );
    return result.rows[0].count;
  }

  await t.test('no Idempotency-Key header: behavior is unchanged — two calls really do create two rows', async () => {
    const token = await login();
    const toAddress = `no-key-${crypto.randomUUID()}@example.com`;
    const first = await post(baseUrl, '/api/v1/ai/tools/draft_notification/invoke', headersFor(token), { params: draftParams(toAddress) });
    const second = await post(baseUrl, '/api/v1/ai/tools/draft_notification/invoke', headersFor(token), { params: draftParams(toAddress) });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(await countNotifications(toAddress), 2, 'without a key, two real calls means two real drafts — no accidental dedup');
  });

  await t.test('same Idempotency-Key, same params: second call replays the stored response, does not re-execute', async () => {
    const token = await login();
    const toAddress = `same-key-${crypto.randomUUID()}@example.com`;
    const key = crypto.randomUUID();

    const first = await post(baseUrl, '/api/v1/ai/tools/draft_notification/invoke', headersFor(token, key), { params: draftParams(toAddress) });
    assert.equal(first.status, 200);

    const second = await post(baseUrl, '/api/v1/ai/tools/draft_notification/invoke', headersFor(token, key), { params: draftParams(toAddress) });
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, first.body, 'a replayed response must be byte-for-byte the stored first response');

    assert.equal(await countNotifications(toAddress), 1, 'the handler must have run exactly once despite two identical requests');
  });

  await t.test('same Idempotency-Key, different params: 422, not a silent replay of the wrong response', async () => {
    const token = await login();
    const key = crypto.randomUUID();
    const toAddressA = `diff-params-a-${crypto.randomUUID()}@example.com`;
    const toAddressB = `diff-params-b-${crypto.randomUUID()}@example.com`;

    const first = await post(baseUrl, '/api/v1/ai/tools/draft_notification/invoke', headersFor(token, key), { params: draftParams(toAddressA) });
    assert.equal(first.status, 200);

    const second = await post(baseUrl, '/api/v1/ai/tools/draft_notification/invoke', headersFor(token, key), { params: draftParams(toAddressB) });
    assert.equal(second.status, 422);

    assert.equal(await countNotifications(toAddressB), 0, 'the mismatched-params request must never have reached the handler');
  });

  await t.test('two genuinely concurrent requests with the same key: exactly one execution, both callers get the same real response', async () => {
    const token = await login();
    const toAddress = `concurrent-${crypto.randomUUID()}@example.com`;
    const key = crypto.randomUUID();

    const [a, b] = await Promise.all([
      post(baseUrl, '/api/v1/ai/tools/draft_notification/invoke', headersFor(token, key), { params: draftParams(toAddress) }),
      post(baseUrl, '/api/v1/ai/tools/draft_notification/invoke', headersFor(token, key), { params: draftParams(toAddress) }),
    ]);

    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.deepEqual(a.body, b.body, 'both concurrent callers must see the same single real result');
    assert.equal(await countNotifications(toAddress), 1, 'the DB UNIQUE constraint must have serialized this to exactly one real execution');
  });
});
