'use strict';

// P3 4.9 — contract tests for routes/platform.js. platform.test.js
// already proves business/authorization behavior end to end (login,
// college lifecycle, cross-app isolation); this file proves the
// SCHEMA LAYER itself: a genuinely wrong-typed field on a
// narrow-typed route gets a clean 400 from validate() instead of
// whatever undefined behavior a raw type mismatch would otherwise
// produce downstream, a business-owned "X is required" message (the
// onboarding/invite-principal OTP routes' own checks) is UNCHANGED
// when that field is simply omitted, a well-formed request is
// unaffected by the new middleware, and the schema really is the one
// serving GET /api/v1/openapi.json.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PLATFORM_PASSWORD = 'PlatformContractPass123!';

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

test('platform.js contract', async (t) => {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.on('listening', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });

  const suffix = crypto.randomUUID().slice(0, 8);
  const adminUsername = `platformcontract${suffix}`;
  const adminResult = await adminPool.query(
    `INSERT INTO platform_admins (username, email, password_hash)
     VALUES ($1, $2, $3) RETURNING id`,
    [adminUsername, `${adminUsername}@example.com`, await security.hashPassword(PLATFORM_PASSWORD)],
  );
  const adminId = adminResult.rows[0].id;
  const createdColleges = [];

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const cid of createdColleges) {
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [cid]);
    }
    await adminPool.query('DELETE FROM platform_audit_log WHERE actor_admin_id = $1', [adminId]);
    await adminPool.query('DELETE FROM platform_admins WHERE id = $1', [adminId]);
    await adminPool.end();
  });

  async function platformToken() {
    const resp = await post(baseUrl, '/api/v1/platform/auth/login', {}, { username: adminUsername, password: PLATFORM_PASSWORD });
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  function headers(token) {
    return { authorization: `Bearer ${token}` };
  }

  function collegeIdFactory() {
    const cid = `plc${crypto.randomUUID().slice(0, 8)}`;
    createdColleges.push(cid);
    return cid;
  }

  await t.test('GET /api/v1/openapi.json lists a representative sample of platform.js paths, sourced from the same schemas validate() enforces', async () => {
    const resp = await get(baseUrl, '/api/v1/openapi.json', {});
    assert.equal(resp.status, 200);
    for (const [path, methods] of [
      ['/platform/colleges', ['post', 'get']],
      ['/platform/colleges/{college_id}', ['patch']],
      ['/platform/colleges/{college_id}/invite-principal', ['post']],
      ['/platform/invitations', ['get']],
      ['/platform/settings', ['put']],
      ['/platform/structural-authorization-keys/redeem', ['post']],
    ]) {
      assert.ok(resp.body.paths[path], `${path} documented`);
      for (const method of methods) {
        assert.ok(resp.body.paths[path][method], `${method.toUpperCase()} ${path} documented`);
      }
    }
  });

  await t.test('POST /platform/colleges with a well-formed body is unaffected by validate()', async () => {
    const token = await platformToken();
    const collegeId = collegeIdFactory();
    const resp = await post(baseUrl, '/api/v1/platform/colleges', headers(token), {
      college_id: collegeId,
      name: 'Contract Test College',
      subdomain: collegeId,
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.college_id, collegeId);
  });

  await t.test('POST /platform/colleges with a non-object body gets a clean 400', async () => {
    const token = await platformToken();
    const resp = await post(baseUrl, '/api/v1/platform/colleges', headers(token), ['not', 'an', 'object']);
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('PATCH /platform/colleges/{college_id} with a wrong-typed subscription_status gets a clean 400', async () => {
    const token = await platformToken();
    const collegeId = collegeIdFactory();
    await post(baseUrl, '/api/v1/platform/colleges', headers(token), {
      college_id: collegeId,
      name: 'Contract Test College 2',
      subdomain: collegeId,
    });
    const resp = await patch(baseUrl, `/api/v1/platform/colleges/${collegeId}`, headers(token), {
      subscription_status: 12345,
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('PATCH /platform/colleges/{college_id} with a well-formed body is unaffected by validate()', async () => {
    const token = await platformToken();
    const collegeId = collegeIdFactory();
    await post(baseUrl, '/api/v1/platform/colleges', headers(token), {
      college_id: collegeId,
      name: 'Contract Test College 3',
      subdomain: collegeId,
    });
    const resp = await patch(baseUrl, `/api/v1/platform/colleges/${collegeId}`, headers(token), {
      subscription_status: 'full',
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.subscription_status, 'full');
  });

  await t.test('POST /platform/colleges/{college_id}/invite-principal with a wrong-typed email gets a clean 400', async () => {
    const token = await platformToken();
    const collegeId = collegeIdFactory();
    await post(baseUrl, '/api/v1/platform/colleges', headers(token), {
      college_id: collegeId,
      name: 'Contract Test College 4',
      subdomain: collegeId,
    });
    const resp = await post(baseUrl, `/api/v1/platform/colleges/${collegeId}/invite-principal`, headers(token), {
      email: 12345,
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('POST /platform/onboarding/verify-email/send-code with email omitted is NOT rejected by validate() — the route\'s own message is unchanged', async () => {
    const token = await platformToken();
    const resp = await post(baseUrl, '/api/v1/platform/onboarding/verify-email/send-code', headers(token), {});
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'email is required');
  });

  await t.test('POST /platform/onboarding/verify-email/verify-code with code omitted is NOT rejected by validate() — the route\'s own message is unchanged', async () => {
    const token = await platformToken();
    const resp = await post(baseUrl, '/api/v1/platform/onboarding/verify-email/verify-code', headers(token), {
      email: 'someone@example.com',
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'email and code are required');
  });

  await t.test('PUT /platform/settings with a non-object body gets a clean 400', async () => {
    const token = await platformToken();
    const resp = await requestJson(baseUrl, '/api/v1/platform/settings', 'PUT', {
      headers: headers(token),
      body: ['not', 'an', 'object'],
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('GET /platform/colleges with a well-formed query is unaffected by validate()', async () => {
    const token = await platformToken();
    const resp = await get(baseUrl, '/api/v1/platform/colleges?limit=10&offset=0', headers(token));
    assert.equal(resp.status, 200);
    assert.ok(Array.isArray(resp.body));
  });

  await t.test('POST /platform/structural-authorization-keys/redeem with sections omitted is NOT rejected by validate() — the route\'s own message is unchanged', async () => {
    const token = await platformToken();
    const resp = await post(baseUrl, '/api/v1/platform/structural-authorization-keys/redeem', headers(token), {
      token: 'some-token',
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'sections is required — at least one of l2Config/affiliation/accreditation/campus/department');
  });
});
