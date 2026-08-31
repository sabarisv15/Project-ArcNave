'use strict';

// Integration tests for the notification ledger's human-facing REST
// routes (/api/v1/notifications) — Module 8, second slice. Real HTTP
// against a live Postgres, same discipline as reports.test.js/
// attendance.test.js. draftNotification/submitForApproval were only
// reachable via AI tools before this slice (see ai.test.js's own
// "full flagship lifecycle" test, which proves the identical service
// methods through aiToolRegistry.js instead) — this file proves the
// same methods are reachable through a plain REST route for a human
// who isn't going through the AI Agent at all. Approve/reject/dispatch
// deliberately stay untested here: they're unchanged, already proven
// by ai.test.js and workflow-requests tests, and this slice added no
// new logic to them.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedPrincipalPosition, seedHodPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'NotificationsApiTestPass123!';

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

// Same shape ai.test.js's own seedTenant uses — submitForApproval now
// resolves its approver via workflowChainService.resolveApproverChain
// (entityType 'notification'), whose 'principal' step resolves through
// identityService.resolvePositionOccupant (Position/Account/Occupant
// model), hence seedPrincipalPosition below. The `staff` row is kept
// too since other Notifications API assertions independently expect a
// real staff record for this user.
async function seedTenant(adminPool, label) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const college = { collegeId: `notifapi${label}${suffix}`, subdomain: `notifapitenant${label}${suffix}` };
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)', [
    college.collegeId,
    college.subdomain,
  ]);
  const passwordHash = await security.hashPassword(PASSWORD);
  const userIds = {};
  for (const [username, role] of [
    ['principaluser', 'principal'],
    ['hoduser', 'hod'],
    ['staffuser', 'staff'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const result = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [college.collegeId, username, `${username}@example.com`, passwordHash, role],
    );
    userIds[username] = result.rows[0].id;
  }
  await adminPool.query(`INSERT INTO staff (college_id, user_id, full_name) VALUES ($1, $2, 'Test Principal')`, [
    college.collegeId,
    userIds.principaluser,
  ]);
  await seedPrincipalPosition(adminPool, { collegeId: college.collegeId, userId: userIds.principaluser, passwordHash });
  const dept = await adminPool.query('INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id', [
    college.collegeId,
    `Notifications API Dept ${suffix}`,
  ]);
  await seedHodPosition(adminPool, {
    collegeId: college.collegeId,
    userId: userIds.hoduser,
    departmentId: dept.rows[0].id,
    passwordHash,
  });

  return { ...college, userIds };
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM notification_delivery WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM notifications WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM approval_history WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM workflow_requests WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM departments WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('notifications API', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const college = await seedTenant(adminPool, 'a');

  t.after(async () => {
    await stopServer(server);
    await cleanupTenant(adminPool, college);
    await adminPool.end();
  });

  async function login(username) {
    const resp = await post(
      baseUrl,
      '/api/v1/auth/login',
      { host: hostFor(college.subdomain) },
      { username, password: PASSWORD },
    );
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  function headersFor(token) {
    const headers = { host: hostFor(college.subdomain) };
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  await t.test('draft requires authentication', async () => {
    const resp = await post(baseUrl, '/api/v1/notifications', headersFor(null), {
      channel: 'email',
      to_address: 'x@example.com',
      body: 'hi',
    });
    assert.equal(resp.status, 401);
  });

  await t.test('staff (not principal/hod) cannot draft: 403', async () => {
    const token = await login('staffuser');
    const resp = await post(baseUrl, '/api/v1/notifications', headersFor(token), {
      channel: 'email',
      to_address: 'x@example.com',
      body: 'hi',
    });
    assert.equal(resp.status, 403);
  });

  await t.test('draft rejects a missing body field with 400, not a 500', async () => {
    const token = await login('hoduser');
    const resp = await post(baseUrl, '/api/v1/notifications', headersFor(token), {
      channel: 'email',
      to_address: 'x@example.com',
    });
    assert.equal(resp.status, 400);
  });

  let notificationId;

  await t.test('hod can draft a notification: 201, status Draft', async () => {
    const token = await login('hoduser');
    const resp = await post(baseUrl, '/api/v1/notifications', headersFor(token), {
      channel: 'email',
      to_address: 'parent@example.com',
      subject: 'Fee reminder',
      body: 'Please pay the pending fee.',
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.status, 'Draft');
    assert.equal(resp.body.channel, 'email');
    assert.equal(resp.body.college_id, college.collegeId);
    notificationId = resp.body.id;
  });

  await t.test('the drafted notification appears in the list: 200', async () => {
    const token = await login('principaluser');
    const resp = await get(baseUrl, '/api/v1/notifications', headersFor(token));
    assert.equal(resp.status, 200);
    assert.ok(Array.isArray(resp.body));
    assert.ok(resp.body.some((n) => n.id === notificationId));
  });

  await t.test('list requires authentication', async () => {
    const resp = await get(baseUrl, '/api/v1/notifications', headersFor(null));
    assert.equal(resp.status, 401);
  });

  await t.test('submit on an unknown id returns 404, not a 500', async () => {
    const token = await login('hoduser');
    const resp = await post(baseUrl, `/api/v1/notifications/${crypto.randomUUID()}/submit`, headersFor(token), {});
    assert.equal(resp.status, 404);
  });

  await t.test('hod submits the draft for approval: 200, real workflow_request_id stored', async () => {
    const token = await login('hoduser');
    const resp = await post(baseUrl, `/api/v1/notifications/${notificationId}/submit`, headersFor(token), {});
    assert.equal(resp.status, 200);
    assert.ok(resp.body.workflow_request_id, 'submitForApproval must store a real workflow_request_id');
  });

  await t.test('the resolved Principal approves via the existing generic workflow route: dispatched', async () => {
    const listResp = await get(baseUrl, '/api/v1/notifications', headersFor(await login('principaluser')));
    const notification = listResp.body.find((n) => n.id === notificationId);

    const principalToken = await login('principaluser');
    const approveResp = await post(
      baseUrl,
      `/api/v1/workflow-requests/${notification.workflow_request_id}/approve`,
      headersFor(principalToken),
      {},
    );
    assert.equal(approveResp.status, 200);
    assert.equal(approveResp.body.notification.status, 'Dispatched');
  });
});
