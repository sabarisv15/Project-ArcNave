'use strict';

// Regression test for the P0 finding from the pre-launch audit: no
// rate limiting existed on /auth/login, making it a straightforward
// brute-force/credential-stuffing target. Proves the real behavior
// end-to-end (real HTTP server, real app), not just that
// express-rate-limit is imported. See middleware/rateLimit.js for the
// mechanism and routes/auth.js for the wiring + the 50-per-window
// limit's own reasoning (measured against this test suite's real
// login volume elsewhere, not guessed).

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
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
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

async function seedTenantWithUsers(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const college = { collegeId: `rl${suffix}`, subdomain: `ratelimit${suffix}` };
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [college.collegeId, college.subdomain],
  );
  const passwordHash = await argon2.hash(VALID_PASSWORD);
  await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'ratelimituser', 'ratelimituser@example.com', $2, 'staff', true),
            ($1, 'otheruser', 'otheruser@example.com', $2, 'staff', true)`,
    [college.collegeId, passwordHash],
  );
  return { college };
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('auth rate limiting', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const tenant = await seedTenantWithUsers(adminPool);

  t.after(async () => {
    await stopServer(server);
    await cleanupTenant(adminPool, tenant.college);
    await adminPool.end();
  });

  const tenantHeaders = { host: `${tenant.college.subdomain}.arcnave.test` };

  function login(username, password = 'wrong password') {
    return post(baseUrl, '/api/v1/auth/login', tenantHeaders, { username, password });
  }

  await t.test('repeated failed logins for one identifier eventually get 429, not 401', async () => {
    let sawRateLimited = false;
    let lastStatus = null;
    // The configured limit is 50 per 15-minute window (routes/auth.js) —
    // fire past it. Every prior response up to that point must still be
    // the real 401 (wrong password), never silently swallowed.
    for (let i = 0; i < 55; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const resp = await login('ratelimituser');
      lastStatus = resp.status;
      if (resp.status === 429) {
        sawRateLimited = true;
        assert.equal(resp.body.detail, 'Too many attempts. Please try again later.');
        break;
      }
      assert.equal(resp.status, 401, `expected 401 (wrong password) before the limit trips, got ${resp.status} on attempt ${i}`);
    }
    assert.ok(sawRateLimited, `expected a 429 within 55 attempts against one identifier, last status was ${lastStatus}`);
  });

  await t.test('a different identifier from the same client is not affected by the first one being rate-limited', async () => {
    const resp = await login('otheruser');
    // Wrong password, but the identifier itself is not rate-limited —
    // proves the key is IP+identifier, not IP alone, which would have
    // collectively locked out every user behind this same test client.
    assert.equal(resp.status, 401);
  });

  await t.test('the correct password still works for the non-rate-limited identifier', async () => {
    const resp = await login('otheruser', VALID_PASSWORD);
    assert.equal(resp.status, 200);
    assert.ok(resp.body.access_token);
  });
});
