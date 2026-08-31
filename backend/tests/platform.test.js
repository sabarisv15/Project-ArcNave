'use strict';

// Integration tests for the Super Admin Portal API (platform auth +
// college creation), and — the part that actually matters for
// ADR-010 — proof that the platform app is genuinely isolated from
// the tenant request path, not just conventionally separate. Ported
// from the deleted Python test_platform.py (git history).
//
// Four kinds of test here:
// 1. Platform auth / college creation work as plain features.
// 2. Cross-boundary: a platform token must never work against a
//    tenant requireAuth-gated route, and vice versa.
// 3. The isolation claim itself: authMiddleware/tenantMiddleware must
//    never run for a /api/v1/platform/* request. Proven against the
//    real mounted structure (app.js's createApp()), not a
//    reconstructed one — same "prove it" discipline as
//    test_rls_tenant_isolation.py's pg_backend_pid() check and
//    request-logging.test.js's concurrent-requests check.
//
//    This is the direct Node equivalent of the test that caught a
//    real bug in the deleted Python version once already: its first
//    attempt mounted platform routes as a sub-app under a single
//    top-level app carrying TenantMiddleware/AuthMiddleware directly,
//    and this exact style of test caught request.state.college_id/
//    jwt_claims leaking onto platform-mounted requests before the fix
//    (tenant_app/platform_app split into genuine peers). Express's
//    app.use(prefix, subApp) was not assumed to be automatically as
//    isolated as Starlette's Mount was wrongly assumed to be — this
//    test is what actually establishes it, not app.js's comments.
// 4. No refresh token for platform admins — checked against the
//    deleted Python version rather than assumed, since Module 0's
//    original scope explicitly did not build refresh rotation for
//    platform admins (Known Limitations).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const config = require('../src/config');
const security = require('../src/security');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PLATFORM_PASSWORD = 'PlatformPass123!';
const TENANT_PASSWORD = 'TenantPass123!';

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

