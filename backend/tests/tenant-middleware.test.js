'use strict';

// Integration test for TenantMiddleware — proves tenant resolution and
// set_config()/transaction wiring actually work through a real Express
// request (see tests/rls-tenant-isolation.test.js for the raw-SQL
// guarantee underneath this one). Ported from the deleted Python
// test_tenant_middleware.py (git history) for the two testable sources
// this pass — subdomain and explicit code; the JWT-claim source has no
// equivalent yet, since AuthMiddleware doesn't exist (see
// middleware/tenant.js's TODO(auth)).
//
// Uses Node's built-in http module rather than fetch() specifically
// so the Host header can be set with certainty — http.request's
// `headers` option is honored as the literal request header sent,
// independent of the hostname/port used to open the TCP connection,
// which is exactly what's needed to simulate different tenant
// subdomains against one local server.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const asyncHandler = require('../src/middleware/asyncHandler');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;

function get(baseUrl, path, headers) {
  return requestJson(baseUrl, path, 'GET', headers);
}

function post(baseUrl, path, headers) {
  return requestJson(baseUrl, path, 'POST', headers);
}

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

async function seedTwoColleges(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const tenantA = { collegeId: `tma${suffix}`, subdomain: `tenanta${suffix}` };
  const tenantB = { collegeId: `tmb${suffix}`, subdomain: `tenantb${suffix}` };
  for (const t of [tenantA, tenantB]) {
    await adminPool.query(
      'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
      [t.collegeId, t.subdomain],
    );
  }
  return { tenantA, tenantB };
}

async function cleanupColleges(adminPool, tenantA, tenantB) {
  for (const t of [tenantA, tenantB]) {
    await adminPool.query('DELETE FROM configurations WHERE college_id = $1', [t.collegeId]);
    await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [t.collegeId]);
  }
}

function hostFor(subdomain) {
  return `${subdomain}.arcnave.test`;
}

test('tenant middleware', async (t) => {
  const app = createApp({
    registerTenantExtraRoutes(testApp) {
      // Test-only route, registered before errorHandler is attached
      // (see tenantApp.js's factory docstring for why registration
      // order matters here) — proves the rollback path with a route
      // that does a real partial write to a real tenant table, then
      // throws, on the exact same TenantMiddleware/errorHandler
      // wiring production traffic uses. Relative path — this route is
      // registered on tenantApp, which app.js mounts at /api/v1
      // externally, so the actual HTTP request below still hits
      // /api/v1/_test_only/partial-write-then-throw.
      testApp.post(
        '/_test_only/partial-write-then-throw',
        asyncHandler(async (req) => {
          await req.dbClient.query(
            "INSERT INTO configurations (college_id, category, configuration) " +
              "VALUES (current_setting('app.current_tenant', true), 'rollback_proof', '{}')",
          );
          throw new Error('Intentional failure after a partial write — proving rollback');
        }),
      );
    },
  });

  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const { tenantA, tenantB } = await seedTwoColleges(adminPool);

  t.after(async () => {
    await stopServer(server);
    await cleanupColleges(adminPool, tenantA, tenantB);
    await adminPool.end();
  });

  await t.test('resolves tenant from subdomain', async () => {
    const resp = await get(baseUrl, '/api/v1/whoami', { host: hostFor(tenantA.subdomain) });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.college_id, tenantA.collegeId);
  });

  await t.test('resolves tenant from explicit college code', async () => {
    const resp = await get(baseUrl, '/api/v1/whoami', { 'x-college-code': tenantB.collegeId });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.college_id, tenantB.collegeId);
  });

  await t.test('agrees when subdomain and code match — not a false-positive conflict', async () => {
    const resp = await get(baseUrl, '/api/v1/whoami', {
      host: hostFor(tenantA.subdomain),
      'x-college-code': tenantA.collegeId,
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.college_id, tenantA.collegeId);
  });

  await t.test('rejects conflicting subdomain and code', async () => {
    const resp = await get(baseUrl, '/api/v1/whoami', {
      host: hostFor(tenantA.subdomain),
      'x-college-code': tenantB.collegeId,
    });
    assert.equal(resp.status, 400);
  });

  await t.test('returns 400 when no tenant resolves', async () => {
    const resp = await get(baseUrl, '/api/v1/whoami', {});
    assert.equal(resp.status, 400);
  });

  await t.test('health does not require a tenant', async () => {
    const resp = await get(baseUrl, '/api/v1/health', {});
    assert.equal(resp.status, 200);
  });

  await t.test('sequential requests for alternating tenants never leak', async () => {
    const sequence = [tenantA, tenantB, tenantA, tenantB, tenantB, tenantA];
    for (const tenant of sequence) {
      const resp = await get(baseUrl, '/api/v1/whoami', { host: hostFor(tenant.subdomain) });
      assert.equal(resp.status, 200);
      assert.equal(resp.body.college_id, tenant.collegeId);
    }
  });

  await t.test('a downstream throw rolls back — no partial write is persisted', async () => {
    const resp = await post(baseUrl, '/api/v1/_test_only/partial-write-then-throw', {
      host: hostFor(tenantA.subdomain),
    });
    assert.equal(resp.status, 500);

    const check = await adminPool.query(
      "SELECT 1 FROM configurations WHERE college_id = $1 AND category = 'rollback_proof'",
      [tenantA.collegeId],
    );
    assert.equal(
      check.rowCount,
      0,
      'the INSERT before the throw was persisted — rollback did not actually happen',
    );
  });
});
