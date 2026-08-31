'use strict';

// Integration tests for the classes API — real HTTP requests against a
// live Postgres, same discipline as staff.test.js: error mapping
// (ClassValidationError -> 400, ClassTimetableStatusError -> 400,
// ClassNameConflictError -> 409, ClassTutorConflictError -> 409,
// ClassTutorNotFoundError -> 404) is proven against academicService's
// actual behavior hitting real DB constraints, not hand-thrown errors
// standing in for them.
//
// Like staff.user_id, classes.tutor_user_id is FK'd to users.id (but
// nullable, unlike staff.user_id) — seedTenant provisions a spare
// already-provisioned account ('subjectuser', role 'staff') per tenant
// to name as a tutor, distinct from 'principaluser' (the actor who
// authenticates and creates/updates classes) and 'staffuser' (used for
// the read-RBAC checks, same as staff.test.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const {
  seedPrincipalPosition,
  seedHodPosition,
  seedClassTutorPosition,
  cleanupPositionRows,
} = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'ClassesTestPass123!';

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
  const college = { collegeId: `cls${label}${suffix}`, subdomain: `clstenant${label}${suffix}` };
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)', [
    college.collegeId,
    college.subdomain,
  ]);
  const passwordHash = await security.hashPassword(PASSWORD);
  const userIds = {};
  // 'subjectuser'/'subjectuser2' stand in for already-provisioned
  // faculty accounts an HOD names as a Class Tutor via POST/PUT
  // /classes/:id/tutor (Phase 2 step 18) — distinct from 'principaluser'
  // (the actor for plain class create/update/delete), 'hoduser' (the
  // Class Tutor assignment actor), and 'staffuser' (read-RBAC only),
  // same split staff.test.js uses.
  for (const username of ['principaluser', 'staffuser', 'subjectuser', 'subjectuser2', 'hoduser', 'otherhoduser']) {
    const role =
      username === 'principaluser'
        ? 'principal'
        : username === 'hoduser' || username === 'otherhoduser'
          ? 'hod'
          : 'staff';
    // eslint-disable-next-line no-await-in-loop
    const result = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [college.collegeId, username, `${username}@example.com`, passwordHash, role],
    );
    userIds[username] = result.rows[0].id;
  }
  await seedPrincipalPosition(adminPool, { collegeId: college.collegeId, userId: userIds.principaluser, passwordHash });

  // A department 'hoduser' heads (for the Class Tutor
  // assignment/reassignment tests) and a second, DIFFERENT department
  // 'otherhoduser' heads (to prove the own-department scope check).
  const deptResult = await adminPool.query('INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id', [
    college.collegeId,
    'CSE',
  ]);
  const departmentId = deptResult.rows[0].id;
  await seedHodPosition(adminPool, {
    collegeId: college.collegeId,
    userId: userIds.hoduser,
    departmentId,
    passwordHash,
  });

  const otherDeptResult = await adminPool.query(
    'INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id',
    [college.collegeId, 'ECE'],
  );
  const otherDepartmentId = otherDeptResult.rows[0].id;
  await seedHodPosition(adminPool, {
    collegeId: college.collegeId,
    userId: userIds.otherhoduser,
    departmentId: otherDepartmentId,
    passwordHash,
  });

  // visibilityService.assertIsHodOfDepartment (reused by
  // classTutorService.assignClassTutor/reassignClassTutor for the
  // own-department scope check) resolves the department's real HOD via
  // staffService.findHodForDepartment — the legacy `staff`
  // table+users.role join, not yet migrated onto the Position model —
  // so a `staff` row is required here too, alongside seedHodPosition's
  // Position/Account/Occupant rows (which only satisfy
  // requirePermission's identityService-resolved effectiveRole check).
  await adminPool.query('INSERT INTO staff (college_id, user_id, full_name, department_id) VALUES ($1, $2, $3, $4)', [
    college.collegeId,
    userIds.hoduser,
    'Hod User',
    departmentId,
  ]);
  await adminPool.query('INSERT INTO staff (college_id, user_id, full_name, department_id) VALUES ($1, $2, $3, $4)', [
    college.collegeId,
    userIds.otherhoduser,
    'Other Hod User',
    otherDepartmentId,
  ]);

  return {
    ...college,
    userIds,
    departmentId,
    otherDepartmentId,
  };
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM classes WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM departments WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('classes', async (t) => {
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

  // --- Basic mechanics ---

  await t.test('create returns 201 with the created row, snake_case', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: '3rd Sem · CS-A',
      department: 'CSE',
      semester: '3rd Sem',
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.class_name, '3rd Sem · CS-A');
    assert.equal(resp.body.department, 'CSE');
    assert.equal(resp.body.college_id, collegeA.collegeId);
    assert.equal(resp.body.timetable_status, 'No Tutor');
  });

  await t.test('create rejects a missing class_name with 400, not a 500', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      department: 'CSE',
    });
    assert.equal(resp.status, 400);
  });

  await t.test('create rejects an unknown timetable_status with 400', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Bad Status Class',
      timetable_status: 'On Hold',
    });
    assert.equal(resp.status, 400);
  });

  // Phase 2 step 20: classes.tutor_user_id is gone entirely (dropped
  // by migration) — a class is created with no tutor concept at all
  // now, not "tutor_user_id: null".
  await t.test('create does not require a tutor and the response carries no tutor_user_id field', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'No Tutor Yet Class',
    });
    assert.equal(resp.status, 201);
    assert.equal('tutor_user_id' in resp.body, false);
  });

  await t.test(
    'create on a duplicate class_name within the same tenant is a real 409, from a real DB constraint',
    async () => {
      const token = await login(collegeA, 'principaluser');
      const first = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
        class_name: 'Dup Class Name',
      });
      assert.equal(first.status, 201);

      const dup = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
        class_name: 'Dup Class Name',
      });
      assert.equal(dup.status, 409);
    },
  );

  // Phase 2 step 18: tutor_user_id is no longer accepted by
  // POST/PUT /classes/:id at all — an explicit 400, not a silent no-op
  // (dropping it would look like it worked). Class Tutor assignment now
  // only goes through POST/PUT /classes/:id/tutor (HOD-only,
  // own-department), see the dedicated block below.
  await t.test('create rejects a tutor_user_id in the body with 400, not a silent no-op', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Reject Tutor At Create Class',
      tutor_user_id: collegeA.userIds.subjectuser,
    });
    assert.equal(resp.status, 400);
  });

  await t.test('two classes can independently have no tutor at all', async () => {
    const token = await login(collegeA, 'principaluser');
    const first = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'No Tutor Class One',
    });
    const second = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'No Tutor Class Two',
    });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
  });

  await t.test('an aadhaar-shaped field is silently dropped, never stored or echoed back', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'No Aadhaar Here Class',
      aadhaar_number: '1234-5678-9012',
    });
    assert.equal(resp.status, 201);
    assert.equal('aadhaar_number' in resp.body, false);
  });

  await t.test('get by id returns 200 for an existing class row, 404 for an unknown id', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Gettable Class',
    });
    const found = await get(baseUrl, `/api/v1/classes/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(found.status, 200);
    assert.equal(found.body.id, created.body.id);

    const missing = await get(baseUrl, `/api/v1/classes/${crypto.randomUUID()}`, headersFor(collegeA, token));
    assert.equal(missing.status, 404);
  });

  await t.test('list returns an array and respects limit', async () => {
    const token = await login(collegeA, 'principaluser');
    await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), { class_name: 'List Class One' });
    await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), { class_name: 'List Class Two' });

    const resp = await get(baseUrl, '/api/v1/classes?limit=1', headersFor(collegeA, token));
    assert.equal(resp.status, 200);
    assert.equal(resp.body.length, 1);
  });

  await t.test('update changes a field and returns 200 with the updated row', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Before Update Class',
    });
    const updated = await put(baseUrl, `/api/v1/classes/${created.body.id}`, headersFor(collegeA, token), {
      semester: '2nd Sem',
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.semester, '2nd Sem');
  });

  await t.test('update rejects a direct attempt to set timetable_status to a workflow-managed value', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Workflow Managed Status Class',
    });
    const resp = await put(baseUrl, `/api/v1/classes/${created.body.id}`, headersFor(collegeA, token), {
      timetable_status: 'Approved',
    });
    assert.equal(resp.status, 400);
  });

  await t.test('update against an unknown id returns 404', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await put(baseUrl, `/api/v1/classes/${crypto.randomUUID()}`, headersFor(collegeA, token), {
      semester: '4th Sem',
    });
    assert.equal(resp.status, 404);
  });

  await t.test('update rejects an unknown timetable_status with 400', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Bad Status Update Class',
    });
    const resp = await put(baseUrl, `/api/v1/classes/${created.body.id}`, headersFor(collegeA, token), {
      timetable_status: 'On Hold',
    });
    assert.equal(resp.status, 400);
  });

  await t.test("update onto another class row's class_name is a real 409, from a real DB constraint", async () => {
    const token = await login(collegeA, 'principaluser');
    await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), { class_name: 'Taken Class Name' });
    const second = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Will Collide Class',
    });

    const resp = await put(baseUrl, `/api/v1/classes/${second.body.id}`, headersFor(collegeA, token), {
      class_name: 'Taken Class Name',
    });
    assert.equal(resp.status, 409);
  });

  await t.test('update rejects a tutor_user_id in the body with 400, not a silent no-op', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Reject Tutor At Update Class',
    });

    const resp = await put(baseUrl, `/api/v1/classes/${created.body.id}`, headersFor(collegeA, token), {
      tutor_user_id: collegeA.userIds.subjectuser2,
    });
    assert.equal(resp.status, 400);
  });

  await t.test('delete removes the row and returns 204; a second delete 404s', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Deletable Class',
    });

    const firstDelete = await del(baseUrl, `/api/v1/classes/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(firstDelete.status, 204);

    const getAfter = await get(baseUrl, `/api/v1/classes/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(getAfter.status, 404);

    const secondDelete = await del(baseUrl, `/api/v1/classes/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(secondDelete.status, 404);
  });

  // --- RBAC ---

  await t.test('create is rejected for a non-principal role', async () => {
    const token = await login(collegeA, 'staffuser');
    const resp = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Rbac Test Class',
    });
    assert.equal(resp.status, 403);
  });

  await t.test('create requires authentication', async () => {
    const resp = await post(baseUrl, '/api/v1/classes', headersFor(collegeA), {
      class_name: 'Rbac Test Class',
    });
    assert.equal(resp.status, 401);
  });

  // visibilityService scopes 'staff' to SELF_ASSIGNED (their own
  // faculty-allocated classes only, not every class in the college —
  // the access-leak fix this codebase's own checkpoint documents).
  //
  // 4-login authorization architecture (2026-08-09): being assigned as
  // Class Tutor (via POST /classes/:id/tutor) no longer widens
  // staffuser's own PERSONAL login's read scope — Position Occupancy
  // is informational only; only the L4 Position Account login itself
  // (assignClassTutor provisions one, with a random temporary password
  // this test has no way to obtain without a full invite/accept round
  // trip — out of scope for this read-only assertion) can read via
  // tutor authority. staffuser's personal login is correctly rejected
  // here, same as the "no assignment at all" case right below.
  await t.test(
    "read is rejected for staff's personal login even once assigned as Class Tutor (only the L4 seat login can read via tutor authority)",
    async () => {
      const principalToken = await login(collegeA, 'principaluser');
      const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, principalToken), {
        class_name: 'Readable By Staff Class',
        department_id: collegeA.departmentId,
      });

      const hodToken = await login(collegeA, 'hoduser');
      const assign = await post(baseUrl, `/api/v1/classes/${created.body.id}/tutor`, headersFor(collegeA, hodToken), {
        new_tutor_user_id: collegeA.userIds.staffuser,
      });
      assert.equal(assign.status, 201);

      const staffToken = await login(collegeA, 'staffuser');
      const resp = await get(baseUrl, `/api/v1/classes/${created.body.id}`, headersFor(collegeA, staffToken));
      assert.equal(resp.status, 403);
    },
  );

  // Positive-path counterpart to the rejection above: the genuine L4
  // Class Tutor Position Account login (POST /position-accounts/login,
  // claims.type === 'position_access', effectiveRole 'class_tutor') —
  // not a personal login — retains read access to its own class.
  // Proves visibilityService.resolveActorContext's targeted
  // actorRole === 'class_tutor' restore (added alongside the
  // personal-login leak fix) actually works end-to-end, using the same
  // seedClassTutorPosition -> officialEmail -> POST
  // /position-accounts/login pattern already proven in
  // students.test.js's loginTutor() helper — a direct DB fixture with a
  // known password, not POST /classes/:id/tutor's real invite flow
  // (which provisions a random, untestable temporary password).
  //
  // Seeds a dedicated occupant rather than reusing staffuser: staffuser
  // is already an active Class Tutor of a DIFFERENT class from the
  // negative test right above, and identityService.
  // resolveActiveClassTutorPosition's underlying query has no
  // ORDER BY/uniqueness guard against one user occupying two active
  // Class Tutor positions at once (the schema only enforces "one active
  // occupant per class" and "one active occupant per account," neither
  // of which is "one active Class Tutor position per user") — reusing
  // staffuser would make that lookup ambiguous between the two classes
  // instead of exercising the single-tutor scenario this test means to
  // prove.
  await t.test('read is allowed for the genuine L4 Class Tutor Position Account login', async () => {
    const principalToken = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, principalToken), {
      class_name: 'Readable By L4 Seat Class',
      department_id: collegeA.departmentId,
    });

    const passwordHash = await security.hashPassword(PASSWORD);
    const occupant = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, 'staff', true) RETURNING id`,
      [collegeA.collegeId, 'l4seatuser', 'l4seatuser@example.com', passwordHash],
    );
    const { officialEmail } = await seedClassTutorPosition(adminPool, {
      collegeId: collegeA.collegeId,
      userId: occupant.rows[0].id,
      classId: created.body.id,
      passwordHash,
    });

    const tutorLogin = await post(baseUrl, '/api/v1/position-accounts/login', headersFor(collegeA), {
      official_email: officialEmail,
      password: PASSWORD,
    });
    assert.equal(tutorLogin.status, 200);

    const resp = await get(
      baseUrl,
      `/api/v1/classes/${created.body.id}`,
      headersFor(collegeA, tutorLogin.body.access_token),
    );
    assert.equal(resp.status, 200);
    assert.equal(resp.body.id, created.body.id);
  });

  await t.test('read is forbidden for staff with no tutor/faculty-allocation assignment to the class', async () => {
    const principalToken = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, principalToken), {
      class_name: 'Unassigned Staff Class',
    });

    const staffToken = await login(collegeA, 'staffuser');
    const resp = await get(baseUrl, `/api/v1/classes/${created.body.id}`, headersFor(collegeA, staffToken));
    assert.equal(resp.status, 403);
  });

  await t.test('read requires authentication', async () => {
    const resp = await get(baseUrl, '/api/v1/classes', headersFor(collegeA));
    assert.equal(resp.status, 401);
  });

  // --- Class Tutor assignment/reassignment (Phase 2 step 18) ---
  // HOD-only, own-department-scoped — supersedes tutor_user_id entirely.

  await t.test('POST /classes/:id/tutor assigns a first-time Class Tutor, 201', async () => {
    const principalToken = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, principalToken), {
      class_name: 'Assign Tutor Class',
      department_id: collegeA.departmentId,
    });

    const hodToken = await login(collegeA, 'hoduser');
    const resp = await post(baseUrl, `/api/v1/classes/${created.body.id}/tutor`, headersFor(collegeA, hodToken), {
      new_tutor_user_id: collegeA.userIds.subjectuser,
    });
    assert.equal(resp.status, 201);
  });

  await t.test('POST /classes/:id/tutor on a class that already has one is a real 409', async () => {
    const principalToken = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, principalToken), {
      class_name: 'Double Assign Tutor Class',
      department_id: collegeA.departmentId,
    });

    const hodToken = await login(collegeA, 'hoduser');
    const first = await post(baseUrl, `/api/v1/classes/${created.body.id}/tutor`, headersFor(collegeA, hodToken), {
      new_tutor_user_id: collegeA.userIds.subjectuser,
    });
    assert.equal(first.status, 201);

    const second = await post(baseUrl, `/api/v1/classes/${created.body.id}/tutor`, headersFor(collegeA, hodToken), {
      new_tutor_user_id: collegeA.userIds.subjectuser2,
    });
    assert.equal(second.status, 409);
  });

  await t.test('POST /classes/:id/tutor with a nonexistent newTutorUserId is a real 404, not a 500', async () => {
    const principalToken = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, principalToken), {
      class_name: 'Ghost Tutor Assign Class',
      department_id: collegeA.departmentId,
    });

    const hodToken = await login(collegeA, 'hoduser');
    const resp = await post(baseUrl, `/api/v1/classes/${created.body.id}/tutor`, headersFor(collegeA, hodToken), {
      new_tutor_user_id: crypto.randomUUID(),
    });
    assert.equal(resp.status, 404);
  });

  await t.test('POST /classes/:id/tutor rejects a missing new_tutor_user_id with 400', async () => {
    const principalToken = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, principalToken), {
      class_name: 'Missing New Tutor Class',
      department_id: collegeA.departmentId,
    });

    const hodToken = await login(collegeA, 'hoduser');
    const resp = await post(baseUrl, `/api/v1/classes/${created.body.id}/tutor`, headersFor(collegeA, hodToken), {});
    assert.equal(resp.status, 400);
  });

  await t.test('POST /classes/:id/tutor is forbidden for the HOD of a DIFFERENT department', async () => {
    const principalToken = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, principalToken), {
      class_name: 'Wrong Dept Hod Class',
      department_id: collegeA.departmentId,
    });

    const otherHodToken = await login(collegeA, 'otherhoduser');
    const resp = await post(baseUrl, `/api/v1/classes/${created.body.id}/tutor`, headersFor(collegeA, otherHodToken), {
      new_tutor_user_id: collegeA.userIds.subjectuser,
    });
    assert.equal(resp.status, 403);
  });

  await t.test('POST /classes/:id/tutor is forbidden for a non-HOD role', async () => {
    const principalToken = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, principalToken), {
      class_name: 'Non Hod Assign Class',
      department_id: collegeA.departmentId,
    });

    const staffToken = await login(collegeA, 'staffuser');
    const resp = await post(baseUrl, `/api/v1/classes/${created.body.id}/tutor`, headersFor(collegeA, staffToken), {
      new_tutor_user_id: collegeA.userIds.subjectuser,
    });
    assert.equal(resp.status, 403);
  });

  await t.test('POST /classes/:id/tutor against a nonexistent class is a real 404', async () => {
    const hodToken = await login(collegeA, 'hoduser');
    const resp = await post(baseUrl, `/api/v1/classes/${crypto.randomUUID()}/tutor`, headersFor(collegeA, hodToken), {
      new_tutor_user_id: collegeA.userIds.subjectuser,
    });
    assert.equal(resp.status, 404);
  });

  await t.test('PUT /classes/:id/tutor reassigns an already-assigned Class Tutor to a new occupant, 200', async () => {
    const principalToken = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, principalToken), {
      class_name: 'Reassign Tutor Class',
      department_id: collegeA.departmentId,
    });

    const hodToken = await login(collegeA, 'hoduser');
    const first = await post(baseUrl, `/api/v1/classes/${created.body.id}/tutor`, headersFor(collegeA, hodToken), {
      new_tutor_user_id: collegeA.userIds.subjectuser,
    });
    assert.equal(first.status, 201);

    const reassign = await put(baseUrl, `/api/v1/classes/${created.body.id}/tutor`, headersFor(collegeA, hodToken), {
      new_tutor_user_id: collegeA.userIds.subjectuser2,
    });
    assert.equal(reassign.status, 200);
  });

  await t.test('PUT /classes/:id/tutor on a class with no active Class Tutor yet is a real 404', async () => {
    const principalToken = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, principalToken), {
      class_name: 'Reassign Without Assign Class',
      department_id: collegeA.departmentId,
    });

    const hodToken = await login(collegeA, 'hoduser');
    const resp = await put(baseUrl, `/api/v1/classes/${created.body.id}/tutor`, headersFor(collegeA, hodToken), {
      new_tutor_user_id: collegeA.userIds.subjectuser,
    });
    assert.equal(resp.status, 404);
  });

  // --- Cross-tenant isolation ---

  await t.test('the same class_name is independently usable across two tenants', async () => {
    const tokenA = await login(collegeA, 'principaluser');
    const tokenB = await login(collegeB, 'principaluser');

    const respA = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, tokenA), {
      class_name: 'Shared Class Name',
    });
    const respB = await post(baseUrl, '/api/v1/classes', headersFor(collegeB, tokenB), {
      class_name: 'Shared Class Name',
    });
    assert.equal(respA.status, 201);
    assert.equal(respB.status, 201);

    const getFromB = await get(baseUrl, `/api/v1/classes/${respA.body.id}`, headersFor(collegeB, tokenB));
    assert.equal(getFromB.status, 404);
  });

  // --- Audit attribution ---

  await t.test('a create writes exactly one audit_log row, attributed to the actor', async () => {
    const token = await login(collegeA, 'principaluser');

    const resp = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Audited Class',
    });
    assert.equal(resp.status, 201);

    const row = await adminPool.query(
      `SELECT user_id, entity, entity_id FROM audit_log
       WHERE college_id = $1 AND entity_id = $2 AND action = 'class_created'`,
      [collegeA.collegeId, resp.body.id],
    );
    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0].entity, 'classes');
    assert.equal(row.rows[0].user_id, collegeA.userIds.principaluser);
  });
});
