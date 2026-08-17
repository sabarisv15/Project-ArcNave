'use strict';

// End-to-end proof of ADR-024 — a real running Express app against a
// live Postgres, same harness tests/auth.test.js already uses. Proves
// session revocation (now unconditional, permanent architecture) via
// the real, unmocked auth flow: a password reset actually invalidates
// a previously-issued access token, immediately.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const argon2 = require('argon2');
const { Pool } = require('pg');
const createApp = require('../src/app');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const VALID_PASSWORD = 'correct horse battery staple';

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
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = text;
        }
        resolve({ status: res.statusCode, body: parsed });
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

async function seedTenantWithUser(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const college = { collegeId: `sesrev${suffix}`, subdomain: `sesrevtenant${suffix}` };
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [college.collegeId, college.subdomain],
  );
  const passwordHash = await argon2.hash(VALID_PASSWORD);
  const result = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'sesrevuser', 'sesrevuser@example.com', $2, 'staff', true)
     RETURNING id`,
    [college.collegeId, passwordHash],
  );
  return { college, userId: result.rows[0].id, username: 'sesrevuser' };
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM user_mfa_otps WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM password_reset_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('session revocation', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const tenant = await seedTenantWithUser(adminPool);

  t.after(async () => {
    await stopServer(server);
    await cleanupTenant(adminPool, tenant.college);
    await adminPool.end();
  });

  const tenantHeaders = { host: `${tenant.college.subdomain}.arcnave.test` };

  function login(password = VALID_PASSWORD, username = tenant.username) {
    return post(baseUrl, '/api/v1/auth/login', tenantHeaders, { username, password });
  }

  await t.test('a freshly issued token authenticates normally under enforcement', async () => {
    const loginResp = await login();
    assert.equal(loginResp.status, 200);

    const meResp = await get(baseUrl, '/api/v1/auth/me', {
      ...tenantHeaders,
      authorization: `Bearer ${loginResp.body.access_token}`,
    });
    assert.equal(meResp.status, 200);
    assert.equal(meResp.body.user_id, tenant.userId);
  });

  await t.test('a password reset revokes every access token issued before it, immediately', async () => {
    const loginResp = await login();
    assert.equal(loginResp.status, 200);
    const preResetToken = loginResp.body.access_token;

    const preCheck = await get(baseUrl, '/api/v1/auth/me', {
      ...tenantHeaders,
      authorization: `Bearer ${preResetToken}`,
    });
    assert.equal(preCheck.status, 200, 'sanity check: the token works before the reset');

    const notificationService = require('../src/services/notificationService');
    let capturedToken = null;
    const emailMock = t.mock.method(notificationService, 'sendPasswordResetEmail', async (client, { token }) => {
      capturedToken = token;
      return { status: 'stubbed' };
    });
    t.after(() => emailMock.mock.restore());

    const requestResp = await post(baseUrl, '/api/v1/auth/password-reset', tenantHeaders, { email: 'sesrevuser@example.com' });
    assert.equal(requestResp.status, 204);
    assert.ok(capturedToken);

    const confirmResp = await post(baseUrl, '/api/v1/auth/password-reset/confirm', tenantHeaders, {
      token: capturedToken, new_password: 'ABrandNewPassword-456',
    });
    assert.equal(confirmResp.status, 204);

    // The exact same, still-unexpired token that worked above must now
    // be rejected — this is the whole point of ADR-024: a reset alone
    // (no revocation) would have left this token live until natural
    // expiry.
    const postResetCheck = await get(baseUrl, '/api/v1/auth/me', {
      ...tenantHeaders,
      authorization: `Bearer ${preResetToken}`,
    });
    assert.equal(postResetCheck.status, 401);

    // A freshly issued token (post-reset login, new password) carries
    // the new token_version and works normally.
    const freshLogin = await login('ABrandNewPassword-456');
    assert.equal(freshLogin.status, 200);
    const freshCheck = await get(baseUrl, '/api/v1/auth/me', {
      ...tenantHeaders,
      authorization: `Bearer ${freshLogin.body.access_token}`,
    });
    assert.equal(freshCheck.status, 200);
  });

  await t.test('the reset also revokes every outstanding refresh token for the account, in bulk', async () => {
    const loginResp = await login('ABrandNewPassword-456');
    assert.equal(loginResp.status, 200);
    const oldRefreshToken = loginResp.body.refresh_token;

    const notificationService = require('../src/services/notificationService');
    let capturedToken = null;
    const emailMock = t.mock.method(notificationService, 'sendPasswordResetEmail', async (client, { token }) => {
      capturedToken = token;
      return { status: 'stubbed' };
    });
    t.after(() => emailMock.mock.restore());

    const requestResp = await post(baseUrl, '/api/v1/auth/password-reset', tenantHeaders, { email: 'sesrevuser@example.com' });
    assert.equal(requestResp.status, 204);

    const confirmResp = await post(baseUrl, '/api/v1/auth/password-reset/confirm', tenantHeaders, {
      token: capturedToken, new_password: 'YetAnotherPassword-789',
    });
    assert.equal(confirmResp.status, 204);

    const refreshResp = await post(baseUrl, '/api/v1/auth/refresh', tenantHeaders, { refresh_token: oldRefreshToken });
    assert.equal(refreshResp.status, 401, 'the pre-reset refresh token must already be revoked, not just about to expire');
  });
});