function patch(baseUrl, path, headers, body) {
  return requestJson(baseUrl, path, 'PATCH', { headers, body });
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

test('platform API', async (t) => {
  // Isolation probe registered via registerPlatformExtraRoutes — the
  // actual mechanism app.js's createApp() exposes for inserting a
  // route into the real platformApp instance it mounts, not a
  // throwaway copy. Proving something about what's really mounted at
  // /api/v1/platform requires inspecting that exact instance; a
  // fresh, unrelated express() app (as rbac.test.js's subset-rejection
  // test uses, deliberately, for a different reason) wouldn't prove
  // anything about it.
  const app = createApp({
    registerPlatformExtraRoutes(platformApp) {
      // req.jwtClaims/req.collegeId/req.dbClient are set *only* by
      // authMiddleware/tenantMiddleware respectively, nowhere else in
      // this codebase (grep confirms it). Their total absence on a
      // request that reached this route is conclusive: those
      // middlewares never ran for it.
      platformApp.get('/_test_only/state_probe', (req, res) => {
        res.json({
          hasJwtClaims: 'jwtClaims' in req,
          hasCollegeId: 'collegeId' in req,
          hasDbClient: 'dbClient' in req,
        });
      });
    },
  });

  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });

  const createdColleges = [];
  const collegeIdFactory = () => {
    const cid = `platest${crypto.randomUUID().slice(0, 8)}`;
    createdColleges.push(cid);
    return cid;
  };

  const suffix = crypto.randomUUID().slice(0, 8);
  const adminUsername = `platformadmin${suffix}`;
  const adminResult = await adminPool.query(
    `INSERT INTO platform_admins (username, email, password_hash)
     VALUES ($1, $2, $3) RETURNING id`,
    [adminUsername, `${adminUsername}@example.com`, await security.hashPassword(PLATFORM_PASSWORD)],
  );
  const adminId = adminResult.rows[0].id;

  const tenantSuffix = crypto.randomUUID().slice(0, 8);
  const tenantCollege = { collegeId: `pbound${tenantSuffix}`, subdomain: `pboundtenant${tenantSuffix}` };
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)', [
    tenantCollege.collegeId,
    tenantCollege.subdomain,
  ]);
  await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'pbounduser', 'pbounduser@example.com', $2, 'staff', true)`,
    [tenantCollege.collegeId, await security.hashPassword(TENANT_PASSWORD)],
  );

  t.after(async () => {
    await stopServer(server);
    for (const cid of createdColleges) {
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [cid]);
    }
    await adminPool.query('DELETE FROM colleges WHERE created_by = $1', [adminId]);
    // platform_audit_log.actor_admin_id FKs platform_admins(id) — same
    // "clean up the dependent audit row before the actor" discipline
    // as audit_log.user_id below, just for the platform-side table
    // (Platform Admin module build, Phase C).
    await adminPool.query('DELETE FROM platform_audit_log WHERE actor_admin_id = $1', [adminId]);
    await adminPool.query('DELETE FROM platform_admins WHERE id = $1', [adminId]);
    // audit_log.user_id FKs users(id) — must go before the users
    // delete below (task #17's login audit logging writes a row here
    // on every tenant login this file performs).
    await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [tenantCollege.collegeId]);
    await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [tenantCollege.collegeId]);
    await adminPool.query('DELETE FROM users WHERE college_id = $1', [tenantCollege.collegeId]);
    await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [tenantCollege.collegeId]);
    await adminPool.end();
  });

  async function platformLogin(password = PLATFORM_PASSWORD, username = adminUsername) {
    return post(baseUrl, '/api/v1/platform/auth/login', {}, { username, password });
  }

  // --- Platform login ---

  await t.test('platform login succeeds', async () => {
    const resp = await platformLogin();
    assert.equal(resp.status, 200);
    assert.ok(resp.body.access_token);
    assert.equal(resp.body.token_type, 'bearer');
    // No refresh token for platform admins this pass — checked
    // against the deleted Python version, not assumed: it didn't
    // build this either. See Module-00-Platform.md Known Limitations.
    assert.ok(!('refresh_token' in resp.body));
  });

  await t.test('platform login rejects wrong password', async () => {
    const resp = await platformLogin('wrong password');
    assert.equal(resp.status, 401);
  });

  await t.test('platform login rejects unknown username', async () => {
    const resp = await platformLogin(PLATFORM_PASSWORD, 'no-such-admin');
    assert.equal(resp.status, 401);
  });

  // --- College creation ---

  async function platformToken() {
    const resp = await platformLogin();
    return resp.body.access_token;
  }

  await t.test('create college succeeds', async () => {
    const token = await platformToken();
    const collegeId = collegeIdFactory();
    const resp = await post(
      baseUrl,
      '/api/v1/platform/colleges',
      { authorization: `Bearer ${token}` },
      { college_id: collegeId, name: 'Test College', subdomain: collegeId },
    );
    assert.equal(resp.status, 201);
    assert.equal(resp.body.college_id, collegeId);
    assert.equal(resp.body.subscription_status, 'trial');
  });

  await t.test('create college rejects duplicate college_id', async () => {
    const token = await platformToken();
    const collegeId = collegeIdFactory();
    const first = await post(
      baseUrl,
      '/api/v1/platform/colleges',
      { authorization: `Bearer ${token}` },
      { college_id: collegeId, name: 'Test College', subdomain: collegeId },
    );
    assert.equal(first.status, 201);

    const second = await post(
      baseUrl,
      '/api/v1/platform/colleges',
      { authorization: `Bearer ${token}` },
      { college_id: collegeId, name: 'Different Name', subdomain: `${collegeId}-different` },
    );
    assert.equal(second.status, 409);
  });

  await t.test('create college rejects duplicate subdomain', async () => {
    const token = await platformToken();
    const collegeId = collegeIdFactory();
    const otherCollegeId = collegeIdFactory();
    const first = await post(
      baseUrl,
      '/api/v1/platform/colleges',
      { authorization: `Bearer ${token}` },
      { college_id: collegeId, name: 'Test College', subdomain: collegeId },
    );
    assert.equal(first.status, 201);

    const second = await post(
      baseUrl,
      '/api/v1/platform/colleges',
      { authorization: `Bearer ${token}` },
      { college_id: otherCollegeId, name: 'Other College', subdomain: collegeId },
    );
    assert.equal(second.status, 409);
  });

  await t.test('create college accepts license/level3 title/storage tier', async () => {
    const token = await platformToken();
    const collegeId = collegeIdFactory();
    const resp = await post(
      baseUrl,
      '/api/v1/platform/colleges',
      { authorization: `Bearer ${token}` },
      {
        college_id: collegeId,
        name: 'Test College',
        subdomain: collegeId,
        subscription_status: 'full',
        level3_position_title: 'Head of Section',
        storage_tier: '5 GB',
      },
    );
    assert.equal(resp.status, 201);
    assert.equal(resp.body.subscription_status, 'full');
    assert.equal(resp.body.level3_position_title, 'Head of Section');
    assert.equal(resp.body.storage_tier, '5 GB');
    assert.equal(resp.body.invitation, null, 'no principal_email was sent, so no invitation should fire');
  });

  await t.test('create college rejects an invalid license', async () => {
    const token = await platformToken();
    const collegeId = collegeIdFactory();
    const resp = await post(
      baseUrl,
      '/api/v1/platform/colleges',
      { authorization: `Bearer ${token}` },
      {
        college_id: collegeId,
        name: 'Test College',
        subdomain: collegeId,
        subscription_status: 'premium',
      },
    );
    assert.equal(resp.status, 400);
  });

  // Stage 8a / D13 / RS-GOV-013: name/level1_position_title/
  // level3_position_title/storage_tier are no longer editable through
  // this platform-admin route — only license remains. Moved to
  // collegeProfile.test.js (tenant-side, principal-only) for the
  // fields that now live there.
  await t.test('PATCH college updates license only, ignoring name/title/storage-tier fields', async () => {
    const token = await platformToken();
    const collegeId = collegeIdFactory();
    const created = await post(
      baseUrl,
      '/api/v1/platform/colleges',
      { authorization: `Bearer ${token}` },
      {
        college_id: collegeId,
        name: 'Before Edit',
        subdomain: collegeId,
        level1_position_title: 'Director',
      },
    );
    assert.equal(created.status, 201);

    const resp = await patch(
      baseUrl,
      `/api/v1/platform/colleges/${collegeId}`,
      { authorization: `Bearer ${token}` },
      { name: 'After Edit', subscription_status: 'full', storage_tier: '20 GB' },
    );
    assert.equal(resp.status, 200);
    assert.equal(resp.body.name, 'Before Edit', 'name is no longer editable through this route');
    assert.equal(resp.body.subscription_status, 'full');
    assert.equal(resp.body.storage_tier, null, 'storage_tier is no longer set by this route');
    assert.equal(
      resp.body.level1_position_title,
      'Director',
      'a field not included in the PATCH body must be untouched',
    );
  });

  await t.test('PATCH college rejects an invalid license', async () => {
    const token = await platformToken();
    const collegeId = collegeIdFactory();
    const created = await post(
      baseUrl,
      '/api/v1/platform/colleges',
      { authorization: `Bearer ${token}` },
      { college_id: collegeId, name: 'Test College', subdomain: collegeId },
    );
    assert.equal(created.status, 201);

    const resp = await patch(
      baseUrl,
      `/api/v1/platform/colleges/${collegeId}`,
      { authorization: `Bearer ${token}` },
      { subscription_status: 'premium' },
    );
    assert.equal(resp.status, 400);
  });

  await t.test('PATCH college 404s for an unknown college_id', async () => {
    const token = await platformToken();
    const resp = await patch(
      baseUrl,
      '/api/v1/platform/colleges/does-not-exist',
      { authorization: `Bearer ${token}` },
      { name: 'Whatever' },
    );
    assert.equal(resp.status, 404);
  });

  await t.test('create college requires a platform admin token', async () => {
    const collegeId = collegeIdFactory();
    const resp = await post(
      baseUrl,
      '/api/v1/platform/colleges',
      {},
      { college_id: collegeId, name: 'Test College', subdomain: collegeId },
    );
    assert.equal(resp.status, 401);
  });

  // --- Cross-boundary token rejection ---

  await t.test('a platform token is rejected by a tenant requireAuth-gated route', async () => {
    const token = await platformToken();
    const resp = await get(baseUrl, '/api/v1/auth/me', { authorization: `Bearer ${token}` });
    assert.equal(resp.status, 401);
  });

  await t.test('a tenant token is rejected by requirePlatformAdmin', async () => {
    const loginResp = await post(
      baseUrl,
      '/api/v1/auth/login',
      { host: hostFor(tenantCollege.subdomain) },
      { username: 'pbounduser', password: TENANT_PASSWORD },
    );
    assert.equal(loginResp.status, 200);
    const tenantAccessToken = loginResp.body.access_token;

    const collegeId = collegeIdFactory();
    const resp = await post(
      baseUrl,
      '/api/v1/platform/colleges',
      { authorization: `Bearer ${tenantAccessToken}` },
      { college_id: collegeId, name: 'Should Not Be Created', subdomain: collegeId },
    );
    assert.equal(resp.status, 401);
  });

  // --- Isolation proof ---

  await t.test('platform routes never see authMiddleware/tenantMiddleware state', async () => {
    const resp = await get(baseUrl, '/api/v1/platform/_test_only/state_probe', {});
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.body, { hasJwtClaims: false, hasCollegeId: false, hasDbClient: false });
  });
});
