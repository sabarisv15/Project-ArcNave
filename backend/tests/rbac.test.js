'use strict';

// RBAC enforcement tests — requireAuth/requireRole
// (src/middleware/rbac.js) plus the first real protected route,
// GET /api/v1/auth/me. Ported from the deleted Python test_rbac.py
// (git history).
//
// GET /api/v1/auth/me is gated by requireAuth ("any authenticated
// tenant user"), so it can't itself demonstrate role-subset rejection
// — there's no role that's *not* allowed. For that, a test-only
// /restricted route is registered via createApp()'s
// registerExtraRoutes hook (same mechanism
// tests/tenant-middleware.test.js's rollback test uses), restricted
// to a strict subset of roles, exercised through a real HTTP request
// against the real AuthMiddleware + requireRole wiring — not by
// calling the middleware function directly. This mirrors the deleted
// Python version's own approach (a throwaway FastAPI app for exactly
// the same reason: no real role-subset-restricted business route
// exists yet in Module 0 to hang this test on honestly).
//
// A real seeded college + user IS needed now (unlike the fixture-free
// approach the original port used): ADR-024's session revocation
// middleware runs unconditionally on every authenticated request and
// reads the claimed user's token_version straight off `users` — a
// made-up, non-UUID userId like the old 'user-1' fails that query
// outright (invalid UUID), and a syntactically-valid-but-unseeded UUID
// would 401 as "revoked" (no matching row). Only the negative-token
// tests (no token / malformed / expired) stay fixture-free, since they
// never reach that check.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const argon2 = require('argon2');
const { Pool } = require('pg');
const createApp = require('../src/app');
const config = require('../src/config');
const security = require('../src/security');
const { requireRole } = require('../src/middleware/rbac');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;

function requestJson(baseUrl, path, method, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = text;
        }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function get(baseUrl, path, headers) {
  return requestJson(baseUrl, path, 'GET', headers);
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

async function seedCollegeAndUser(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const college = { collegeId: `rbac${suffix}`, subdomain: `rbactenant${suffix}` };
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [college.collegeId, college.subdomain],
  );
  const passwordHash = await argon2.hash('irrelevant-for-this-test');
  const result = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'rbacuser', 'rbacuser@example.com', $2, 'staff', true)
     RETURNING id`,
    [college.collegeId, passwordHash],
  );
  return { collegeId: college.collegeId, userId: result.rows[0].id };
}

async function cleanup(adminPool, collegeId) {
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [collegeId]);
}

function expiredBearer() {
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    { sub: 'user-1', college_id: 'college-1', role: 'staff', type: 'access', iat: now - 3600, exp: now - 60 },
    config.jwtSecretKey,
    { algorithm: config.jwtAlgorithm },
  );
  return `Bearer ${token}`;
}

test('rbac', async (t) => {
  const app = createApp({
    registerTenantExtraRoutes(testApp) {
      // Real HTTP request through the real middleware stack, same
      // reasoning as the Python throwaway app — this route's only
      // purpose is proving requireRole's allowed-set restriction, not
      // a real feature; unlike /me, there's no real business route in
      // Module 0 to hang this on honestly. Relative path — registered
      // on tenantApp, mounted at /api/v1 externally; the actual
      // request below still hits /api/v1/_test_only/restricted.
      testApp.get('/_test_only/restricted', requireRole('hod', 'principal'), (req, res) => {
        res.json({ role: req.jwtClaims.role });
      });
    },
  });

  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const { collegeId, userId } = await seedCollegeAndUser(adminPool);

  function bearerFor({ role }) {
    return `Bearer ${security.createAccessToken({ userId, collegeId, role })}`;
  }

  t.after(async () => {
    await stopServer(server);
    await cleanup(adminPool, collegeId);
    await adminPool.end();
  });

  // --- GET /api/v1/auth/me (requireAuth) ---

  await t.test('me returns 401 without a token', async () => {
    const resp = await get(baseUrl, '/api/v1/auth/me', {});
    assert.equal(resp.status, 401);
  });

  await t.test('me returns 401 with a malformed token', async () => {
    const resp = await get(baseUrl, '/api/v1/auth/me', { authorization: 'Bearer not-a-real-jwt' });
    assert.equal(resp.status, 401);
  });

  await t.test('me returns 401 with an expired token', async () => {
    const resp = await get(baseUrl, '/api/v1/auth/me', { authorization: expiredBearer() });
    assert.equal(resp.status, 401);
  });

  for (const role of ['staff', 'hod', 'principal']) {
    await t.test(`me returns 200 for role ${role}`, async () => {
      const resp = await get(baseUrl, '/api/v1/auth/me', {
        authorization: bearerFor({ role }),
      });
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.body, {
        user_id: userId, college_id: collegeId, role, full_name: null, designation: null, phone: null, address: null,
      });
    });
  }

  // --- requireRole's role-subset restriction ---

  await t.test('requireRole returns 401 without a token', async () => {
    const resp = await get(baseUrl, '/api/v1/_test_only/restricted', {});
    assert.equal(resp.status, 401);
  });

  await t.test('requireRole rejects a role outside the allowed set', async () => {
    const resp = await get(baseUrl, '/api/v1/_test_only/restricted', {
      authorization: bearerFor({ role: 'staff' }),
    });
    assert.equal(resp.status, 403);
  });

  for (const role of ['hod', 'principal']) {
    await t.test(`requireRole allows role ${role} in the allowed set`, async () => {
      const resp = await get(baseUrl, '/api/v1/_test_only/restricted', {
        authorization: bearerFor({ role }),
      });
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.body, { role });
    });
  }
});
