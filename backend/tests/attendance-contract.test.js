'use strict';

// P3 4.9 — contract tests for routes/attendance.js. attendance.test.js
// already proves business/authorization behavior end to end; this file
// proves the SCHEMA LAYER itself: a genuinely wrong-typed field gets a
// clean 400 from validate() instead of whatever undefined behavior a
// raw type mismatch would otherwise produce downstream, a well-formed
// request is unaffected by the new middleware, and the schema really
// is the one serving GET /api/v1/openapi.json.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedClassTutorPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'AttendanceContractPass123!';

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
  const college = { collegeId: `atc${suffix}`, subdomain: `attcontract${suffix}` };
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)', [
    college.collegeId,
    college.subdomain,
  ]);
  const passwordHash = await security.hashPassword(PASSWORD);
  const userResult = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'tutoruser', 'tutoruser@example.com', $2, 'staff', true) RETURNING id`,
    [college.collegeId, passwordHash],
  );
  college.tutorUserId = userResult.rows[0].id;

  const classResult = await adminPool.query(
    `INSERT INTO classes (college_id, class_name, timetable_status) VALUES ($1, 'Contract Approved Class', 'Approved') RETURNING id`,
    [college.collegeId],
  );
  college.classId = classResult.rows[0].id;

  const { officialEmail } = await seedClassTutorPosition(adminPool, {
    collegeId: college.collegeId,
    userId: college.tutorUserId,
    classId: college.classId,
    passwordHash,
  });
  college.classTutorEmail = officialEmail;

  return college;
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await adminPool
    .query('DELETE FROM attendance_corrections WHERE college_id = $1', [college.collegeId])
    .catch(() => {});
  await adminPool.query('DELETE FROM attendance_sessions WHERE college_id = $1', [college.collegeId]);
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM classes WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('attendance.js contract', async (t) => {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.on('listening', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const college = await seedTenant(adminPool);
  let sessionId;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await cleanupTenant(adminPool, college);
    await adminPool.end();
  });

  async function loginTutor() {
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
    'GET /api/v1/openapi.json lists every attendance.js path, sourced from the same schemas validate() enforces',
    async () => {
      const resp = await get(baseUrl, '/api/v1/openapi.json', { host: hostFor(college.subdomain) });
      assert.equal(resp.status, 200);
      for (const [path, methods] of [
        ['/attendance', ['post', 'get']],
        ['/attendance/{id}', ['get']],
        ['/attendance/{id}/lock', ['post']],
        ['/attendance/{id}/corrections', ['post', 'get']],
        ['/attendance/corrections/{correctionId}/approve', ['post']],
      ]) {
        assert.ok(resp.body.paths[path], `${path} documented`);
        for (const method of methods) {
          assert.ok(resp.body.paths[path][method], `${method.toUpperCase()} ${path} documented`);
        }
      }
    },
  );

  await t.test(
    'POST /attendance with an array body gets a clean 400 from validate(), never a downstream crash',
    async () => {
      const token = await loginTutor();
      const resp = await post(baseUrl, '/api/v1/attendance', headers(token), ['not', 'an', 'object']);
      assert.equal(resp.status, 400);
      assert.equal(resp.body.detail, 'Invalid request');
    },
  );

  await t.test('POST /attendance with a well-formed body is unaffected by validate()', async () => {
    const token = await loginTutor();
    const resp = await post(baseUrl, '/api/v1/attendance', headers(token), {
      class_id: college.classId,
      session_date: '2026-01-10',
      hour_index: 1,
      absent_student_ids: [],
      total_students: 30,
    });
    assert.equal(resp.status, 200);
    assert.ok(resp.body.id);
    sessionId = resp.body.id;
  });

  await t.test(
    "GET /attendance with class_id omitted is NOT rejected by validate() — the route's own message is unchanged",
    async () => {
      const token = await loginTutor();
      const resp = await get(baseUrl, '/api/v1/attendance', headers(token));
      assert.equal(resp.status, 400);
      assert.equal(resp.body.detail, 'class_id query parameter is required');
    },
  );

  await t.test('GET /attendance with a well-formed query is unaffected by validate()', async () => {
    const token = await loginTutor();
    const resp = await get(
      baseUrl,
      `/api/v1/attendance?class_id=${college.classId}&session_date=2026-01-10`,
      headers(token),
    );
    assert.equal(resp.status, 200);
    assert.ok(Array.isArray(resp.body));
  });

  await t.test('GET /attendance/{id} (params-only schema) is unaffected by validate()', async () => {
    const token = await loginTutor();
    const resp = await get(baseUrl, `/api/v1/attendance/${sessionId}`, headers(token));
    assert.equal(resp.status, 200);
  });

  await t.test('POST /attendance/{id}/corrections with a wrong-typed field gets a clean 400', async () => {
    const token = await loginTutor();
    const resp = await post(baseUrl, `/api/v1/attendance/${sessionId}/corrections`, headers(token), {
      proposed_absent_student_ids: 'not-an-array',
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('POST /attendance/{id}/corrections with a well-formed body is unaffected by validate()', async () => {
    const token = await loginTutor();
    const resp = await post(baseUrl, `/api/v1/attendance/${sessionId}/corrections`, headers(token), {
      proposed_absent_student_ids: [],
      proposed_total_students: 29,
      reason: 'contract test correction',
    });
    assert.notEqual(resp.status, 400);
  });

  await t.test('POST /attendance/absence-flags/{id}/close with a wrong-typed remarks gets a clean 400', async () => {
    const token = await loginTutor();
    const resp = await post(baseUrl, `/api/v1/attendance/absence-flags/${crypto.randomUUID()}/close`, headers(token), {
      remarks: 12345,
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });
});
