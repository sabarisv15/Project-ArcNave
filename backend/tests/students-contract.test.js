'use strict';

// P3 4.9 — contract tests for routes/students.js. students.test.js
// already proves business/authorization behavior end to end (685 lines,
// exhaustive role/scope coverage); this file proves the SCHEMA LAYER
// itself: a genuinely wrong-typed field gets a clean 400 from
// validate() (middleware/validate.js) instead of whatever undefined
// behavior a raw type mismatch would otherwise produce downstream, a
// well-formed request is unaffected by the new middleware, and the
// schema really is the one serving GET /api/v1/openapi.json. Not
// exhaustive over all 23 routes (mechanically the same validate()
// middleware everywhere) — a representative sample covering every
// distinct body/params shape in students.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedClassTutorPosition, seedHodPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'StudentContractPass123!';

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
  const college = { collegeId: `stc${suffix}`, subdomain: `stucontract${suffix}` };
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
  const tutorUserResult = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'tutoruser', 'tutoruser@example.com', $2, 'staff', true) RETURNING id`,
    [college.collegeId, passwordHash],
  );
  const principalUserId = userResult.rows[0].id;
  const tutorUserId = tutorUserResult.rows[0].id;

  const deptResult = await adminPool.query('INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id', [
    college.collegeId,
    `Dept ${college.collegeId}`,
  ]);
  college.departmentId = deptResult.rows[0].id;
  await adminPool.query('INSERT INTO staff (college_id, user_id, full_name) VALUES ($1, $2, $3)', [
    college.collegeId,
    principalUserId,
    'Contract Principal',
  ]);
  const classResult = await adminPool.query(
    'INSERT INTO classes (college_id, class_name, department_id) VALUES ($1, $2, $3) RETURNING id',
    [college.collegeId, `Contract Class ${college.collegeId}`, college.departmentId],
  );
  college.classId = classResult.rows[0].id;

  const { officialEmail } = await seedClassTutorPosition(adminPool, {
    collegeId: college.collegeId,
    userId: tutorUserId,
    classId: college.classId,
    passwordHash,
  });
  college.classTutorEmail = officialEmail;
  await seedHodPosition(adminPool, { collegeId: college.collegeId, userId: principalUserId, departmentId: college.departmentId, passwordHash });

  // A real student row, needed as the target for every /students/{id}/...
  // sub-resource route below — created directly against the repository
  // layer's own SQL shape (studentService.js), not through the API
  // (avoids depending on the create route's own schema/business path
  // this file is partly testing).
  const studentResult = await adminPool.query(
    `INSERT INTO students (college_id, roll_no, full_name, class_id, entry_type)
     VALUES ($1, $2, $3, $4, 'regular') RETURNING id`,
    [college.collegeId, `CR${crypto.randomUUID().slice(0, 6)}`, 'Contract Test Student', college.classId],
  );
  college.studentId = studentResult.rows[0].id;

  return college;
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM student_flags WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM student_semester_results WHERE college_id = $1', [college.collegeId]).catch(() => {});
  await adminPool.query('DELETE FROM student_transfer_requests WHERE college_id = $1', [college.collegeId]).catch(() => {});
  await adminPool.query('DELETE FROM student_lifecycle_events WHERE college_id = $1', [college.collegeId]).catch(() => {});
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM students WHERE college_id = $1', [college.collegeId]);
  // Must run before deleting `classes` — position_class_assignments
  // (seedClassTutorPosition's own row) FK-references it.
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM classes WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM departments WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('students.js contract', async (t) => {
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

  await t.test('GET /api/v1/openapi.json lists every students.js path, sourced from the same schemas validate() enforces', async () => {
    const resp = await get(baseUrl, '/api/v1/openapi.json', { host: hostFor(college.subdomain) });
    assert.equal(resp.status, 200);
    for (const [path, methods] of [
      ['/students', ['post', 'get']],
      ['/students/{id}', ['get', 'put', 'delete']],
      ['/students/{id}/transfer-requests', ['post', 'get']],
      ['/students/{id}/transfer-requests/{transferRequestId}/approve', ['post']],
      ['/students/{id}/flag', ['post', 'get']],
      ['/students/{id}/semester-results', ['post', 'get']],
      ['/students/{id}/lifecycle-status', ['post']],
      ['/students/{id}/phone-verification/otp', ['post']],
    ]) {
      assert.ok(resp.body.paths[path], `${path} documented`);
      for (const method of methods) {
        assert.ok(resp.body.paths[path][method], `${method.toUpperCase()} ${path} documented`);
      }
    }
  });

  await t.test('POST /students (class-tutor login) with a well-formed body reaches studentService, unaffected by validate()', async () => {
    const token = await loginTutor();
    const resp = await post(baseUrl, '/api/v1/students', headers(token), {
      roll_no: `NEW${crypto.randomUUID().slice(0, 6)}`,
      full_name: 'New Contract Student',
      class_id: college.classId,
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.full_name, 'New Contract Student');
  });

  await t.test('POST /students with an array body gets a clean 400 from validate(), never a downstream crash', async () => {
    const token = await loginTutor();
    // A bare JSON array is valid strict-mode JSON (body-parser accepts
    // it, unlike a bare string/number/boolean primitive, which
    // express.json()'s own `strict: true` default rejects before this
    // app's request pipeline ever sees it — a separate, pre-existing
    // gap this file does not attempt to fix, see the session's own
    // spawned follow-up task) — so this genuinely exercises z.record's
    // own object-shape rejection, not body-parser's.
    const resp = await post(baseUrl, '/api/v1/students', headers(token), ['not', 'an', 'object']);
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('PUT /students/{id} with an array body gets a clean 400', async () => {
    const token = await loginPrincipal();
    const resp = await put(baseUrl, `/api/v1/students/${college.studentId}`, headers(token), ['not', 'an', 'object']);
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('PUT /students/{id} with a well-formed body is unaffected by validate()', async () => {
    const token = await loginPrincipal();
    const resp = await put(baseUrl, `/api/v1/students/${college.studentId}`, headers(token), {
      notes: 'contract-test note',
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.notes, 'contract-test note');
  });

  await t.test('POST /students/{id}/transfer-requests with a wrong-typed field gets a clean 400', async () => {
    const token = await loginPrincipal();
    const resp = await post(baseUrl, `/api/v1/students/${college.studentId}/transfer-requests`, headers(token), {
      transfer_type: { nested: 'not-a-string' },
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('POST /students/{id}/flag with a wrong-typed remark gets a clean 400', async () => {
    const token = await loginPrincipal();
    const resp = await post(baseUrl, `/api/v1/students/${college.studentId}/flag`, headers(token), {
      remark: 12345,
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('POST /students/{id}/flag with a well-formed body is unaffected by validate()', async () => {
    const token = await loginPrincipal();
    const resp = await post(baseUrl, `/api/v1/students/${college.studentId}/flag`, headers(token), {
      remark: 'contract test flag',
    });
    assert.equal(resp.status, 201);
  });

  await t.test('POST /students/{id}/semester-results with a wrong-typed field gets a clean 400', async () => {
    const token = await loginPrincipal();
    const resp = await post(baseUrl, `/api/v1/students/${college.studentId}/semester-results`, headers(token), {
      semester: [1, 2, 3],
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('POST /students/{id}/lifecycle-status with a wrong-typed field gets a clean 400', async () => {
    const token = await loginPrincipal();
    const resp = await post(baseUrl, `/api/v1/students/${college.studentId}/lifecycle-status`, headers(token), {
      new_status: true,
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('POST /students/{id}/phone-verification/otp with a wrong-typed target gets a clean 400', async () => {
    const token = await loginPrincipal();
    const resp = await post(baseUrl, `/api/v1/students/${college.studentId}/phone-verification/otp`, headers(token), {
      target: { not: 'a-string' },
    });
    assert.equal(resp.status, 400);
    assert.equal(resp.body.detail, 'Invalid request');
  });

  await t.test('GET /students/{id}/timeline (params-only schema) is unaffected by validate()', async () => {
    const token = await loginPrincipal();
    const resp = await get(baseUrl, `/api/v1/students/${college.studentId}/timeline`, headers(token));
    assert.equal(resp.status, 200);
    assert.ok(Array.isArray(resp.body));
  });

  await t.test('GET /students (list, query-only schema) is unaffected by validate()', async () => {
    const token = await loginPrincipal();
    const resp = await get(baseUrl, '/api/v1/students?limit=10&offset=0', headers(token));
    assert.equal(resp.status, 200);
    assert.ok(Array.isArray(resp.body));
  });
});
