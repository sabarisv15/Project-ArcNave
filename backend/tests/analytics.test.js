'use strict';

// Integration tests for the Analytics API (/api/v1/analytics/...) —
// real HTTP requests against a live Postgres, same discipline as
// reports.test.js/attendance.test.js. Fixture shape (two classes, two
// sessions on one, one on the other, one soft-deleted) is the same
// scenario analytics-service.test.js's own seedTenant already proved
// at the service layer — reused here as HTTP fixtures rather than
// re-deriving new numbers, so a route-level regression (wrong role
// gate, reshaped response, wrong query param) is what this file
// actually tests, not the rate math itself (already proven).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedPrincipalPosition, seedHodPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'AnalyticsApiTestPass123!';

function requestJson(baseUrl, path, method, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, { method, headers }, (res) => {
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
    req.end();
  });
}

function get(baseUrl, path, headers) {
  return requestJson(baseUrl, path, 'GET', { headers });
}

function post(baseUrl, path, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = JSON.stringify(body);
    const reqHeaders = { ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) };
    const req = http.request(url, { method: 'POST', headers: reqHeaders }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
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
  const collegeId = `analyticsapi${label}${suffix}`;
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)', [
    collegeId,
    `analyticsapitenant${label}${suffix}`,
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
      [collegeId, username, `${username}@example.com`, passwordHash, role],
    );
    userIds[username] = result.rows[0].id;
  }
  await seedPrincipalPosition(adminPool, { collegeId, userId: userIds.principaluser, passwordHash });
  const dept = await adminPool.query('INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id', [
    collegeId,
    `Analytics API Dept ${suffix}`,
  ]);
  await seedHodPosition(adminPool, {
    collegeId,
    userId: userIds.hoduser,
    departmentId: dept.rows[0].id,
    passwordHash,
  });

  const classA = await adminPool.query(
    `INSERT INTO classes (college_id, class_name, timetable_status) VALUES ($1, $2, 'Approved') RETURNING id`,
    [collegeId, `Analytics API Class A ${suffix}`],
  );
  const classB = await adminPool.query(
    `INSERT INTO classes (college_id, class_name, timetable_status) VALUES ($1, $2, 'Approved') RETURNING id`,
    [collegeId, `Analytics API Class B ${suffix}`],
  );

  // Class A: two sessions, 2 then 1 absent out of 40 -> 77/80 = 96.25%.
  await adminPool.query(
    `INSERT INTO attendance_sessions (college_id, class_id, session_date, hour_index, marked_by_user_id, absent_student_ids, total_students)
     VALUES ($1, $2, '2026-07-01', 1, $3, '["s1","s2"]', 40)`,
    [collegeId, classA.rows[0].id, userIds.principaluser],
  );
  await adminPool.query(
    `INSERT INTO attendance_sessions (college_id, class_id, session_date, hour_index, marked_by_user_id, absent_student_ids, total_students)
     VALUES ($1, $2, '2026-07-02', 1, $3, '["s3"]', 40)`,
    [collegeId, classA.rows[0].id, userIds.principaluser],
  );
  // Class B: one session, 0 absent out of 20 -> 100%.
  await adminPool.query(
    `INSERT INTO attendance_sessions (college_id, class_id, session_date, hour_index, marked_by_user_id, absent_student_ids, total_students)
     VALUES ($1, $2, '2026-07-01', 1, $3, '[]', 20)`,
    [collegeId, classB.rows[0].id, userIds.principaluser],
  );

  // staffuser is faculty-allocated to Class A only — the fixture this
  // file's own "staff sees only their scoped class" test needs (UAT
  // discovery, Class Tutor dashboard, 2026-07-26). Not tutoring the
  // class, just teaching a period in it — getVisibleClassIds' own
  // SELF_ASSIGNED scope already includes faculty-allocated classes,
  // not tutor-of-record only.
  const period = await adminPool.query(
    `INSERT INTO timetable_periods (college_id, day_of_week, hour_index, start_time, end_time)
     VALUES ($1, 'Monday', 1, '09:00', '10:00') RETURNING id`,
    [collegeId],
  );
  await adminPool.query(
    `INSERT INTO faculty_allocation (college_id, class_id, period_id, subject, staff_user_id)
     VALUES ($1, $2, $3, 'Analytics API Subject', $4)`,
    [collegeId, classA.rows[0].id, period.rows[0].id, userIds.staffuser],
  );

  return {
    collegeId,
    subdomain: `analyticsapitenant${label}${suffix}`,
    userIds,
    classIds: { a: classA.rows[0].id, b: classB.rows[0].id },
  };
}

async function cleanupTenant(adminPool, tenant) {
  // audit_log.user_id FKs users(id) — must go before the users delete
  // below (task #17's login audit logging).
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [tenant.collegeId]);
  await cleanupPositionRows(adminPool, tenant.collegeId);
  await adminPool.query('DELETE FROM attendance_sessions WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM faculty_allocation WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM timetable_periods WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM classes WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM departments WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [tenant.collegeId]);
}

