'use strict';

// P3 4.9 — contract tests for routes/documents.js. documents.test.js
// already proves business/authorization behavior end to end; this file
// proves the SCHEMA LAYER itself: a genuinely wrong-typed field gets a
// clean 400 from validate() instead of whatever undefined behavior a
// raw type mismatch would otherwise produce downstream, `file_base64`
// specifically is NEVER intercepted by validate() (its own existing
// business-layer type check must keep owning that message — see
// documents.js's own schema-block comment), a well-formed request is
// unaffected by the new middleware, and the schema really is the one
// serving GET /api/v1/openapi.json.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedPrincipalPosition, cleanupPositionRows } = require('./helpers/positionFixtures');
const { cleanupCollegeStorage } = require('./helpers/storageFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'DocumentsContractPass123!';

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

function hostFor(subdomain) {
  return `${subdomain}.arcnave.test`;
}

async function seedTenant(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const college = { collegeId: `dcc${suffix}`, subdomain: `doccontract${suffix}` };
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
  college.principalUserId = principalResult.rows[0].id;
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
  return college;
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool
    .query('DELETE FROM personal_document_folders WHERE college_id = $1', [college.collegeId])
    .catch(() => {});
  await adminPool.query('DELETE FROM documents WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('documents.js contract', async (t) => {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.on('listening', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const college = await seedTenant(adminPool);
  let personalDocumentId;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await cleanupTenant(adminPool, college);
    await adminPool.end();
    await cleanupCollegeStorage(college.collegeId);
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
    'GET /api/v1/openapi.json lists a representative sample of documents.js paths, sourced from the same schemas validate() enforces',
    async () => {
      const resp = await get(baseUrl, '/api/v1/openapi.json', { host: hostFor(college.subdomain) });
      assert.equal(resp.status, 200);
      for (const [path, methods] of [
        ['/documents', ['post', 'get']],
        ['/documents/personal', ['post']],
        ['/documents/personal/folders', ['post']],
        ['/documents/{id}', ['get', 'delete']],
        ['/documents/{id}/review', ['post']],
        ['/documents/institutional', ['post', 'get']],
      ]) {
        assert.ok(resp.body.paths[path], `${path} documented`);
        for (const method of methods) {
          assert.ok(resp.body.paths[path][method], `${method.toUpperCase()} ${path} documented`);
        }
      }
    },
  );

  await t.test('POST /documents with a wrong-typed non-file field gets a clean 400 from validate()', async () => {
    const token = await loginPrincipal();
    const resp = await post(baseUrl, '/api/v1/documents', headers(token), {
      student_id: 12345,
      file_base64: Buffer.from('contract test file').toString('base64'),
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test(
    'POST /documents with file_base64 sent as the wrong type is NOT intercepted by validate() — the route\'s own "file_base64 is required" message is unchanged',
    async () => {
      const token = await loginPrincipal();
      const resp = await post(baseUrl, '/api/v1/documents', headers(token), { file_base64: 12345 });
      assert.equal(resp.status, 400);
      assert.equal(resp.body.detail, 'file_base64 is required');
    },
  );

  await t.test('POST /documents/personal with a well-formed body is unaffected by validate()', async () => {
    const token = await loginPrincipal();
    const resp = await post(baseUrl, '/api/v1/documents/personal', headers(token), {
      file_base64: Buffer.from('contract test personal doc').toString('base64'),
      file_name: 'contract-test.txt',
      mime_type: 'text/plain',
      title: 'Contract Test Doc',
    });
    assert.equal(resp.status, 201);
    personalDocumentId = resp.body.id;
  });

  await t.test('PATCH /documents/personal/{id} with a wrong-typed field gets a clean 400', async () => {
    const token = await loginPrincipal();
    const resp = await patch(baseUrl, `/api/v1/documents/personal/${personalDocumentId}`, headers(token), {
      file_name: 12345,
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('PATCH /documents/personal/{id} with a well-formed body is unaffected by validate()', async () => {
    const token = await loginPrincipal();
    const resp = await patch(baseUrl, `/api/v1/documents/personal/${personalDocumentId}`, headers(token), {
      file_name: 'renamed-contract-test.txt',
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.file_name, 'renamed-contract-test.txt');
  });

  await t.test('GET /documents/{id} (params-only schema) is unaffected by validate()', async () => {
    const token = await loginPrincipal();
    const resp = await get(baseUrl, `/api/v1/documents/${personalDocumentId}`, headers(token));
    assert.equal(resp.status, 200);
  });

  await t.test('POST /documents/personal/folders with a wrong-typed name gets a clean 400', async () => {
    const token = await loginPrincipal();
    const resp = await post(baseUrl, '/api/v1/documents/personal/folders', headers(token), { name: 12345 });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('POST /documents/personal/folders with a well-formed body is unaffected by validate()', async () => {
    const token = await loginPrincipal();
    const resp = await post(baseUrl, '/api/v1/documents/personal/folders', headers(token), { name: 'Contract Folder' });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.name, 'Contract Folder');
  });

  await t.test('POST /documents/{id}/review with a wrong-typed status gets a clean 400', async () => {
    const token = await loginPrincipal();
    const resp = await post(baseUrl, `/api/v1/documents/${personalDocumentId}/review`, headers(token), {
      status: 12345,
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test(
    "GET /documents with student_id omitted is NOT rejected by validate() — the route's own message is unchanged",
    async () => {
      const token = await loginPrincipal();
      const resp = await get(baseUrl, '/api/v1/documents', headers(token));
      assert.equal(resp.status, 400);
      assert.equal(resp.body.detail, 'student_id query parameter is required');
    },
  );
});
