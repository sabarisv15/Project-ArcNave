'use strict';

// Integration tests for the faculty-allocation API — real HTTP
// requests against a live Postgres, same discipline as
// classes.test.js/timetable-periods.test.js: error mapping
// (FacultyAllocationValidationError -> 400,
// FacultyAllocationPeriodTakenError/FacultyAllocationStaffConflictError
// -> 409, FacultyAllocationClassNotFoundError/
// FacultyAllocationPeriodNotFoundError/FacultyAllocationStaffNotFoundError
// -> 404) is proven against academicService's actual behavior hitting
// real DB constraints, not hand-thrown errors standing in for them.
//
// Classes and periods are seeded directly through the admin pool, not
// through their own APIs — this file's job is to exercise the
// allocation endpoint, not re-prove classes.test.js/
// timetable-periods.test.js's own coverage.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedPrincipalPosition, seedClassTutorPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'FacAllocTestPass123!';

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

function del(baseUrl, path, headers) {
  return requestJson(baseUrl, path, 'DELETE', { headers });
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
  const college = { collegeId: `fac${label}${suffix}`, subdomain: `factenant${label}${suffix}` };
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)', [
    college.collegeId,
    college.subdomain,
  ]);
  const passwordHash = await security.hashPassword(PASSWORD);
  const userIds = {};
  for (const username of ['principaluser', 'staffuser', 'teacher1', 'teacher2']) {
    const role = username === 'principaluser' ? 'principal' : 'staff';
    // eslint-disable-next-line no-await-in-loop
    const result = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [college.collegeId, username, `${username}@example.com`, passwordHash, role],
    );
    userIds[username] = result.rows[0].id;
  }
  await seedPrincipalPosition(adminPool, { collegeId: college.collegeId, userId: userIds.principaluser, passwordHash });

  // visibilityService.assertCanViewStaff (GET /faculty-allocation?
  // staff_user_id=...) resolves via staffRepository.findByUserId — a
  // real staff profile row, not just a users row, same as real staff
  // onboarding always creates both together. teacher1/teacher2 need
  // one for the staff_user_id-scoped list test below.
  for (const username of ['teacher1', 'teacher2']) {
    // eslint-disable-next-line no-await-in-loop
    await adminPool.query(`INSERT INTO staff (college_id, user_id, full_name) VALUES ($1, $2, $3)`, [
      college.collegeId,
      userIds[username],
      username,
    ]);
  }

  const class1 = await adminPool.query(
    `INSERT INTO classes (college_id, class_name) VALUES ($1, 'Fac Alloc Class One') RETURNING id`,
    [college.collegeId],
  );
  // visibilityService scopes 'staff' reads to SELF_ASSIGNED (own
  // tutor/faculty-allocated classes only) — staffuser is made class1's
  // tutor so the "read is allowed for staff" RBAC test below has a
  // real assignment to be visible through, not a leftover assumption
  // from before that scoping existed. Phase 2 step 19: this moved off
  // classes.tutor_user_id onto the real Position/Account/Occupant
  // fixture.
  const { officialEmail: staffuserClassTutorEmail } = await seedClassTutorPosition(adminPool, {
    collegeId: college.collegeId,
    userId: userIds.staffuser,
    classId: class1.rows[0].id,
    passwordHash,
  });
  const class2 = await adminPool.query(
    `INSERT INTO classes (college_id, class_name) VALUES ($1, 'Fac Alloc Class Two') RETURNING id`,
    [college.collegeId],
  );
  const period1 = await adminPool.query(
    `INSERT INTO timetable_periods (college_id, day_of_week, hour_index, start_time, end_time)
     VALUES ($1, 'Monday', 1, '09:00', '10:00') RETURNING id`,
    [college.collegeId],
  );
  const period2 = await adminPool.query(
    `INSERT INTO timetable_periods (college_id, day_of_week, hour_index, start_time, end_time)
     VALUES ($1, 'Monday', 2, '10:00', '11:00') RETURNING id`,
    [college.collegeId],
  );

  return {
    ...college,
    userIds,
    classIds: { class1: class1.rows[0].id, class2: class2.rows[0].id },
    periodIds: { period1: period1.rows[0].id, period2: period2.rows[0].id },
    classTutorEmail: staffuserClassTutorEmail,
  };
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM faculty_allocation WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM timetable_periods WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM classes WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('faculty allocation', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const collegeA = await seedTenant(adminPool, 'a');
  const collegeB = await seedTenant(adminPool, 'b');

  t.after(async () => {
    await stopServer(server);
    await cleanupTenant(adminPool, collegeA);
    await cleanupTenant(adminPool, collegeB);
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

  // 4-login authorization architecture (2026-08-09): staffuser's own
  // class-scoped read visibility (SELF_ASSIGNED, "own tutor/faculty-
  // allocated classes") requires the L4 Position Account login when
  // it's tutor-derived — Position Occupancy alone (staffuser's
  // personal login) no longer widens read scope either.
  async function loginTutor(college) {
    const resp = await requestJson(baseUrl, '/api/v1/position-accounts/login', 'POST', {
      headers: { host: hostFor(college.subdomain) },
      body: { official_email: college.classTutorEmail, password: PASSWORD },
    });
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  // --- Basic mechanics ---

  await t.test('create (assign) returns 201 with the created row, snake_case', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/faculty-allocation', headersFor(collegeA, token), {
      class_id: collegeA.classIds.class1,
      period_id: collegeA.periodIds.period1,
      subject: 'DBMS',
      staff_user_id: collegeA.userIds.teacher1,
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.class_id, collegeA.classIds.class1);
    assert.equal(resp.body.period_id, collegeA.periodIds.period1);
    assert.equal(resp.body.subject, 'DBMS');
    assert.equal(resp.body.staff_user_id, collegeA.userIds.teacher1);
    assert.equal(resp.body.college_id, collegeA.collegeId);
  });

  await t.test('create rejects a missing staff_user_id with 400, not a 500', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/faculty-allocation', headersFor(collegeA, token), {
      class_id: collegeA.classIds.class1,
      period_id: collegeA.periodIds.period2,
      subject: 'Networks',
    });
    assert.equal(resp.status, 400);
  });

  await t.test('create on a duplicate (class_id, period_id) is a real 409', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/faculty-allocation', headersFor(collegeA, token), {
      class_id: collegeA.classIds.class1,
      period_id: collegeA.periodIds.period1,
      subject: 'Something Else',
      staff_user_id: collegeA.userIds.teacher2,
    });
    assert.equal(resp.status, 409);
  });

  await t.test('create double-booking a staff member across two classes at the same period is a real 409', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/faculty-allocation', headersFor(collegeA, token), {
      class_id: collegeA.classIds.class2,
      period_id: collegeA.periodIds.period1,
      subject: 'Networks',
      staff_user_id: collegeA.userIds.teacher1,
    });
    assert.equal(resp.status, 409);
  });

  await t.test('create with a nonexistent class_id returns 404, not a 500', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/faculty-allocation', headersFor(collegeA, token), {
      class_id: crypto.randomUUID(),
      period_id: collegeA.periodIds.period2,
      subject: 'Ghost',
      staff_user_id: collegeA.userIds.teacher2,
    });
    assert.equal(resp.status, 404);
  });

  await t.test('create with a nonexistent period_id returns 404', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/faculty-allocation', headersFor(collegeA, token), {
      class_id: collegeA.classIds.class2,
      period_id: crypto.randomUUID(),
      subject: 'Ghost',
      staff_user_id: collegeA.userIds.teacher2,
    });
    assert.equal(resp.status, 404);
  });

  await t.test('create with a nonexistent staff_user_id returns 404', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/faculty-allocation', headersFor(collegeA, token), {
      class_id: collegeA.classIds.class2,
      period_id: collegeA.periodIds.period2,
      subject: 'Ghost',
      staff_user_id: crypto.randomUUID(),
    });
    assert.equal(resp.status, 404);
  });

  await t.test('a second class can share the same period with a different staff member', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/faculty-allocation', headersFor(collegeA, token), {
      class_id: collegeA.classIds.class2,
      period_id: collegeA.periodIds.period1,
      subject: 'Networks',
      staff_user_id: collegeA.userIds.teacher2,
    });
    assert.equal(resp.status, 201);
  });

  await t.test('get by id returns 200 for an existing allocation, 404 for an unknown id', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/faculty-allocation', headersFor(collegeA, token), {
      class_id: collegeA.classIds.class1,
      period_id: collegeA.periodIds.period2,
      subject: 'Library',
      staff_user_id: collegeA.userIds.teacher2,
    });
    const found = await get(baseUrl, `/api/v1/faculty-allocation/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(found.status, 200);
    assert.equal(found.body.id, created.body.id);

    const missing = await get(
      baseUrl,
      `/api/v1/faculty-allocation/${crypto.randomUUID()}`,
      headersFor(collegeA, token),
    );
    assert.equal(missing.status, 404);
  });

  await t.test('list requires either class_id or staff_user_id', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await get(baseUrl, '/api/v1/faculty-allocation', headersFor(collegeA, token));
    assert.equal(resp.status, 400);
  });

  await t.test('list rejects both class_id and staff_user_id together', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await get(
      baseUrl,
      `/api/v1/faculty-allocation?class_id=${collegeA.classIds.class1}&staff_user_id=${collegeA.userIds.teacher1}`,
      headersFor(collegeA, token),
    );
    assert.equal(resp.status, 400);
  });

  await t.test("list by class_id returns that class's allocations", async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await get(
      baseUrl,
      `/api/v1/faculty-allocation?class_id=${collegeA.classIds.class1}`,
      headersFor(collegeA, token),
    );
    assert.equal(resp.status, 200);
    assert.ok(resp.body.length >= 1);
    assert.ok(resp.body.every((row) => row.class_id === collegeA.classIds.class1));
  });

  await t.test("list by staff_user_id returns that staff member's allocations", async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await get(
      baseUrl,
      `/api/v1/faculty-allocation?staff_user_id=${collegeA.userIds.teacher1}`,
      headersFor(collegeA, token),
    );
    assert.equal(resp.status, 200);
    assert.ok(resp.body.length >= 1);
    assert.ok(resp.body.every((row) => row.staff_user_id === collegeA.userIds.teacher1));
  });

  await t.test('delete removes the row and returns 204; a second delete 404s', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/faculty-allocation', headersFor(collegeA, token), {
      class_id: collegeA.classIds.class2,
      period_id: collegeA.periodIds.period2,
      subject: 'Deletable Subject',
      staff_user_id: collegeA.userIds.teacher1,
    });
    assert.equal(created.status, 201);

    const firstDelete = await del(
      baseUrl,
      `/api/v1/faculty-allocation/${created.body.id}`,
      headersFor(collegeA, token),
    );
    assert.equal(firstDelete.status, 204);

    const getAfter = await get(baseUrl, `/api/v1/faculty-allocation/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(getAfter.status, 404);

    const secondDelete = await del(
      baseUrl,
      `/api/v1/faculty-allocation/${created.body.id}`,
      headersFor(collegeA, token),
    );
    assert.equal(secondDelete.status, 404);
  });

  // --- RBAC ---

  await t.test('create is rejected for a non-principal role', async () => {
    const token = await login(collegeA, 'staffuser');
    const resp = await post(baseUrl, '/api/v1/faculty-allocation', headersFor(collegeA, token), {
      class_id: collegeA.classIds.class1,
      period_id: collegeA.periodIds.period1,
      subject: 'Rbac Test',
      staff_user_id: collegeA.userIds.teacher1,
    });
    assert.equal(resp.status, 403);
  });

  await t.test('create requires authentication', async () => {
    const resp = await post(baseUrl, '/api/v1/faculty-allocation', headersFor(collegeA), {
      class_id: collegeA.classIds.class1,
      period_id: collegeA.periodIds.period1,
      subject: 'Rbac Test',
      staff_user_id: collegeA.userIds.teacher1,
    });
    assert.equal(resp.status, 401);
  });

  await t.test('read is allowed for the L4 Class Tutor Position Account login, not just principal', async () => {
    const tutorToken = await loginTutor(collegeA);
    const resp = await get(
      baseUrl,
      `/api/v1/faculty-allocation?class_id=${collegeA.classIds.class1}`,
      headersFor(collegeA, tutorToken),
    );
    assert.equal(resp.status, 200);
  });

  // 4-login authorization architecture (2026-08-09) — the critical
  // regression case: staffuser genuinely occupies class1's L4 seat,
  // but this request uses staffuser's PERSONAL login. Position
  // Occupancy alone must not widen this read scope either.
  await t.test(
    "read is rejected for staffuser's personal login even though that person currently occupies class1's L4 seat",
    async () => {
      const staffToken = await login(collegeA, 'staffuser');
      const resp = await get(
        baseUrl,
        `/api/v1/faculty-allocation?class_id=${collegeA.classIds.class1}`,
        headersFor(collegeA, staffToken),
      );
      assert.equal(resp.status, 403);
    },
  );

  await t.test('read requires authentication', async () => {
    const resp = await get(
      baseUrl,
      `/api/v1/faculty-allocation?class_id=${collegeA.classIds.class1}`,
      headersFor(collegeA),
    );
    assert.equal(resp.status, 401);
  });

  // --- Cross-tenant isolation ---

  await t.test('an allocation from tenant A is invisible to tenant B', async () => {
    const tokenA = await login(collegeA, 'principaluser');
    const tokenB = await login(collegeB, 'principaluser');

    // Fresh class/period/staff, not reused from any earlier subtest in
    // this file, so this create can't collide with a prior allocation.
    const cls = await adminPool.query(
      `INSERT INTO classes (college_id, class_name) VALUES ($1, 'Cross Tenant Check Class') RETURNING id`,
      [collegeA.collegeId],
    );
    const period = await adminPool.query(
      `INSERT INTO timetable_periods (college_id, day_of_week, hour_index, start_time, end_time)
       VALUES ($1, 'Wednesday', 7, '15:00', '16:00') RETURNING id`,
      [collegeA.collegeId],
    );

    const respA = await post(baseUrl, '/api/v1/faculty-allocation', headersFor(collegeA, tokenA), {
      class_id: cls.rows[0].id,
      period_id: period.rows[0].id,
      subject: 'Cross Tenant Check',
      staff_user_id: collegeA.userIds.teacher1,
    });
    assert.equal(respA.status, 201);

    const getFromB = await get(baseUrl, `/api/v1/faculty-allocation/${respA.body.id}`, headersFor(collegeB, tokenB));
    assert.equal(getFromB.status, 404);
  });

  // --- Audit attribution ---

  await t.test('a create writes exactly one audit_log row, attributed to the actor', async () => {
    const token = await login(collegeA, 'principaluser');
    const passwordHash = await security.hashPassword(PASSWORD);
    const cls = await adminPool.query(
      `INSERT INTO classes (college_id, class_name) VALUES ($1, 'Fac Alloc Audit Class') RETURNING id`,
      [collegeA.collegeId],
    );
    const period = await adminPool.query(
      `INSERT INTO timetable_periods (college_id, day_of_week, hour_index, start_time, end_time)
       VALUES ($1, 'Tuesday', 5, '13:00', '14:00') RETURNING id`,
      [collegeA.collegeId],
    );
    const teacher = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, 'facauditteacher', 'facauditteacher@example.com', $2, 'staff', true) RETURNING id`,
      [collegeA.collegeId, passwordHash],
    );

    const resp = await post(baseUrl, '/api/v1/faculty-allocation', headersFor(collegeA, token), {
      class_id: cls.rows[0].id,
      period_id: period.rows[0].id,
      subject: 'Audited Subject',
      staff_user_id: teacher.rows[0].id,
    });
    assert.equal(resp.status, 201);

    const row = await adminPool.query(
      `SELECT user_id, entity, entity_id FROM audit_log
       WHERE college_id = $1 AND entity_id = $2 AND action = 'faculty_allocation_assigned'`,
      [collegeA.collegeId, resp.body.id],
    );
    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0].entity, 'faculty_allocation');
    assert.equal(row.rows[0].user_id, collegeA.userIds.principaluser);
  });
});
