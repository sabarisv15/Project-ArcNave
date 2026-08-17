'use strict';

// Tests for request-scoped structured logging: requestContextMiddleware
// + AsyncLocalStorage-based enrichment (src/logging/context.js,
// src/logging/logger.js). Ported from the deleted Python
// test_request_logging.py (git history), plus one new test that
// couldn't exist in the Python version's own test suite in this form:
// a genuine concurrent-requests proof, the direct equivalent of
// test_rls_tenant_isolation.py's pooled-connection leak test applied
// to log context instead of tenant context.
//
// Captures real JSON text emitted via console.log/warn/error by
// temporarily replacing them for the duration of each test, rather
// than mocking the logger module itself — this proves the actual
// string logger.js renders, same reasoning as the deleted Python
// test's _CapturingHandler avoiding pytest's caplog (which would
// bypass the real formatter).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const config = require('../src/config');
const security = require('../src/security');
const asyncHandler = require('../src/middleware/asyncHandler');
const { logInfo } = require('../src/logging/logger');

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
        let parsedBody = null;
        try {
          parsedBody = text ? JSON.parse(text) : null;
        } catch {
          parsedBody = text;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsedBody });
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

// Captures every line written to console.log/warn/error during the
// window between capture() and restore(), parsed as JSON — logger.js
// always emits a single JSON string per call, so a parse failure here
// would itself be a bug worth surfacing, not silently swallowed.
function captureLogLines() {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const lines = [];
  const capture = (text) => lines.push(JSON.parse(text));
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  return {
    lines,
    restore() {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

async function seedTenantWithUser(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const college = { collegeId: `reqlog${suffix}`, subdomain: `reqlogtenant${suffix}` };
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [college.collegeId, college.subdomain],
  );
  const passwordHash = await security.hashPassword(VALID_PASSWORD);
  await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'reqloguser', 'reqloguser@example.com', $2, 'staff', true)`,
    [college.collegeId, passwordHash],
  );
  return college;
}

async function cleanupTenant(adminPool, college) {
  // audit_log.user_id FKs users(id) — must go before the users delete
  // below (task #17's login audit logging).
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('request-scoped structured logging', async (t) => {
  const app = createApp({
    registerTenantExtraRoutes(testApp) {
      // Deliberately delayed so two concurrent requests are
      // genuinely in flight simultaneously, forcing a real yield to
      // the event loop rather than relying on incidental DB-query
      // latency to create interleaving opportunities — a more
      // reliable forcing function than hoping real I/O happens to be
      // slow enough. logInfo here has no `req` in scope at all,
      // matching authService.refresh's real shape. Relative path —
      // registered on tenantApp, mounted at /api/v1 externally; the
      // actual request below still hits /api/v1/_test_only/delayed-log.
      testApp.get('/_test_only/delayed-log', asyncHandler(async (req, res) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        logInfo('delayed_log_test_marker', {});
        res.json({ ok: true });
      }));
    },
  });

  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const tenant = await seedTenantWithUser(adminPool);

  t.after(async () => {
    await stopServer(server);
    await cleanupTenant(adminPool, tenant);
    await adminPool.end();
  });

  await t.test('request_completed log has requestId and omits unresolved collegeId', async () => {
    const capture = captureLogLines();
    const resp = await get(baseUrl, '/api/v1/health', {});
    capture.restore();

    assert.equal(resp.status, 200);
    const lines = capture.lines.filter((l) => l.message === 'request_completed');
    assert.equal(lines.length, 1);
    const line = lines[0];
    assert.ok(line.requestId);
    assert.equal(line.method, 'GET');
    assert.equal(line.path, '/api/v1/health');
    assert.equal(line.status, 200);
    assert.equal(typeof line.durationMs, 'number');
    // /health resolves no tenant — collegeId is omitted entirely, not
    // present as null, same as the deleted Python version's behavior.
    assert.ok(!('collegeId' in line));
  });

  await t.test('request_completed log carries collegeId when resolved', async () => {
    const capture = captureLogLines();
    const resp = await get(baseUrl, '/api/v1/whoami', { host: hostFor(tenant.subdomain) });
    capture.restore();

    assert.equal(resp.status, 200);
    const lines = capture.lines.filter((l) => l.message === 'request_completed');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].collegeId, tenant.collegeId);
    assert.equal(lines[0].status, 200);
  });

  await t.test('request id is generated and echoed on the response', async () => {
    const resp = await get(baseUrl, '/api/v1/health', {});
    assert.equal(resp.status, 200);
    assert.ok(resp.headers['x-request-id']);
  });

  await t.test('an incoming X-Request-ID header is honored', async () => {
    const capture = captureLogLines();
    const resp = await get(baseUrl, '/api/v1/health', { 'x-request-id': 'trace-abc-123' });
    capture.restore();

    assert.equal(resp.headers['x-request-id'], 'trace-abc-123');
    const lines = capture.lines.filter((l) => l.message === 'request_completed');
    assert.equal(lines[0].requestId, 'trace-abc-123');
  });

  await t.test('sequential requests get different request ids', async () => {
    const ids = [];
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const resp = await get(baseUrl, '/api/v1/health', {});
      ids.push(resp.headers['x-request-id']);
    }
    assert.equal(new Set(ids).size, ids.length);
  });

  await t.test('log lines from deep in the stack are enriched automatically', async () => {
    const headers = { host: hostFor(tenant.subdomain) };
    const login = await post(baseUrl, '/api/v1/auth/login', headers, {
      username: 'reqloguser',
      password: VALID_PASSWORD,
    });
    const refreshToken = login.body.refresh_token;

    const capture = captureLogLines();
    const first = await post(baseUrl, '/api/v1/auth/refresh', headers, { refresh_token: refreshToken });
    assert.equal(first.status, 200);
    const second = await post(baseUrl, '/api/v1/auth/refresh', headers, { refresh_token: refreshToken });
    capture.restore();
    assert.equal(second.status, 401);

    // authService.refresh's reuse-detection log has no `req` in
    // scope at all — it only ever receives `client`. If requestId
    // shows up here, AsyncLocalStorage put it there automatically,
    // not an explicit extra at that call site (contrast with
    // collegeId/userId/refreshTokenId there, which ARE explicit
    // fields).
    const reuseLogs = capture.lines.filter((l) => l.message === 'refresh_token_reuse_detected');
    assert.equal(reuseLogs.length, 1);
    assert.ok(reuseLogs[0].requestId);
    assert.equal(reuseLogs[0].collegeId, tenant.collegeId);
  });

  // --- The test that actually matters: concurrent requests, not
  // sequential. Sequential requests could pass even with a broken
  // shared-global implementation if Node happened to serialize them —
  // genuinely concurrent in-flight requests are what would actually
  // catch an AsyncLocalStorage propagation bug, the direct equivalent
  // of test_rls_tenant_isolation.py's pg_backend_pid()-verified
  // pooled-connection proof, applied to log context instead. ---

  await t.test(
    'concurrent requests never leak requestId into each other\'s deeply-nested log calls',
    async () => {
      const capture = captureLogLines();
      const [respA, respB] = await Promise.all([
        get(baseUrl, '/api/v1/_test_only/delayed-log', { 'x-request-id': 'concurrent-test-a' }),
        get(baseUrl, '/api/v1/_test_only/delayed-log', { 'x-request-id': 'concurrent-test-b' }),
      ]);
      capture.restore();

      assert.equal(respA.status, 200);
      assert.equal(respB.status, 200);

      const markers = capture.lines.filter((l) => l.message === 'delayed_log_test_marker');
      assert.equal(markers.length, 2, 'expected exactly one delayed_log_test_marker per request');

      const seenRequestIds = new Set(markers.map((l) => l.requestId));
      assert.deepEqual(
        seenRequestIds,
        new Set(['concurrent-test-a', 'concurrent-test-b']),
        'each concurrent request\'s nested log call must carry its own requestId, not the other request\'s ' +
          '(or a shared/undefined one) — this is what would fail under a broken AsyncLocalStorage implementation',
      );
    },
  );
});
