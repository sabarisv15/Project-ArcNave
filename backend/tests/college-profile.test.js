'use strict';

// Integration tests for /api/v1/college-profile — real HTTP requests
// against a live Postgres. Stage 8a / D13 / RS-GOV-013: name,
// level1_position_title and level3_position_title joined this route's
// editable fields (moved off the platform-admin side) — this proves
// the real column-level GRANT
// (1759200000000_college-profile-tenant-editable-identity-fields.js)
// actually lets `arcnave_app` write them, not just that the JS-level
// allow-list accepts the keys. Also proves principal-only RBAC and the
// blank-name guard.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedPrincipalPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'CollegeProfileApiTestPass123!';

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
        resolve({ status: res.statusCode, body: parsedBody, rawText: text });
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
  const collegeId = `cpapi${label}${suffix}`;
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)', [
    collegeId,
    `cpapitenant${label}${suffix}`,
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
  return { collegeId, subdomain: `cpapitenant${label}${suffix}`, userIds };
}

async function cleanupTenant(adminPool, tenant) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [tenant.collegeId]);
  await cleanupPositionRows(adminPool, tenant.collegeId);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [tenant.collegeId]);
}

test('college-profile API', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const collegeA = await seedTenant(adminPool, 'a');

  t.after(async () => {
    await stopServer(server);
    await cleanupTenant(adminPool, collegeA);
    await adminPool.end();
  });

  async function login(college, username) {
    const resp = await requestJson(baseUrl, '/api/v1/auth/login', 'POST', {
      headers: { host: hostFor(college.subdomain) },
      body: { username, password: PASSWORD },
    });
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  function headersFor(college, token) {
    const headers = { host: hostFor(college.subdomain) };
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  await t.test('unauthenticated GET/PUT are rejected with 401', async () => {
    const getResp = await get(baseUrl, '/api/v1/college-profile', headersFor(collegeA));
    assert.equal(getResp.status, 401);
    const putResp = await put(baseUrl, '/api/v1/college-profile', headersFor(collegeA), { name: 'X' });
    assert.equal(putResp.status, 401);
  });

  await t.test('staff (not principal) is rejected with 403 on both GET and PUT', async () => {
    const token = await login(collegeA, 'staffuser');
    const getResp = await get(baseUrl, '/api/v1/college-profile', headersFor(collegeA, token));
    assert.equal(getResp.status, 403);
    const putResp = await put(baseUrl, '/api/v1/college-profile', headersFor(collegeA, token), { name: 'X' });
    assert.equal(putResp.status, 403);
  });

  await t.test(
    'principal PUT updates name and both position titles — the real column-level GRANT, not just the JS allow-list',
    async () => {
      const token = await login(collegeA, 'principaluser');
      const resp = await put(baseUrl, '/api/v1/college-profile', headersFor(collegeA, token), {
        name: 'Renamed College',
        level1_position_title: 'Director',
        level3_position_title: 'Head of Section',
        affiliating_university: 'Test University',
      });
      assert.equal(resp.status, 200);
      assert.equal(resp.body.name, 'Renamed College');
      assert.equal(resp.body.level1_position_title, 'Director');
      assert.equal(resp.body.level3_position_title, 'Head of Section');
      assert.equal(resp.body.affiliating_university, 'Test University');

      const getResp = await get(baseUrl, '/api/v1/college-profile', headersFor(collegeA, token));
      assert.equal(getResp.status, 200);
      assert.equal(getResp.body.name, 'Renamed College');
      assert.equal(getResp.body.level1_position_title, 'Director');
    },
  );

  await t.test('PUT with a blank name is rejected with 400, not persisted', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await put(baseUrl, '/api/v1/college-profile', headersFor(collegeA, token), { name: '' });
    assert.equal(resp.status, 400);

    const getResp = await get(baseUrl, '/api/v1/college-profile', headersFor(collegeA, token));
    assert.equal(getResp.body.name, 'Renamed College', 'the earlier valid name must be untouched');
  });
});
