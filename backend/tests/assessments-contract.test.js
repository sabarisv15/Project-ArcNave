'use strict';

// P3 4.9 — contract tests for routes/assessments.js. assessment-service.test.js
// already proves assessmentService's own business/authorization behavior
// end to end; this file proves the SCHEMA LAYER itself: a genuinely
// wrong-typed field gets a clean 400 from validate() instead of
// whatever undefined behavior a raw type mismatch would otherwise
// produce downstream — including a REAL pre-existing crash class this
// file's own schema block fixes: `assessment_types.max_marks`/
// `assessment_marks.marks_obtained` are NUMERIC columns with no type
// check anywhere in assessmentService, so a non-numeric value passed
// every existing check and then failed as a raw, unhandled Postgres
// "invalid input syntax for type numeric" 500. A business-owned
// message (`recordMark`'s own combined requiredness message) stays
// UNCHANGED when that field is simply omitted, a well-formed request
// is unaffected, and the schema really is the one serving
// GET /api/v1/openapi.json.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedPrincipalPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'AssessmentsContractPass123!';

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
  const college = { collegeId: `asc${suffix}`, subdomain: `asccontract${suffix}` };
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
  await adminPool.query('DELETE FROM assessment_types WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('assessments.js contract', async (t) => {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.on('listening', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const college = await seedTenant(adminPool);
  let assessmentTypeId;
  const fakeClassId = crypto.randomUUID();

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

  await t.test('GET /api/v1/openapi.json lists a representative sample of assessments.js paths, sourced from the same schemas validate() enforces', async () => {
    const resp = await get(baseUrl, '/api/v1/openapi.json', { host: hostFor(college.subdomain) });
    assert.equal(resp.status, 200);
    for (const [path, methods] of [
      ['/assessment-types', ['post', 'get']],
      ['/assessment-types/{id}', ['put']],
      ['/classes/{id}/assessment-marks', ['post']],
      ['/assessment-marks/{id}', ['put', 'delete']],
      ['/assessment-marks', ['get']],
      ['/assessment-marks/{id}/corrections', ['post', 'get']],
    ]) {
      assert.ok(resp.body.paths[path], `${path} documented`);
      for (const method of methods) {
        assert.ok(resp.body.paths[path][method], `${method.toUpperCase()} ${path} documented`);
      }
    }
  });

  await t.test('POST /assessment-types with a wrong-typed max_marks gets a clean 400', async () => {
    const token = await loginPrincipal();
    const resp = await post(baseUrl, '/api/v1/assessment-types', headers(token), {
      name: 'Contract Midterm',
      max_marks: 'fifty',
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('POST /assessment-types with a well-formed body is unaffected by validate()', async () => {
    const token = await loginPrincipal();
    const resp = await post(baseUrl, '/api/v1/assessment-types', headers(token), {
      name: 'Contract Midterm',
      max_marks: 50,
    });
    assert.equal(resp.status, 201);
    assessmentTypeId = resp.body.id;
  });

  await t.test('PUT /assessment-types/{id} with a wrong-typed max_marks gets a clean 400', async () => {
    const token = await loginPrincipal();
    const resp = await put(baseUrl, `/api/v1/assessment-types/${assessmentTypeId}`, headers(token), {
      max_marks: { not: 'a-number' },
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('PUT /assessment-types/{id} with a well-formed body is unaffected by validate()', async () => {
    const token = await loginPrincipal();
    const resp = await put(baseUrl, `/api/v1/assessment-types/${assessmentTypeId}`, headers(token), {
      max_marks: 75,
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.max_marks, '75');
  });

  await t.test('POST /classes/{id}/assessment-marks with a wrong-typed marks_obtained gets a clean 400 — the real pre-existing crash class this schema fixes', async () => {
    const token = await loginPrincipal();
    const resp = await post(baseUrl, `/api/v1/classes/${fakeClassId}/assessment-marks`, headers(token), {
      academic_year: '2026-2027',
      subject: 'Mathematics',
      assessment_type_id: assessmentTypeId,
      student_id: crypto.randomUUID(),
      marks_obtained: 'forty-five',
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('POST /classes/{id}/assessment-marks with marks_obtained omitted is NOT rejected by validate() — the service\'s own combined requiredness message is unchanged', async () => {
    const token = await loginPrincipal();
    const resp = await post(baseUrl, `/api/v1/classes/${fakeClassId}/assessment-marks`, headers(token), {
      academic_year: '2026-2027',
      subject: 'Mathematics',
      assessment_type_id: assessmentTypeId,
      student_id: crypto.randomUUID(),
    });
    assert.equal(resp.status, 400);
    assert.equal(
      resp.body.detail,
      'academicYear, classId, subject, assessmentTypeId, studentId, and marksObtained are required',
    );
  });

  await t.test('PUT /assessment-marks/{id} with a wrong-typed marks_obtained gets a clean 400', async () => {
    const token = await loginPrincipal();
    const resp = await put(baseUrl, `/api/v1/assessment-marks/${crypto.randomUUID()}`, headers(token), {
      marks_obtained: [1, 2, 3],
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('GET /assessment-marks with a well-formed query is unaffected by validate()', async () => {
    const token = await loginPrincipal();
    const resp = await get(baseUrl, `/api/v1/assessment-marks?academic_year=2026-2027&subject=Mathematics`, headers(token));
    assert.equal(resp.status, 200);
    assert.ok(Array.isArray(resp.body));
  });
});
