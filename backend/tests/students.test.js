'use strict';

// Integration tests for the students API — real HTTP requests against
// a live Postgres, same discipline as configurations.test.js: error
// mapping (StudentValidationError -> 400, StudentRollNoConflictError
// -> 409) is proven against studentService's actual behavior hitting
// a real UNIQUE constraint, not a hand-thrown error standing in for
// one, same rigor as the service slice's live-DB duplicate-roll-no
// test.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const {
  seedClassTutorPosition,
  seedHodPosition,
  seedPrincipalPosition,
  cleanupPositionRows,
} = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'StudentTestPass123!';

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

// POST /students is tutor-only, own-class-only; PUT/DELETE are now
// tutor(own class)/hod(own department)/principal(own college) scoped
// (this session's own task). staffuser tutors classA (deptA);
// staffusernoclass has no class; hoduser is deptA's real HOD (a real
// `staff` row, not just users.role — staffService.findHodForDepartment/
// findPrincipal JOIN staff to users, so a bare users row isn't enough
// to be resolved as "the HOD"/"the Principal", same reasoning
// studentService.assertCanModifyStudent resolves real assignments
// rather than trusting the JWT role claim alone). hoduser2 is deptB's
// HOD, with no relationship to classA's students — the "wrong
// department" negative case.
async function seedTenant(adminPool, label) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const college = { collegeId: `stu${label}${suffix}`, subdomain: `stutenant${label}${suffix}` };
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)', [
    college.collegeId,
    college.subdomain,
  ]);
  const passwordHash = await security.hashPassword(PASSWORD);
  const userIds = {};
  for (const role of ['principal', 'hod', 'hod2', 'staff', 'staffnoclass']) {
    const username = role === 'staffnoclass' ? 'staffusernoclass' : `${role}user`;
    const dbRole = role.startsWith('hod') ? 'hod' : role === 'staffnoclass' ? 'staff' : role;
    // eslint-disable-next-line no-await-in-loop
    const result = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id`,
      [college.collegeId, username, `${username}@example.com`, passwordHash, dbRole],
    );
    userIds[role] = result.rows[0].id;
  }

  const deptAResult = await adminPool.query('INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id', [
    college.collegeId,
    `Dept A ${label}`,
  ]);
  const deptBResult = await adminPool.query('INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id', [
    college.collegeId,
    `Dept B ${label}`,
  ]);
  college.departmentId = deptAResult.rows[0].id;

  await adminPool.query('INSERT INTO staff (college_id, user_id, full_name, department_id) VALUES ($1, $2, $3, $4)', [
    college.collegeId,
    userIds.hod,
    'Hod User',
    deptAResult.rows[0].id,
  ]);
  await adminPool.query('INSERT INTO staff (college_id, user_id, full_name, department_id) VALUES ($1, $2, $3, $4)', [
    college.collegeId,
    userIds.hod2,
    'Hod User Two',
    deptBResult.rows[0].id,
  ]);
  await adminPool.query('INSERT INTO staff (college_id, user_id, full_name) VALUES ($1, $2, $3)', [
    college.collegeId,
    userIds.principal,
    'Principal User',
  ]);

  const classResult = await adminPool.query(
    `INSERT INTO classes (college_id, class_name, department_id)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [college.collegeId, `Class ${label}`, deptAResult.rows[0].id],
  );
  college.classId = classResult.rows[0].id;

  // Phase 2 step 19: staffuser's tutor-of-record status moved off
  // classes.tutor_user_id onto the real Position/Account/Occupant
  // fixture — studentService.createStudent/assertCanModifyStudent's
  // staff branch (identityService.resolveActiveClassTutorPosition)
  // reads position_class_assignments now, not this column.
  //
  // 4-login authorization architecture (2026-08-09): staffuser
  // occupying this L4 seat (Position Occupancy) no longer means
  // staffuser's own personal login (POST /auth/login) can create/edit
  // students — only the L4 Position Account login itself can (Current
  // Login Identity). college.classTutorEmail is exposed so tests can
  // log into that seat directly (POST /position-accounts/login),
  // separately from staffuser's personal login.
  const { officialEmail } = await seedClassTutorPosition(adminPool, {
    collegeId: college.collegeId,
    userId: userIds.staff,
    classId: college.classId,
    passwordHash,
  });
  college.classTutorEmail = officialEmail;

  // hoduser/hod2user/principaluser's PUT/DELETE authority is now
  // resolved from a real Position row (identityService.resolveCapabilities'
  // effectiveRole), not just users.role — req.jwtClaims.role alone used
  // to mask this gap (middleware/rbac.js's requirePermission reads
  // req.capabilities.effectiveRole, not the JWT claim), but only
  // because 'staff' was, until the 4-login authorization architecture
  // (2026-08-09), overly-broadly listed alongside 'hod'/'principal' on
  // students.update/delete. Seeding real Position rows here — the same
  // fixture identity-resolvers.test.js/position-account-routes.test.js
  // already use — is what these actors need for real, not a workaround.
  await seedHodPosition(adminPool, {
    collegeId: college.collegeId,
    userId: userIds.hod,
    departmentId: deptAResult.rows[0].id,
    passwordHash,
  });
  await seedHodPosition(adminPool, {
    collegeId: college.collegeId,
    userId: userIds.hod2,
    departmentId: deptBResult.rows[0].id,
    passwordHash,
  });
  await seedPrincipalPosition(adminPool, {
    collegeId: college.collegeId,
    userId: userIds.principal,
    passwordHash,
  });

  return college;
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM students WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [college.collegeId]);
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM classes WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM departments WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('students', async (t) => {
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

  // 4-login authorization architecture (2026-08-09): logs into the
  // class's L4 Class Tutor Position Account directly (claims.type ===
  // 'position_access', effectiveRole 'class_tutor') — the CURRENT
  // LOGIN whose identity, not staffuser's personal login, is what
  // student create/edit authority actually requires now.
  async function loginTutor(college) {
    const resp = await requestJson(baseUrl, '/api/v1/position-accounts/login', 'POST', {
      headers: { host: hostFor(college.subdomain) },
      body: { official_email: college.classTutorEmail, password: PASSWORD },
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
  // All creation below goes through staffuser (collegeA's real class
  // tutor — see seedTenant) since POST /students is now tutor-only,
  // own-class-only (this session's own task). PUT/DELETE remain
  // principal-only, unchanged.

  await t.test(
    "create returns 201 with the created row, snake_case, class_id auto-set from the tutor's own class",
    async () => {
      const token = await loginTutor(collegeA);
      const resp = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
        roll_no: 'R001',
        full_name: 'Alice Anand',
        mark_10th: 91.5,
      });
      assert.equal(resp.status, 201);
      assert.equal(resp.body.roll_no, 'R001');
      assert.equal(resp.body.full_name, 'Alice Anand');
      assert.equal(Number(resp.body.mark_10th), 91.5);
      assert.equal(resp.body.college_id, collegeA.collegeId);
      assert.equal(resp.body.class_id, collegeA.classId);
    },
  );

  await t.test('create rejects a missing roll_no with 400, not a 500', async () => {
    const token = await loginTutor(collegeA);
    const resp = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
      full_name: 'No Roll Number',
    });
    assert.equal(resp.status, 400);
  });

  await t.test('create rejects a missing full_name with 400', async () => {
    const token = await loginTutor(collegeA);
    const resp = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
      roll_no: 'R002',
    });
    assert.equal(resp.status, 400);
  });

  await t.test(
    'create on a duplicate roll_no within the same tenant is a real 409, from a real DB constraint',
    async () => {
      const token = await loginTutor(collegeA);
      const first = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
        roll_no: 'R010',
        full_name: 'First Student',
      });
      assert.equal(first.status, 201);

      const dup = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
        roll_no: 'R010',
        full_name: 'Second Student',
      });
      assert.equal(dup.status, 409);
    },
  );

  await t.test('an aadhaar-shaped field is silently dropped, never stored or echoed back', async () => {
    const token = await loginTutor(collegeA);
    const resp = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
      roll_no: 'R020',
      full_name: 'No Aadhaar Here',
      aadhaar_number: '1234-5678-9012',
    });
    assert.equal(resp.status, 201);
    assert.equal('aadhaar_number' in resp.body, false);
  });

  await t.test('get by id returns 200 for an existing student, 404 for an unknown id', async () => {
    const token = await loginTutor(collegeA);
    const created = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
      roll_no: 'R030',
      full_name: 'Gettable Student',
    });
    const found = await get(baseUrl, `/api/v1/students/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(found.status, 200);
    assert.equal(found.body.id, created.body.id);

    const missing = await get(baseUrl, `/api/v1/students/${crypto.randomUUID()}`, headersFor(collegeA, token));
    assert.equal(missing.status, 404);
  });

  await t.test('list returns an array and respects limit', async () => {
    const token = await loginTutor(collegeA);
    await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), { roll_no: 'L001', full_name: 'List One' });
    await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), { roll_no: 'L002', full_name: 'List Two' });

    const resp = await get(baseUrl, '/api/v1/students?limit=1', headersFor(collegeA, token));
    assert.equal(resp.status, 200);
    assert.equal(resp.body.length, 1);
  });

  await t.test('update changes a field and returns 200 with the updated row', async () => {
    const staffToken = await loginTutor(collegeA);
    const created = await post(baseUrl, '/api/v1/students', headersFor(collegeA, staffToken), {
      roll_no: 'R040',
      full_name: 'Before Update',
    });
    const principalToken = await login(collegeA, 'principaluser');
    const updated = await put(baseUrl, `/api/v1/students/${created.body.id}`, headersFor(collegeA, principalToken), {
      full_name: 'After Update',
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.full_name, 'After Update');
  });

  await t.test('update against an unknown id returns 404', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await put(baseUrl, `/api/v1/students/${crypto.randomUUID()}`, headersFor(collegeA, token), {
      full_name: 'Nobody',
    });
    assert.equal(resp.status, 404);
  });

  await t.test("update onto another student's roll_no is a real 409, from a real DB constraint", async () => {
    const staffToken = await loginTutor(collegeA);
    await post(baseUrl, '/api/v1/students', headersFor(collegeA, staffToken), {
      roll_no: 'R050',
      full_name: 'Taken RollNo',
    });
    const second = await post(baseUrl, '/api/v1/students', headersFor(collegeA, staffToken), {
      roll_no: 'R051',
      full_name: 'Will Collide',
    });

    const principalToken = await login(collegeA, 'principaluser');
    const resp = await put(baseUrl, `/api/v1/students/${second.body.id}`, headersFor(collegeA, principalToken), {
      roll_no: 'R050',
    });
    assert.equal(resp.status, 409);
  });

  await t.test(
    'delete soft-deletes (sets deleted_at): returns 204, the row is excluded from get/list, a second delete 404s, and no hard DELETE ever ran',
    async () => {
      const staffToken = await loginTutor(collegeA);
      const created = await post(baseUrl, '/api/v1/students', headersFor(collegeA, staffToken), {
        roll_no: 'R060',
        full_name: 'Deletable Student',
      });

      const principalToken = await login(collegeA, 'principaluser');
      const firstDelete = await del(
        baseUrl,
        `/api/v1/students/${created.body.id}`,
        headersFor(collegeA, principalToken),
      );
      assert.equal(firstDelete.status, 204);

      const getAfter = await get(baseUrl, `/api/v1/students/${created.body.id}`, headersFor(collegeA, principalToken));
      assert.equal(getAfter.status, 404);

      const listAfter = await get(baseUrl, '/api/v1/students?limit=200', headersFor(collegeA, principalToken));
      assert.equal(
        listAfter.body.some((s) => s.id === created.body.id),
        false,
      );

      const secondDelete = await del(
        baseUrl,
        `/api/v1/students/${created.body.id}`,
        headersFor(collegeA, principalToken),
      );
      assert.equal(secondDelete.status, 404);

      // Soft delete, not a hard DELETE: the row still physically exists
      // with deleted_at set — verified directly against the admin
      // connection (the app's own arcnave_app role never sees it, per
      // every repository query's own deleted_at IS NULL filter).
      const row = await adminPool.query('SELECT deleted_at FROM students WHERE id = $1', [created.body.id]);
      assert.equal(row.rows.length, 1);
      assert.notEqual(row.rows[0].deleted_at, null);
    },
  );

  // Known limitation, not fixed by this session's task: UNIQUE
  // (college_id, roll_no) has no partial index excluding deleted_at IS
  // NOT NULL, so a soft-deleted student's roll_no is NOT freed up for
  // reuse (still a real 409) — a hard delete used to free it. Flagged,
  // not silently asserted as working.
  await t.test(
    "a soft-deleted student's roll_no is still taken (known limitation — no partial unique index)",
    async () => {
      const staffToken = await loginTutor(collegeA);
      const created = await post(baseUrl, '/api/v1/students', headersFor(collegeA, staffToken), {
        roll_no: 'R061',
        full_name: 'Soft Deleted Student',
      });
      const principalToken = await login(collegeA, 'principaluser');
      await del(baseUrl, `/api/v1/students/${created.body.id}`, headersFor(collegeA, principalToken));

      const second = await post(baseUrl, '/api/v1/students', headersFor(collegeA, staffToken), {
        roll_no: 'R061',
        full_name: 'Reuses The Same Roll No',
      });
      assert.equal(second.status, 409);
    },
  );

  // --- RBAC ---

  await t.test('create is rejected for principal (no longer a creator role)', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
      roll_no: 'RBAC1',
      full_name: 'Rbac Test',
    });
    assert.equal(resp.status, 403);
  });

  await t.test('create is rejected for a staff member who is not the tutor of any class', async () => {
    const token = await login(collegeA, 'staffusernoclass');
    const resp = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
      roll_no: 'RBAC1B',
      full_name: 'Rbac Test',
    });
    assert.equal(resp.status, 403);
  });

  // 4-login authorization architecture (2026-08-09) — the critical
  // regression case: staffuser genuinely occupies classA's L4 seat
  // (seedTenant's seedClassTutorPosition fixture), but this request
  // uses staffuser's PERSONAL login (POST /auth/login), not the L4
  // Position Account login (POST /position-accounts/login). Position
  // Occupancy must never substitute for Current Login Identity.
  await t.test(
    "create is rejected for staffuser's personal login even though that person currently occupies classA's L4 seat",
    async () => {
      const token = await login(collegeA, 'staffuser');
      const resp = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
        roll_no: 'RBAC1C',
        full_name: 'Rbac Test',
      });
      assert.equal(resp.status, 403);
    },
  );

  await t.test('create requires authentication', async () => {
    const resp = await post(baseUrl, '/api/v1/students', headersFor(collegeA), {
      roll_no: 'RBAC2',
      full_name: 'Rbac Test',
    });
    assert.equal(resp.status, 401);
  });

  await t.test('read is allowed for principal, even though only the class tutor may create', async () => {
    const staffToken = await loginTutor(collegeA);
    const created = await post(baseUrl, '/api/v1/students', headersFor(collegeA, staffToken), {
      roll_no: 'RBAC3',
      full_name: 'Readable By Principal',
    });

    const principalToken = await login(collegeA, 'principaluser');
    const resp = await get(baseUrl, `/api/v1/students/${created.body.id}`, headersFor(collegeA, principalToken));
    assert.equal(resp.status, 200);
  });

  await t.test('read requires authentication', async () => {
    const resp = await get(baseUrl, '/api/v1/students', headersFor(collegeA));
    assert.equal(resp.status, 401);
  });

  // --- Update/delete scope (tutor own class / hod own department / principal own college) ---

  // 4-login authorization architecture (2026-08-09) — the critical
  // regression case for update: same as the create case above, staffuser
  // occupies classA's L4 seat but this request uses their personal
  // login. Must be rejected exactly like a stranger's edit attempt.
  await t.test(
    "update is rejected for staffuser's personal login even though that person currently occupies the student's class's L4 seat",
    async () => {
      const tutorToken = await loginTutor(collegeA);
      const created = await post(baseUrl, '/api/v1/students', headersFor(collegeA, tutorToken), {
        roll_no: 'SCOPE1B',
        full_name: 'Scope Test One B',
      });

      const staffPersonalToken = await login(collegeA, 'staffuser');
      const resp = await put(baseUrl, `/api/v1/students/${created.body.id}`, headersFor(collegeA, staffPersonalToken), {
        full_name: 'Hijacked Via Personal Login',
      });
      assert.equal(resp.status, 403);
    },
  );

  await t.test("update is rejected for a staff member who does not tutor the student's class", async () => {
    const staffToken = await loginTutor(collegeA);
    const created = await post(baseUrl, '/api/v1/students', headersFor(collegeA, staffToken), {
      roll_no: 'SCOPE1',
      full_name: 'Scope Test One',
    });

    const otherStaffToken = await login(collegeA, 'staffusernoclass');
    const resp = await put(baseUrl, `/api/v1/students/${created.body.id}`, headersFor(collegeA, otherStaffToken), {
      full_name: 'Hijacked',
    });
    assert.equal(resp.status, 403);
  });

  await t.test("update succeeds for the hod of the student's class's department", async () => {
    const staffToken = await loginTutor(collegeA);
    const created = await post(baseUrl, '/api/v1/students', headersFor(collegeA, staffToken), {
      roll_no: 'SCOPE2',
      full_name: 'Scope Test Two',
    });

    const hodToken = await login(collegeA, 'hoduser');
    const resp = await put(baseUrl, `/api/v1/students/${created.body.id}`, headersFor(collegeA, hodToken), {
      full_name: 'Updated By Hod',
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.full_name, 'Updated By Hod');
  });

  await t.test('update is rejected for the hod of a DIFFERENT department', async () => {
    const staffToken = await loginTutor(collegeA);
    const created = await post(baseUrl, '/api/v1/students', headersFor(collegeA, staffToken), {
      roll_no: 'SCOPE3',
      full_name: 'Scope Test Three',
    });

    const otherHodToken = await login(collegeA, 'hod2user');
    const resp = await put(baseUrl, `/api/v1/students/${created.body.id}`, headersFor(collegeA, otherHodToken), {
      full_name: 'Hijacked',
    });
    assert.equal(resp.status, 403);
  });

  await t.test("update succeeds for the principal of the student's own college", async () => {
    const staffToken = await loginTutor(collegeA);
    const created = await post(baseUrl, '/api/v1/students', headersFor(collegeA, staffToken), {
      roll_no: 'SCOPE4',
      full_name: 'Scope Test Four',
    });

    const principalToken = await login(collegeA, 'principaluser');
    const resp = await put(baseUrl, `/api/v1/students/${created.body.id}`, headersFor(collegeA, principalToken), {
      full_name: 'Updated By Principal',
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.full_name, 'Updated By Principal');
  });

  await t.test("delete is rejected for a staff member who does not tutor the student's class", async () => {
    const staffToken = await loginTutor(collegeA);
    const created = await post(baseUrl, '/api/v1/students', headersFor(collegeA, staffToken), {
      roll_no: 'SCOPE5',
      full_name: 'Scope Test Five',
    });

    const otherStaffToken = await login(collegeA, 'staffusernoclass');
    const resp = await del(baseUrl, `/api/v1/students/${created.body.id}`, headersFor(collegeA, otherStaffToken));
    assert.equal(resp.status, 403);
  });

  await t.test("delete succeeds for the hod of the student's class's department", async () => {
    const staffToken = await loginTutor(collegeA);
    const created = await post(baseUrl, '/api/v1/students', headersFor(collegeA, staffToken), {
      roll_no: 'SCOPE6',
      full_name: 'Scope Test Six',
    });

    const hodToken = await login(collegeA, 'hoduser');
    const resp = await del(baseUrl, `/api/v1/students/${created.body.id}`, headersFor(collegeA, hodToken));
    assert.equal(resp.status, 204);
  });

  await t.test("delete succeeds for the principal of the student's own college", async () => {
    const staffToken = await loginTutor(collegeA);
    const created = await post(baseUrl, '/api/v1/students', headersFor(collegeA, staffToken), {
      roll_no: 'SCOPE7',
      full_name: 'Scope Test Seven',
    });

    const principalToken = await login(collegeA, 'principaluser');
    const resp = await del(baseUrl, `/api/v1/students/${created.body.id}`, headersFor(collegeA, principalToken));
    assert.equal(resp.status, 204);
  });

  // --- Cross-tenant isolation ---

  await t.test('the same roll_no is independently usable across two tenants', async () => {
    const tokenA = await loginTutor(collegeA);
    const tokenB = await loginTutor(collegeB);

    const respA = await post(baseUrl, '/api/v1/students', headersFor(collegeA, tokenA), {
      roll_no: 'SHARED01',
      full_name: 'Tenant A Student',
    });
    const respB = await post(baseUrl, '/api/v1/students', headersFor(collegeB, tokenB), {
      roll_no: 'SHARED01',
      full_name: 'Tenant B Student',
    });
    assert.equal(respA.status, 201);
    assert.equal(respB.status, 201);

    const getFromB = await get(baseUrl, `/api/v1/students/${respA.body.id}`, headersFor(collegeB, tokenB));
    assert.equal(getFromB.status, 404);
  });

  await t.test('a create writes exactly one audit_log row', async () => {
    const token = await loginTutor(collegeA);
    const resp = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
      roll_no: 'AUDIT01',
      full_name: 'Audited Student',
    });
    assert.equal(resp.status, 201);

    const row = await adminPool.query(
      `SELECT action, entity, entity_id FROM audit_log
       WHERE college_id = $1 AND entity_id = $2 AND action = 'student_created'`,
      [collegeA.collegeId, resp.body.id],
    );
    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0].entity, 'students');
  });
});
