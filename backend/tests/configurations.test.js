'use strict';

// Integration tests for ConfigurationService — ported from the
// deleted Python test_configuration.py (git history), same discipline:
// prove the real behavior through real HTTP requests against a live
// Postgres, not assumed from reading the service code.
//
// What was checked against the Python version before writing any of
// this (see configurationService.js's module comment for the full
// reasoning): an unset category 404s, never a default; the version
// column implements genuine optimistic concurrency, never a blind
// increment; writes are gated to `principal` only, a hardcoded
// conservative default the Python version's own comment already
// flagged as unresolved, ported as-is rather than silently resolved.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedPrincipalPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'ConfigTestPass123!';

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
  const college = { collegeId: `cfg${label}${suffix}`, subdomain: `cfgtenant${label}${suffix}` };
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [college.collegeId, college.subdomain],
  );
  const passwordHash = await security.hashPassword(PASSWORD);
  const userIds = {};
  for (const role of ['principal', 'staff']) {
    // eslint-disable-next-line no-await-in-loop
    const result = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [college.collegeId, `${role}user`, `${role}user@example.com`, passwordHash, role],
    );
    userIds[role] = result.rows[0].id;
  }
  await seedPrincipalPosition(adminPool, { collegeId: college.collegeId, userId: userIds.principal, passwordHash });
  return college;
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM configurations WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('configurations', async (t) => {
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
    const resp = await requestJson(
      baseUrl,
      '/api/v1/auth/login',
      'POST',
      { headers: { host: hostFor(college.subdomain) }, body: { username, password: PASSWORD } },
    );
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  function headersFor(college, token) {
    const headers = { host: hostFor(college.subdomain) };
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  // --- Basic mechanics ---

  await t.test('get on an unset category returns 404', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await get(baseUrl, '/api/v1/configurations/attendance_rules', headersFor(collegeA, token));
    assert.equal(resp.status, 404);
  });

  await t.test('set creates a category at version 1', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await put(
      baseUrl,
      '/api/v1/configurations/attendance_rules',
      headersFor(collegeA, token),
      { configuration: { grace_minutes: 10 }, expected_version: null },
    );
    assert.equal(resp.status, 200);
    assert.equal(resp.body.version, 1);
    assert.deepEqual(resp.body.configuration, { grace_minutes: 10 });

    const getResp = await get(baseUrl, '/api/v1/configurations/attendance_rules', headersFor(collegeA, token));
    assert.equal(getResp.status, 200);
    assert.deepEqual(getResp.body.configuration, { grace_minutes: 10 });
  });

  await t.test('set on an existing category updates and increments version', async () => {
    const token = await login(collegeA, 'principaluser');
    const headers = headersFor(collegeA, token);

    const v1 = await put(baseUrl, '/api/v1/configurations/smtp', headers, {
      configuration: { host: 'a' }, expected_version: null,
    });
    assert.equal(v1.body.version, 1);

    const v2 = await put(baseUrl, '/api/v1/configurations/smtp', headers, {
      configuration: { host: 'b' }, expected_version: 1,
    });
    assert.equal(v2.status, 200);
    assert.equal(v2.body.version, 2);
    assert.deepEqual(v2.body.configuration, { host: 'b' });

    const v3 = await put(baseUrl, '/api/v1/configurations/smtp', headers, {
      configuration: { host: 'c' }, expected_version: 2,
    });
    assert.equal(v3.body.version, 3);
  });

  await t.test('a stale expected_version is rejected with a real stale value', async () => {
    const token = await login(collegeA, 'principaluser');
    const headers = headersFor(collegeA, token);

    const created = await put(baseUrl, '/api/v1/configurations/fee_structure', headers, {
      configuration: { a: 1 }, expected_version: null,
    });
    assert.equal(created.body.version, 1);

    // Advance it for real, so "1" below is a genuinely stale value —
    // not just an arbitrary wrong number that happens to also be
    // rejected for a different reason.
    const advanced = await put(baseUrl, '/api/v1/configurations/fee_structure', headers, {
      configuration: { a: 2 }, expected_version: 1,
    });
    assert.equal(advanced.body.version, 2);

    const stale = await put(baseUrl, '/api/v1/configurations/fee_structure', headers, {
      configuration: { a: 3 }, expected_version: 1,
    });
    assert.equal(stale.status, 409);

    // And confirm the stale write was genuinely rejected, not applied
    // — the stored value must still be the one from the "advanced"
    // write, not "a: 3".
    const current = await get(baseUrl, '/api/v1/configurations/fee_structure', headers);
    assert.deepEqual(current.body.configuration, { a: 2 });
    assert.equal(current.body.version, 2);
  });

  await t.test('a non-null expected_version against a nonexistent category is rejected', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await put(baseUrl, '/api/v1/configurations/brand_new_category', headersFor(collegeA, token), {
      configuration: { a: 1 }, expected_version: 1,
    });
    assert.equal(resp.status, 409);
  });

  // --- RBAC ---

  await t.test('write is rejected for a non-principal role', async () => {
    const token = await login(collegeA, 'staffuser');
    const resp = await put(baseUrl, '/api/v1/configurations/approval_policies', headersFor(collegeA, token), {
      configuration: { x: 1 }, expected_version: null,
    });
    assert.equal(resp.status, 403);
  });

  await t.test('write requires authentication', async () => {
    const resp = await put(baseUrl, '/api/v1/configurations/approval_policies', headersFor(collegeA), {
      configuration: { x: 1 }, expected_version: null,
    });
    assert.equal(resp.status, 401);
  });

  await t.test('read is allowed for staff, not just principal', async () => {
    const principalToken = await login(collegeA, 'principaluser');
    await put(baseUrl, '/api/v1/configurations/templates', headersFor(collegeA, principalToken), {
      configuration: { x: 1 }, expected_version: null,
    });

    const staffToken = await login(collegeA, 'staffuser');
    const resp = await get(baseUrl, '/api/v1/configurations/templates', headersFor(collegeA, staffToken));
    assert.equal(resp.status, 200);
  });

  await t.test('read requires authentication', async () => {
    const resp = await get(baseUrl, '/api/v1/configurations/templates', headersFor(collegeA));
    assert.equal(resp.status, 401);
  });

  // --- Cross-tenant isolation ---

  await t.test(
    'two tenants hold independent configuration under the same category name — proves the route is genuinely tenant-scoped',
    async () => {
      const tokenA = await login(collegeA, 'principaluser');
      const tokenB = await login(collegeB, 'principaluser');

      const putA = await put(
        baseUrl,
        '/api/v1/configurations/shared_category_name',
        headersFor(collegeA, tokenA),
        { configuration: { tenant: 'A' }, expected_version: null },
      );
      const putB = await put(
        baseUrl,
        '/api/v1/configurations/shared_category_name',
        headersFor(collegeB, tokenB),
        { configuration: { tenant: 'B' }, expected_version: null },
      );
      assert.equal(putA.status, 200);
      assert.equal(putB.status, 200);
      // Both created independently at version 1 — if tenant B's write
      // had collided with tenant A's row (e.g. the route accidentally
      // used some connection other than req.dbClient, bypassing RLS's
      // tenant scoping), this would be a 409 or version 2, not two
      // independent version-1 creates.
      assert.equal(putA.body.version, 1);
      assert.equal(putB.body.version, 1);

      const getA = await get(baseUrl, '/api/v1/configurations/shared_category_name', headersFor(collegeA, tokenA));
      const getB = await get(baseUrl, '/api/v1/configurations/shared_category_name', headersFor(collegeB, tokenB));
      assert.deepEqual(getA.body.configuration, { tenant: 'A' });
      assert.deepEqual(getB.body.configuration, { tenant: 'B' });
    },
  );

  await t.test('a write creates exactly one audit_log row with the right metadata', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await put(baseUrl, '/api/v1/configurations/branding', headersFor(collegeA, token), {
      configuration: { color: 'blue' }, expected_version: null,
    });
    assert.equal(resp.status, 200);

    const row = await adminPool.query(
      `SELECT action, entity, entity_id, metadata FROM audit_log
       WHERE college_id = $1 AND entity_id = 'branding'`,
      [collegeA.collegeId],
    );
    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0].action, 'configuration_updated');
    assert.equal(row.rows[0].entity, 'configurations');
    assert.equal(row.rows[0].metadata.old_version, null);
    assert.equal(row.rows[0].metadata.new_version, 1);
  });

  // --- Stage 8a / RS-GOV-013: 'storage' category, the one category
  // this route actually validates (assertValidStorageConfiguration) ---

  await t.test('storage category is principal-only to read, matching the other sensitive categories', async () => {
    const token = await login(collegeA, 'staffuser');
    const resp = await get(baseUrl, '/api/v1/configurations/storage', headersFor(collegeA, token));
    assert.equal(resp.status, 403);
  });

  await t.test('storage category rejects an unregistered provider name with 400, not persisted', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await put(baseUrl, '/api/v1/configurations/storage', headersFor(collegeA, token), {
      configuration: { provider: 'not_a_real_provider' }, expected_version: null,
    });
    assert.equal(resp.status, 400);

    const getResp = await get(baseUrl, '/api/v1/configurations/storage', headersFor(collegeA, token));
    assert.equal(getResp.status, 404, 'the rejected write must not have created the category');
  });

  await t.test('storage category accepts the real local_disk provider', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await put(baseUrl, '/api/v1/configurations/storage', headersFor(collegeA, token), {
      configuration: { provider: 'local_disk' }, expected_version: null,
    });
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.body.configuration, { provider: 'local_disk' });
  });
});
