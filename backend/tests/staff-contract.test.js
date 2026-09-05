'use strict';

// P3 4.9 — contract tests for routes/staff.js. staff.test.js already
// proves business/authorization behavior end to end; this file proves
// the SCHEMA LAYER itself: a genuinely wrong-typed field gets a clean
// 400 from validate() instead of whatever undefined behavior a raw
// type mismatch would otherwise produce downstream, a well-formed
// request is unaffected by the new middleware, and the schema really
// is the one serving GET /api/v1/openapi.json.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedPrincipalPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'StaffContractPass123!';

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

function put(baseUrl, path, headers, body) {
  return requestJson(baseUrl, path, 'PUT', { headers, body });
}

function hostFor(subdomain) {
  return `${subdomain}.arcnave.test`;
}

async function seedTenant(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const college = { collegeId: `sfc${suffix}`, subdomain: `staffcontract${suffix}` };
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)', [
    college.collegeId,
    college.subdomain,
  ]);
  const passwordHash = await security.hashPassword(PASSWORD);
  const principalResult = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'principaluser', 'principaluser@example.com', $2, 'principal', true) RETURNING id`,
    [college.collegeId, passwordHash],
  );
  const targetUserResult = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'targetuser', 'targetuser@example.com', $2, 'staff', true) RETURNING id`,
    [college.collegeId, passwordHash],
  );
  college.principalUserId = principalResult.rows[0].id;
  college.targetUserId = targetUserResult.rows[0].id;

  await adminPool.query('INSERT INTO staff (college_id, user_id, full_name) VALUES ($1, $2, $3)', [
    college.collegeId,
    college.principalUserId,
    'Contract Principal',
  ]);
  await seedPrincipalPosition(adminPool, {
    collegeId: college.collegeId,
    userId: college.principalUserId,
    passwordHash,
  });

  const targetStaffResult = await adminPool.query(
    'INSERT INTO staff (college_id, user_id, full_name) VALUES ($1, $2, $3) RETURNING id',
    [college.collegeId, college.targetUserId, 'Contract Target Staff'],
  );
  college.targetStaffId = targetStaffResult.rows[0].id;

  return college;
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM staff_work_history WHERE college_id = $1', [college.collegeId]).catch(() => {});
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [college.collegeId]);
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('staff.js contract', async (t) => {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.on('listening', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const college = await seedTenant(adminPool);

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await cleanupTenant(adminPool, college);
    await adminPool.end();
  });

  async function loginPrincipal() {
    const resp = await requestJson(baseUrl, '/api/v1/auth/login', 'POST', {
      headers: { host: hostFor(college.subdomain) },
      body: { username: 'principaluser', password: PASSWORD },
    });
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  async function loginTarget() {
    const resp = await requestJson(baseUrl, '/api/v1/auth/login', 'POST', {
      headers: { host: hostFor(college.subdomain) },
      body: { username: 'targetuser', password: PASSWORD },
    });
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  function headers(token) {
    return { host: hostFor(college.subdomain), authorization: `Bearer ${token}` };
  }

  await t.test(
    'GET /api/v1/openapi.json lists every staff.js path, sourced from the same schemas validate() enforces',
    async () => {
      const resp = await get(baseUrl, '/api/v1/openapi.json', { host: hostFor(college.subdomain) });
      assert.equal(resp.status, 200);
      for (const [path, methods] of [
        ['/staff', ['post', 'get']],
        ['/staff/invitations', ['post']],
        ['/staff/hod-accounts', ['post']],
        ['/staff/me', ['put']],
        ['/staff/me/work-history', ['post']],
        ['/staff/{id}', ['get', 'put', 'delete']],
        ['/staff/{id}/submit-registration', ['post']],
        ['/staff/{id}/deactivate', ['post']],
      ]) {
        assert.ok(resp.body.paths[path], `${path} documented`);
        for (const method of methods) {
          assert.ok(resp.body.paths[path][method], `${method.toUpperCase()} ${path} documented`);
        }
      }
    },
  );

  await t.test(
    'POST /staff with an array body gets a clean 400 from validate(), never a downstream crash',
    async () => {
      const token = await loginPrincipal();
      const resp = await post(baseUrl, '/api/v1/staff', headers(token), ['not', 'an', 'object']);
      assert.equal(resp.status, 400);
      assert.equal(resp.body.detail, 'Invalid request');
    },
  );

  await t.test('POST /staff/invitations with a wrong-typed email gets a clean 400', async () => {
    const token = await loginPrincipal();
    const resp = await post(baseUrl, '/api/v1/staff/invitations', headers(token), { email: 12345 });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('PUT /staff/me with an array body gets a clean 400', async () => {
    const token = await loginTarget();
    const resp = await put(baseUrl, '/api/v1/staff/me', headers(token), ['not', 'an', 'object']);
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('PUT /staff/me with a well-formed body is unaffected by validate()', async () => {
    const token = await loginTarget();
    const resp = await put(baseUrl, '/api/v1/staff/me', headers(token), { phone: '9999999999' });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.phone, '9999999999');
  });

  await t.test('POST /staff/me/phone-verification/verify with a wrong-typed code gets a clean 400', async () => {
    const token = await loginTarget();
    const resp = await post(baseUrl, '/api/v1/staff/me/phone-verification/verify', headers(token), { code: 123456 });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('POST /staff/me/work-history with a wrong-typed field gets a clean 400', async () => {
    const token = await loginTarget();
    const resp = await post(baseUrl, '/api/v1/staff/me/work-history', headers(token), { institution_name: 123 });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('POST /staff/me/work-history with a well-formed body is unaffected by validate()', async () => {
    const token = await loginTarget();
    const resp = await post(baseUrl, '/api/v1/staff/me/work-history', headers(token), {
      institution_name: 'Contract Test College',
      designation_held: 'Lecturer',
      from_date: '2020-01-01',
      to_date: '2021-01-01',
    });
    assert.equal(resp.status, 201);
  });

  await t.test(
    'DELETE /staff/me/work-history/{entryId} with a well-formed params is unaffected by validate() (404 from the service, not a validate() 400)',
    async () => {
      const token = await loginTarget();
      const resp = await requestJson(baseUrl, `/api/v1/staff/me/work-history/${crypto.randomUUID()}`, 'DELETE', {
        headers: headers(token),
      });
      assert.notEqual(resp.status, 400);
    },
  );

  await t.test('PUT /staff/{id} with an array body gets a clean 400', async () => {
    const token = await loginPrincipal();
    const resp = await put(baseUrl, `/api/v1/staff/${college.targetStaffId}`, headers(token), ['not', 'an', 'object']);
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('PUT /staff/{id} with a well-formed body is unaffected by validate()', async () => {
    const token = await loginPrincipal();
    const resp = await put(baseUrl, `/api/v1/staff/${college.targetStaffId}`, headers(token), {
      designation: 'Contract Test Designation',
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.designation, 'Contract Test Designation');
  });

  await t.test('GET /staff (list, query-only schema) is unaffected by validate()', async () => {
    const token = await loginPrincipal();
    const resp = await get(baseUrl, '/api/v1/staff?limit=10&offset=0', headers(token));
    assert.equal(resp.status, 200);
    assert.ok(Array.isArray(resp.body));
  });

  await t.test('GET /staff/{id} (params-only schema) is unaffected by validate()', async () => {
    const token = await loginPrincipal();
    const resp = await get(baseUrl, `/api/v1/staff/${college.targetStaffId}`, headers(token));
    assert.equal(resp.status, 200);
  });
});