test('analytics API', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const collegeA = await seedTenant(adminPool, 'a');
  const emptyCollege = await seedTenant(adminPool, 'empty');
  // Strip the seeded sessions from the "empty" tenant — seedTenant
  // always seeds two classes' worth of sessions; this tenant needs
  // classes with zero attendance_sessions to prove the empty-data case.
  await adminPool.query('DELETE FROM attendance_sessions WHERE college_id = $1', [emptyCollege.collegeId]);

  t.after(async () => {
    await stopServer(server);
    await cleanupTenant(adminPool, collegeA);
    await cleanupTenant(adminPool, emptyCollege);
    await adminPool.end();
  });

  async function login(college, username) {
    const resp = await post(
      baseUrl,
      '/api/v1/auth/login',
      { host: hostFor(college.subdomain) },
      { username, password: PASSWORD },
    );
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  function headersFor(college, token) {
    const headers = { host: hostFor(college.subdomain) };
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  await t.test('unauthenticated request is rejected with 401, not a 500', async () => {
    const resp = await get(baseUrl, '/api/v1/analytics/attendance-rate', headersFor(collegeA));
    assert.equal(resp.status, 401);
  });

  // Widened 2026-07-26 (UAT discovery, Class Tutor dashboard): staff is
  // now allowed, scoped to their own visible classes
  // (getAttendanceRateForActor) — staffuser is faculty-allocated to
  // Class A only (seedTenant's own fixture), so they see Class A's real
  // rate and nothing from Class B, never a 403.
  await t.test("staff (neither principal nor hod) sees only their own allocated class's rate, not a 403", async () => {
    const token = await login(collegeA, 'staffuser');
    const resp = await get(baseUrl, '/api/v1/analytics/attendance-rate', headersFor(collegeA, token));
    assert.equal(resp.status, 200);
    assert.equal(resp.body.length, 1);
    assert.equal(resp.body[0].classId, collegeA.classIds.a);
    assert.equal(resp.body[0].attendanceRatePercent, 96.25);
  });

  await t.test('staff with no faculty allocation at all sees an empty result, not a 403', async () => {
    const token = await login(emptyCollege, 'staffuser');
    const resp = await get(baseUrl, '/api/v1/analytics/attendance-rate', headersFor(emptyCollege, token));
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.body, []);
  });

  await t.test('principal sees attendance rate by class, response shape passed through unchanged', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await get(baseUrl, '/api/v1/analytics/attendance-rate', headersFor(collegeA, token));
    assert.equal(resp.status, 200);
    assert.equal(resp.body.length, 2);

    const rowA = resp.body.find((r) => r.classId === collegeA.classIds.a);
    assert.equal(rowA.sessionsCount, 2);
    assert.equal(rowA.totalMarked, 80);
    assert.equal(rowA.totalPresent, 77);
    assert.equal(rowA.attendanceRatePercent, 96.25);

    const rowB = resp.body.find((r) => r.classId === collegeA.classIds.b);
    assert.equal(rowB.attendanceRatePercent, 100);
  });

  await t.test('hod sees the same data as principal', async () => {
    const token = await login(collegeA, 'hoduser');
    const resp = await get(baseUrl, '/api/v1/analytics/attendance-rate', headersFor(collegeA, token));
    assert.equal(resp.status, 200);
    assert.equal(resp.body.length, 2);
  });

  await t.test('class_id filters to one class', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await get(
      baseUrl,
      `/api/v1/analytics/attendance-rate?class_id=${collegeA.classIds.b}`,
      headersFor(collegeA, token),
    );
    assert.equal(resp.status, 200);
    assert.equal(resp.body.length, 1);
    assert.equal(resp.body[0].classId, collegeA.classIds.b);
  });

  await t.test(
    'start_date/end_date narrows the window (class A has one session on each of 2026-07-01 and 2026-07-02)',
    async () => {
      const token = await login(collegeA, 'principaluser');
      const resp = await get(
        baseUrl,
        `/api/v1/analytics/attendance-rate?class_id=${collegeA.classIds.a}&start_date=2026-07-01&end_date=2026-07-01`,
        headersFor(collegeA, token),
      );
      assert.equal(resp.status, 200);
      assert.equal(resp.body.length, 1);
      assert.equal(resp.body[0].sessionsCount, 1);

      const outOfRange = await get(
        baseUrl,
        `/api/v1/analytics/attendance-rate?class_id=${collegeA.classIds.a}&start_date=1900-01-01&end_date=1900-01-02`,
        headersFor(collegeA, token),
      );
      assert.equal(outOfRange.status, 200);
      assert.equal(outOfRange.body.length, 0);
    },
  );

  await t.test('a tenant with zero attendance_sessions gets 200 with an empty array, not an error', async () => {
    const token = await login(emptyCollege, 'principaluser');
    const resp = await get(baseUrl, '/api/v1/analytics/attendance-rate', headersFor(emptyCollege, token));
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.body, []);
  });
});
