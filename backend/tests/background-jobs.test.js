'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedPrincipalPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'BackgroundJobsTestPass123!';

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

async function seedTenant(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeId = `bjob${suffix}`;
  const subdomain = `bjobtenant${suffix}`;
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)', [
    collegeId,
    subdomain,
  ]);
  const passwordHash = await security.hashPassword(PASSWORD);
  const userIds = {};
  for (const [username, role] of [
    ['principaluser', 'principal'],
    ['staffuser', 'staff'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const result = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [collegeId, username, `${username}@example.com`, passwordHash, role],
    );
    userIds[username] = result.rows[0].id;
  }
  await seedPrincipalPosition(adminPool, { collegeId, userId: userIds.principaluser, passwordHash });
  return { collegeId, subdomain };
}

async function cleanupTenant(adminPool, college) {
  // audit_log.user_id FKs users(id) — must go before the users delete
  // below (task #17's login audit logging).
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM background_jobs WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('background jobs', async (t) => {
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

  async function login(username) {
    const resp = await requestJson(baseUrl, '/api/v1/auth/login', 'POST', {
      headers: { host: `${college.subdomain}.arcnave.test` },
      body: { username, password: PASSWORD },
    });
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  function headersFor(token) {
    const headers = { host: `${college.subdomain}.arcnave.test` };
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  await t.test('principal starts and checks a background job', async () => {
    const token = await login('principaluser');
    const created = await requestJson(baseUrl, '/api/v1/background-jobs', 'POST', {
      headers: headersFor(token),
      body: { name: 'test_job' },
    });
    assert.equal(created.status, 202);
    assert.equal(created.body.name, 'test_job');
    assert.ok(['queued', 'running', 'completed'].includes(created.body.status));

    let fetched = null;
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      // eslint-disable-next-line no-await-in-loop
      fetched = await requestJson(baseUrl, `/api/v1/background-jobs/${created.body.id}`, 'GET', {
        headers: headersFor(token),
      });
      if (fetched.body.status === 'completed') break;
    }
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.status, 'completed');

    const list = await requestJson(baseUrl, '/api/v1/background-jobs', 'GET', { headers: headersFor(token) });
    assert.equal(list.status, 200);
    assert.ok(list.body.some((job) => job.id === created.body.id));
  });

  await t.test('staff cannot start a background job', async () => {
    const token = await login('staffuser');
    const resp = await requestJson(baseUrl, '/api/v1/background-jobs', 'POST', {
      headers: headersFor(token),
      body: { name: 'blocked' },
    });
    assert.equal(resp.status, 403);
  });

  // P4 (5.4) — live-events stream for job progress, replacing polling.
  await t.test('principal streams a background job to completion via SSE', async () => {
    const token = await login('principaluser');
    const created = await requestJson(baseUrl, '/api/v1/background-jobs', 'POST', {
      headers: headersFor(token),
      body: { name: 'stream_test_job' },
    });
    assert.equal(created.status, 202);

    const events = await new Promise((resolve, reject) => {
      const url = new URL(`/api/v1/background-jobs/${created.body.id}/stream`, baseUrl);
      const req = http.request(url, { method: 'GET', headers: headersFor(token) }, (res) => {
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['content-type'], 'text/event-stream');
        let buffer = '';
        const collected = [];
        res.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          const parts = buffer.split('\n\n');
          buffer = parts.pop();
          for (const part of parts) {
            const eventLine = part.split('\n').find((l) => l.startsWith('event: '));
            const dataLine = part.split('\n').find((l) => l.startsWith('data: '));
            if (eventLine && dataLine) {
              collected.push({
                event: eventLine.slice('event: '.length),
                data: JSON.parse(dataLine.slice('data: '.length)),
              });
            }
          }
        });
        res.on('end', () => resolve(collected));
      });
      req.on('error', reject);
      req.end();
    });

    assert.ok(events.length > 0, 'expected at least one SSE event');
    const doneEvent = events.find((e) => e.event === 'done');
    assert.ok(doneEvent, 'expected a done event once the job reached a terminal status');
    assert.equal(doneEvent.data.status, 'completed');
    assert.equal(doneEvent.data.id, created.body.id);
    // Every emitted 'job' event should be the real, current job shape —
    // same fields the plain GET /background-jobs/:id route returns.
    for (const e of events.filter((ev) => ev.event === 'job')) {
      assert.equal(e.data.id, created.body.id);
    }
  });
});
