'use strict';

// Integration tests for tenant-side JWT auth (login/refresh/logout),
// hit through a real running Express app against a live Postgres —
// ported from the deleted Python test_auth.py (git history). Also
// covers the three JWT-claim tenant-resolution cases that couldn't
// exist until AuthMiddleware did: resolving from a JWT claim alone,
// agreeing with a matching subdomain, and — the case explicitly
// called out when the Python version's own TODO(auth) was completed —
// a JWT claiming one tenant plus a subdomain resolving to a different
// one must 400, never silently pick either.
//
// Platform Admin auth is out of scope — see services/authService.js's
// module comment and ADR-010.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const argon2 = require('argon2');
const { Pool } = require('pg');
const createApp = require('../src/app');
const config = require('../src/config');

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

function hostFor(subdomain) {
  return `${subdomain}.arcnave.test`;
}

function bearerFor({ userId, collegeId, role }) {
  const token = jwt.sign(
    { sub: userId, college_id: collegeId, role, type: 'access' },
    config.jwtSecretKey,
    { algorithm: config.jwtAlgorithm, expiresIn: '15m' },
  );
  return `Bearer ${token}`;
}

async function seedTenantWithUser(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const college = { collegeId: `auth${suffix}`, subdomain: `authtenant${suffix}` };
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [college.collegeId, college.subdomain],
  );
  const passwordHash = await argon2.hash(VALID_PASSWORD);
  const result = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'authuser', 'authuser@example.com', $2, 'staff', true)
     RETURNING id`,
    [college.collegeId, passwordHash],
  );
  return { college, userId: result.rows[0].id, username: 'authuser' };
}

async function cleanupTenant(adminPool, college) {
  // audit_log.user_id FKs users(id) — must go before the users delete
  // below (task #17's login/logout audit logging, and task #19's MFA
  // challenge/enable/disable logging, both exercised extensively by
  // this file).
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  // user_mfa_otps.user_id also FKs users(id) — task #19.
  await adminPool.query('DELETE FROM user_mfa_otps WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  // password_reset_tokens also FKs to users(id) — must go before the
  // users delete below, same reasoning refresh_tokens already needed.
  await adminPool.query('DELETE FROM password_reset_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('auth', async (t) => {
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

  const tenantHeaders = { host: hostFor(tenant.college.subdomain) };

  function login(password = VALID_PASSWORD, username = tenant.username) {
    return post(baseUrl, '/api/v1/auth/login', tenantHeaders, { username, password });
  }

  await t.test('login succeeds and issues both tokens', async () => {
    const resp = await login();
    assert.equal(resp.status, 200);
    assert.ok(resp.body.access_token);
    assert.ok(resp.body.refresh_token);
    assert.equal(resp.body.token_type, 'bearer');

    const claims = jwt.verify(resp.body.access_token, config.jwtSecretKey, {
      algorithms: [config.jwtAlgorithm],
    });
    assert.equal(claims.college_id, tenant.college.collegeId);
    assert.equal(claims.sub, tenant.userId);
    assert.equal(claims.role, 'staff');
  });

  await t.test('login rejects wrong password', async () => {
    const resp = await login('wrong password');
    assert.equal(resp.status, 401);
  });

  await t.test('login rejects unknown username', async () => {
    const resp = await login(VALID_PASSWORD, 'no-such-user');
    assert.equal(resp.status, 401);
  });

  await t.test('login rejects inactive user', async () => {
    await adminPool.query('UPDATE users SET is_active = false WHERE id = $1', [tenant.userId]);
    try {
      const resp = await login();
      assert.equal(resp.status, 401);
    } finally {
      await adminPool.query('UPDATE users SET is_active = true WHERE id = $1', [tenant.userId]);
    }
  });

  await t.test('refresh rotates and the old token stops working', async () => {
    const loginResp = await login();
    const oldRefresh = loginResp.body.refresh_token;

    const refreshResp = await post(baseUrl, '/api/v1/auth/refresh', tenantHeaders, { refresh_token: oldRefresh });
    assert.equal(refreshResp.status, 200);
    assert.notEqual(refreshResp.body.refresh_token, oldRefresh);
    assert.ok(refreshResp.body.access_token);

    const reuseResp = await post(baseUrl, '/api/v1/auth/refresh', tenantHeaders, { refresh_token: oldRefresh });
    assert.equal(reuseResp.status, 401);
  });

  await t.test('refresh reuse of a revoked token is logged', async () => {
    const loginResp = await login();
    const refreshToken = loginResp.body.refresh_token;

    const first = await post(baseUrl, '/api/v1/auth/refresh', tenantHeaders, { refresh_token: refreshToken });
    assert.equal(first.status, 200);

    // authService.refresh's reuse-detection log goes through
    // logWarn (src/logging/logger.js) as of the request-scoped
    // logging slice — a single JSON string per call, not the
    // (message, object) two-arg shape a bare console.warn call would
    // have produced. Parse it rather than checking args[0] directly.
    const originalWarn = console.warn;
    const lines = [];
    console.warn = (text) => {
      lines.push(text);
    };
    let second;
    try {
      second = await post(baseUrl, '/api/v1/auth/refresh', tenantHeaders, { refresh_token: refreshToken });
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(second.status, 401);
    assert.ok(
      lines.some((text) => JSON.parse(text).message === 'refresh_token_reuse_detected'),
      'expected console.warn to be called with a refresh_token_reuse_detected log line',
    );
  });

  await t.test('logout revokes a refresh token', async () => {
    const loginResp = await login();
    const refreshToken = loginResp.body.refresh_token;

    const logoutResp = await post(baseUrl, '/api/v1/auth/logout', tenantHeaders, { refresh_token: refreshToken });
    assert.equal(logoutResp.status, 204);

    const reuseResp = await post(baseUrl, '/api/v1/auth/refresh', tenantHeaders, { refresh_token: refreshToken });
    assert.equal(reuseResp.status, 401);
  });

  await t.test('logout is idempotent for an unknown token', async () => {
    const resp = await post(baseUrl, '/api/v1/auth/logout', tenantHeaders, { refresh_token: 'not-a-real-token' });
    assert.equal(resp.status, 204);
  });

  // Module 8: the real reset-token flow replacing the old 501 stub.
  // Enumeration-safe (unknown email and real email both 204) and
  // requires a resolved tenant, same as login.
  await t.test('password reset request requires a resolved tenant', async () => {
    const resp = await post(baseUrl, '/api/v1/auth/password-reset', {}, { email: 'someone@example.com' });
    assert.equal(resp.status, 400);
  });

  await t.test('password reset request 204s for an unknown email — enumeration-safe', async () => {
    const resp = await post(baseUrl, '/api/v1/auth/password-reset', tenantHeaders, { email: 'nobody@example.com' });
    assert.equal(resp.status, 204);
  });

  await t.test('password reset end to end: request emails a token (never returned in the response), confirm changes the password, the token cannot be reused, and the old password stops working', async () => {
    const notificationService = require('../src/services/notificationService');
    let capturedToken = null;
    const emailMock = t.mock.method(notificationService, 'sendPasswordResetEmail', async (client, { to, token }) => {
      capturedToken = token;
      return { status: 'stubbed', to };
    });
    t.after(() => emailMock.mock.restore());

    const requestResp = await post(baseUrl, '/api/v1/auth/password-reset', tenantHeaders, { email: 'authuser@example.com' });
    assert.equal(requestResp.status, 204);
    assert.equal(requestResp.body, null);
    assert.ok(capturedToken, 'expected sendPasswordResetEmail to have been called with a real token');

    const confirmResp = await post(baseUrl, '/api/v1/auth/password-reset/confirm', tenantHeaders, {
      token: capturedToken, new_password: 'ABrandNewPassword-456',
    });
    assert.equal(confirmResp.status, 204);

    const oldPasswordLogin = await login(VALID_PASSWORD);
    assert.equal(oldPasswordLogin.status, 401);

    const newPasswordLogin = await login('ABrandNewPassword-456');
    assert.equal(newPasswordLogin.status, 200);

    const reuseResp = await post(baseUrl, '/api/v1/auth/password-reset/confirm', tenantHeaders, {
      token: capturedToken, new_password: 'YetAnotherPassword-789',
    });
    assert.equal(reuseResp.status, 401);
  });

  await t.test('password reset confirm rejects an unknown token and a missing new_password', async () => {
    const unknown = await post(baseUrl, '/api/v1/auth/password-reset/confirm', tenantHeaders, {
      token: 'not-a-real-token', new_password: 'some-password-123',
    });
    assert.equal(unknown.status, 401);

    const missing = await post(baseUrl, '/api/v1/auth/password-reset/confirm', tenantHeaders, {
      token: 'not-a-real-token',
    });
    assert.equal(missing.status, 400);
  });

  // --- Tenant Middleware's JWT-claim resolution — couldn't exist
  // until AuthMiddleware did ---

  await t.test('tenant middleware resolves tenant from JWT claim alone', async () => {
    const resp = await get(baseUrl, '/api/v1/whoami', {
      authorization: bearerFor({ userId: tenant.userId, collegeId: tenant.college.collegeId, role: 'staff' }),
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.college_id, tenant.college.collegeId);
  });

  await t.test('tenant middleware agrees when JWT and subdomain match', async () => {
    const resp = await get(baseUrl, '/api/v1/whoami', {
      host: hostFor(tenant.college.subdomain),
      authorization: bearerFor({ userId: tenant.userId, collegeId: tenant.college.collegeId, role: 'staff' }),
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.college_id, tenant.college.collegeId);
  });

  await t.test('tenant middleware rejects conflicting JWT and subdomain', async () => {
    const otherSuffix = crypto.randomUUID().slice(0, 8);
    const otherCollegeId = `authother${otherSuffix}`;
    const otherSubdomain = `authothertenant${otherSuffix}`;
    await adminPool.query(
      'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
      [otherCollegeId, otherSubdomain],
    );
    try {
      const resp = await get(baseUrl, '/api/v1/whoami', {
        host: hostFor(otherSubdomain),
        authorization: bearerFor({ userId: tenant.userId, collegeId: tenant.college.collegeId, role: 'staff' }),
      });
      assert.equal(resp.status, 400);
    } finally {
      await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [otherCollegeId]);
    }
  });
});
