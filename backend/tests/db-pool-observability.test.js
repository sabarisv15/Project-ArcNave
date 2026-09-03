'use strict';

// ARCNAVE modernization P3 (D1) — connection-pool exhaustion visibility.
// `pg.Pool` (src/db/pool.js) already IS the connection pooler for this
// single-process deployment; the real D1 gap was observability, not a
// missing pooler (see tenantConnection.js's own comment on
// _begin()/db_pool_contention). This file proves both halves of that
// deliverable: the /health pull-based gauge, and the push-based warning
// logged at checkout time when a request queues behind an already-full
// pool.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { appPool } = require('../src/db/pool');
const { TenantConnection } = require('../src/db/tenantConnection');
const createApp = require('../src/app');

// tenantConnection.js destructures `{ logWarn }` from logging/logger.js at
// require time, so mocking the logger module's own exported property
// afterward would never reach that already-captured local binding.
// logWarn itself is a thin `console.warn(JSON.stringify(...))` wrapper
// (logging/logger.js) — mocking console.warn directly and parsing the
// JSON payload is what actually observes every call site, regardless of
// how each file imported logWarn.
function captureWarnLogs(t) {
  const calls = [];
  t.mock.method(console, 'warn', (line) => {
    try {
      calls.push(JSON.parse(line));
    } catch {
      // Not a JSON structured-log line — ignore for this capture's purpose.
    }
  });
  return calls;
}

function get(baseUrl, path) {
  return new Promise((resolve, reject) => {
    http
      .get(`${baseUrl}${path}`, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      })
      .on('error', reject);
  });
}

test('GET /api/v1/health reports live pool gauges (total/idle/waiting), additive to the existing status field', async (t) => {
  const app = createApp();
  const server = app.listen(0);
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const { status, body } = await get(baseUrl, '/api/v1/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok', 'existing field unchanged for every current caller');
  assert.ok(body.pool, 'new additive pool field present');
  assert.equal(typeof body.pool.total, 'number');
  assert.equal(typeof body.pool.idle, 'number');
  assert.equal(typeof body.pool.waiting, 'number');
});

test('TenantConnection.open(): logs db_pool_contention when appPool.waitingCount > 0 at the moment of checkout', async (t) => {
  // appPool.waitingCount is a real getter on the pg.Pool prototype
  // (configurable, no setter) — an own-property override on the live
  // singleton shadows it for the duration of this test only, restored
  // in t.after regardless of pass/fail. Never touches real pool
  // behavior — this proves _begin()'s conditional reads the gauge
  // correctly, not that pg itself queues connections (pg's own test
  // suite already covers that).
  Object.defineProperty(appPool, 'waitingCount', { value: 3, configurable: true });
  t.after(() => {
    delete appPool.waitingCount;
  });

  const calls = captureWarnLogs(t);

  const conn = new TenantConnection(null);
  await conn.open();
  t.after(() => conn.rollback());

  const contentionWarnings = calls.filter((c) => c.message === 'db_pool_contention');
  assert.equal(contentionWarnings.length, 1);
  assert.equal(contentionWarnings[0].pool, 'app');
  assert.equal(contentionWarnings[0].waitingCount, 3);
  assert.equal(typeof contentionWarnings[0].totalCount, 'number');
  assert.equal(typeof contentionWarnings[0].idleCount, 'number');
});

test('TenantConnection.open(): no db_pool_contention warning when appPool.waitingCount is 0 (the normal case)', async (t) => {
  assert.equal(appPool.waitingCount, 0, 'precondition: no contention override active from a prior test');

  const calls = captureWarnLogs(t);

  const conn = new TenantConnection(null);
  await conn.open();
  t.after(() => conn.rollback());

  assert.equal(calls.filter((c) => c.message === 'db_pool_contention').length, 0);
});
