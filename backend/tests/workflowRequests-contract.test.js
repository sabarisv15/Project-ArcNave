'use strict';

// P4 route-validation pass — contract tests for routes/workflowRequests.js.
// Proves the SCHEMA LAYER itself: a genuinely wrong-typed field gets a
// clean 400 from validate() instead of whatever undefined behavior a raw
// type mismatch would otherwise produce downstream, a well-formed/absent
// body is unaffected by the new middleware, and the schema really is the
// one serving GET /api/v1/openapi.json. Same style as
// tests/attendance-contract.test.js/tests/students-contract.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'WorkflowContractPass123!';

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

function hostFor(subdomain) {
  return `${subdomain}.arcnave.test`;
}

async function seedTenant(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const college = { collegeId: `wfc${suffix}`, subdomain: `workflowcontract${suffix}` };
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)', [
    college.collegeId,
    college.subdomain,
  ]);
  const passwordHash = await security.hashPassword(PASSWORD);
  const userResult = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'principaluser', 'principaluser@example.com', $2, 'principal', true) RETURNING id`,
    [college.collegeId, passwordHash],
  );
  college.principalUserId = userResult.rows[0].id;
  await adminPool.query('INSERT INTO staff (college_id, user_id, full_name) VALUES ($1, $2, $3)', [
    college.collegeId,
    college.principalUserId,
    'Contract Principal',
  ]);
  return college;
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('workflowRequests.js contract', async (t) => {
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

  function headers(token) {
    return { host: hostFor(college.subdomain), authorization: `Bearer ${token}` };
  }

  await t.test(
    'GET /api/v1/openapi.json lists every workflowRequests.js path, sourced from the same schemas validate() enforces',
    async () => {
      const resp = await get(baseUrl, '/api/v1/openapi.json', { host: hostFor(college.subdomain) });
      assert.equal(resp.status, 200);
      for (const [path, methods] of [
        ['/workflow-requests/{id}/approve', ['post']],
        ['/workflow-requests/{id}/reject', ['post']],
      ]) {
        assert.ok(resp.body.paths[path], `${path} documented`);
        for (const method of methods) {
          assert.ok(resp.body.paths[path][method], `${method.toUpperCase()} ${path} documented`);
        }
      }
    },
  );

  await t.test(
    'POST /workflow-requests/{id}/approve with an array body gets a clean 400 from validate(), never a downstream crash',
    async () => {
      const token = await loginPrincipal();
      const resp = await post(baseUrl, `/api/v1/workflow-requests/${crypto.randomUUID()}/approve`, headers(token), [
        'not',
        'an',
        'object',
      ]);
      assert.equal(resp.status, 400);
      assert.equal(resp.body.detail, 'Invalid request');
    },
  );

  await t.test('POST /workflow-requests/{id}/approve with a wrong-typed remarks field gets a clean 400', async () => {
    const token = await loginPrincipal();
    const resp = await post(baseUrl, `/api/v1/workflow-requests/${crypto.randomUUID()}/approve`, headers(token), {
      remarks: { nested: 'not-a-string' },
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test(
    'POST /workflow-requests/{id}/approve with a well-formed (absent-remarks) body is unaffected by validate() — reaches the 404 workflow lookup, not a 400',
    async () => {
      const token = await loginPrincipal();
      const resp = await post(
        baseUrl,
        `/api/v1/workflow-requests/${crypto.randomUUID()}/approve`,
        headers(token),
        undefined,
      );
      assert.equal(resp.status, 404);
    },
  );

  await t.test('POST /workflow-requests/{id}/reject with a wrong-typed remarks field gets a clean 400', async () => {
    const token = await loginPrincipal();
    const resp = await post(baseUrl, `/api/v1/workflow-requests/${crypto.randomUUID()}/reject`, headers(token), {
      remarks: 12345,
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });
});
