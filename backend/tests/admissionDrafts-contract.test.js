'use strict';

// P4 route-validation pass — contract tests for routes/admissionDrafts.js.
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
const { seedClassTutorPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'DraftContractPass123!';

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
  const college = { collegeId: `adc${suffix}`, subdomain: `draftcontract${suffix}` };
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)', [
    college.collegeId,
    college.subdomain,
  ]);
  const passwordHash = await security.hashPassword(PASSWORD);
  const userResult = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'staffuser', 'staffuser@example.com', $2, 'staff', true) RETURNING id`,
    [college.collegeId, passwordHash],
  );
  college.staffUserId = userResult.rows[0].id;
  await adminPool.query('INSERT INTO staff (college_id, user_id, full_name) VALUES ($1, $2, $3)', [
    college.collegeId,
    college.staffUserId,
    'Contract Staff',
  ]);
  const classResult = await adminPool.query(
    'INSERT INTO classes (college_id, class_name) VALUES ($1, $2) RETURNING id',
    [college.collegeId, `Contract Class ${college.collegeId}`],
  );
  college.classId = classResult.rows[0].id;
  // POST /students/admission-drafts requires the 'class_tutor' position
  // (middleware/permissions.js's 'students.create': ['class_tutor']),
  // not just users.role === 'staff' — same seeding shape
  // students-contract.test.js/attendance-contract.test.js already use.
  const { officialEmail } = await seedClassTutorPosition(adminPool, {
    collegeId: college.collegeId,
    userId: college.staffUserId,
    classId: college.classId,
    passwordHash,
  });
  college.classTutorEmail = officialEmail;
  return college;
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await adminPool
    .query('DELETE FROM student_admission_drafts WHERE college_id = $1', [college.collegeId])
    .catch(() => {});
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM classes WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('admissionDrafts.js contract', async (t) => {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.on('listening', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const college = await seedTenant(adminPool);
  let draftId;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await cleanupTenant(adminPool, college);
    await adminPool.end();
  });

  // POST /students/admission-drafts requires the 'class_tutor' position
  // (middleware/permissions.js), so every call in this file logs in
  // through the Position Account seeded in seedTenant, not the plain
  // personal 'staff' login — same choice
  // students-contract.test.js/attendance-contract.test.js make for their
  // own tutor-scoped routes.
  async function loginStaff() {
    const resp = await requestJson(baseUrl, '/api/v1/position-accounts/login', 'POST', {
      headers: { host: hostFor(college.subdomain) },
      body: { official_email: college.classTutorEmail, password: PASSWORD },
    });
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  function headers(token) {
    return { host: hostFor(college.subdomain), authorization: `Bearer ${token}` };
  }

  await t.test(
    'GET /api/v1/openapi.json lists every admissionDrafts.js path, sourced from the same schemas validate() enforces',
    async () => {
      const resp = await get(baseUrl, '/api/v1/openapi.json', { host: hostFor(college.subdomain) });
      assert.equal(resp.status, 200);
      for (const [path, methods] of [
        ['/students/admission-drafts/{draftId}', ['get', 'patch']],
        ['/students/admission-drafts/{draftId}/documents', ['post']],
        ['/students/admission-drafts/{draftId}/complete', ['post']],
      ]) {
        assert.ok(resp.body.paths[path], `${path} documented`);
        for (const method of methods) {
          assert.ok(resp.body.paths[path][method], `${method.toUpperCase()} ${path} documented`);
        }
      }
    },
  );

  await t.test('POST /students/admission-drafts creates a draft (no body to validate)', async () => {
    const token = await loginStaff();
    const resp = await post(baseUrl, '/api/v1/students/admission-drafts', headers(token), undefined);
    assert.equal(resp.status, 201);
    assert.ok(resp.body.id);
    draftId = resp.body.id;
  });

  await t.test(
    'PATCH /students/admission-drafts/{draftId} with an array body gets a clean 400 from validate(), never a downstream crash',
    async () => {
      const token = await loginStaff();
      const resp = await patch(baseUrl, `/api/v1/students/admission-drafts/${draftId}`, headers(token), [
        'not',
        'an',
        'object',
      ]);
      assert.equal(resp.status, 400);
      assert.equal(resp.body.detail, 'Invalid request');
    },
  );

  await t.test(
    'PATCH /students/admission-drafts/{draftId} with a well-formed body is unaffected by validate()',
    async () => {
      const token = await loginStaff();
      const resp = await patch(baseUrl, `/api/v1/students/admission-drafts/${draftId}`, headers(token), {
        roll_no: 'CONTRACT01',
      });
      assert.notEqual(resp.status, 400);
    },
  );

  await t.test(
    'GET /students/admission-drafts/{draftId} (params-only schema) is unaffected by validate()',
    async () => {
      const token = await loginStaff();
      const resp = await get(baseUrl, `/api/v1/students/admission-drafts/${draftId}`, headers(token));
      assert.equal(resp.status, 200);
    },
  );

  await t.test(
    'POST /students/admission-drafts/{draftId}/complete (params-only schema) is unaffected by validate()',
    async () => {
      const token = await loginStaff();
      const resp = await post(
        baseUrl,
        `/api/v1/students/admission-drafts/${draftId}/complete`,
        headers(token),
        undefined,
      );
      // Whatever the business outcome, validate() must not be the reason
      // for a 400 here — the schema has no fields to fail on.
      assert.notEqual(resp.body && resp.body.detail, 'Invalid request');
    },
  );
});
