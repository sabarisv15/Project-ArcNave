'use strict';

// Integration tests for the attendance API — real HTTP requests
// against a live Postgres, same discipline as classes.test.js/
// faculty-allocation.test.js: error mapping (AttendanceValidationError
// -> 400, AttendanceClassNotFoundError -> 404,
// AttendanceTimetableNotApprovedError/AttendanceLockedError/
// AttendanceSessionConflictError -> 409, AttendanceForbiddenError ->
// 403) is proven against attendanceService's actual behavior hitting
// real DB constraints and real authorization logic, not hand-thrown
// errors standing in for them.
//
// The real point of this file: proving all three of BusinessRules.md's
// eligible markers (class tutor, HOD force-mark, and the staff member
// genuinely scheduled for the period) work end-to-end through the
// route layer — the "scheduled staff" leg in particular is the exact
// capability e36bfb8's faculty-allocation API and 576ca6b's
// attendanceService patch together were built to enable, verified
// here for the first time all the way from an HTTP request down to a
// real faculty_allocation row.
//
// Classes/periods/allocations are seeded directly through the admin
// pool, including a direct INSERT with timetable_status = 'Approved',
// for fixture speed only — a real API path now exists
// (academicService.submitTimetableForApproval/approveTimetableApproval,
// routed through WorkflowService) and is covered end-to-end in
// timetable-approval.test.js; this file isn't re-proving that chain,
// just seeding a class that's already past it.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedClassTutorPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'AttendanceTestPass123!';
// 2026-07-04 is a Saturday (confirmed while building attendanceService.js's
// own dayOfWeekName helper) — used throughout so every faculty_allocation
// seeded against 'Saturday' periods lines up with this session_date.
const SESSION_DATE = '2026-07-04';

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
  const college = { collegeId: `att${label}${suffix}`, subdomain: `atttenant${label}${suffix}` };
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)', [
    college.collegeId,
    college.subdomain,
  ]);
  const passwordHash = await security.hashPassword(PASSWORD);
  const userIds = {};
  for (const [username, role] of [
    ['principaluser', 'principal'],
    ['tutoruser', 'staff'],
    ['hoduser', 'hod'],
    ['scheduledstaffuser', 'staff'],
    ['randomstaffuser', 'staff'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const result = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [college.collegeId, username, `${username}@example.com`, passwordHash, role],
    );
    userIds[username] = result.rows[0].id;
  }

  const approvedClass = await adminPool.query(
    `INSERT INTO classes (college_id, class_name, timetable_status)
     VALUES ($1, 'Attendance API Approved Class', 'Approved') RETURNING id`,
    [college.collegeId],
  );
  const pendingClass = await adminPool.query(
    `INSERT INTO classes (college_id, class_name, timetable_status)
     VALUES ($1, 'Attendance API Pending Class', 'Pending HOD') RETURNING id`,
    [college.collegeId],
  );
  // Phase 2 step 19: tutoruser's tutor-of-record status moved off
  // classes.tutor_user_id onto the real Position/Account/Occupant
  // fixture — assertCanMark's tutor check (identityService.
  // resolvePositionOccupant) reads position_class_assignments now, not
  // this column.
  const { officialEmail: tutorEmail } = await seedClassTutorPosition(adminPool, {
    collegeId: college.collegeId,
    userId: userIds.tutoruser,
    classId: approvedClass.rows[0].id,
    passwordHash,
  });

  // Hour 3, Saturday — the one real, structured link a "scheduled
  // staff member" mark needs to succeed through.
  const scheduledPeriod = await adminPool.query(
    `INSERT INTO timetable_periods (college_id, day_of_week, hour_index, start_time, end_time)
     VALUES ($1, 'Saturday', 3, '11:00', '12:00') RETURNING id`,
    [college.collegeId],
  );
  await adminPool.query(
    `INSERT INTO faculty_allocation (college_id, class_id, period_id, subject, staff_user_id)
     VALUES ($1, $2, $3, 'Networks', $4)`,
    [college.collegeId, approvedClass.rows[0].id, scheduledPeriod.rows[0].id, userIds.scheduledstaffuser],
  );

  return {
    ...college,
    userIds,
    classIds: { approved: approvedClass.rows[0].id, pending: pendingClass.rows[0].id },
    classTutorEmail: tutorEmail,
  };
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM attendance_sessions WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM faculty_allocation WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM timetable_periods WHERE college_id = $1', [college.collegeId]);
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM classes WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('attendance', async (t) => {
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

  // 4-login authorization architecture (2026-08-09): the tutor's
  // blanket "any hour of my class" marking reach now requires the L4
  // Position Account login (actorRole 'class_tutor') — Position
  // Occupancy alone (tutoruser's personal login) no longer suffices.
  async function loginTutor(college) {
    const resp = await requestJson(baseUrl, '/api/v1/position-accounts/login', 'POST', {
      headers: { host: hostFor(college.subdomain) },
      body: { official_email: college.classTutorEmail, password: PASSWORD },
    });
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  // --- The three authorized markers, proven end-to-end ---

  await t.test('the class tutor can mark attendance: 200 with the created row, snake_case', async () => {
    const token = await loginTutor(collegeA);
    const resp = await post(baseUrl, '/api/v1/attendance', headersFor(collegeA, token), {
      class_id: collegeA.classIds.approved,
      session_date: SESSION_DATE,
      hour_index: 1,
      absent_student_ids: ['11111111-1111-1111-1111-111111111111'],
      total_students: 40,
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.class_id, collegeA.classIds.approved);
    assert.equal(resp.body.hour_index, 1);
    assert.deepEqual(resp.body.absent_student_ids, ['11111111-1111-1111-1111-111111111111']);
    assert.equal(resp.body.marked_by_user_id, collegeA.userIds.tutoruser);
    assert.equal(resp.body.college_id, collegeA.collegeId);
  });

  // 4-login authorization architecture (2026-08-09) — the critical
  // regression case: tutoruser genuinely occupies the approved class's
  // L4 seat, but this request uses tutoruser's PERSONAL login, marking
  // an hour they're not otherwise scheduled/substituted for. Position
  // Occupancy alone must not grant the tutor's blanket reach here.
  await t.test(
    "tutoruser's personal login cannot blanket-mark an hour they are not scheduled for, even though they occupy the class's L4 seat",
    async () => {
      const token = await login(collegeA, 'tutoruser');
      const resp = await post(baseUrl, '/api/v1/attendance', headersFor(collegeA, token), {
        class_id: collegeA.classIds.approved,
        session_date: SESSION_DATE,
        hour_index: 5,
        total_students: 40,
      });
      assert.equal(resp.status, 403);
    },
  );

  // RS-ATT-002/RS-CLS-009 (D3, Stage 5): ownership-based, never title-
  // based — an HOD with no ownership over this specific hour is
  // rejected the same as anyone else.
  await t.test('an HOD cannot force-mark a class they do not tutor: 403 (D3)', async () => {
    const token = await login(collegeA, 'hoduser');
    const resp = await post(baseUrl, '/api/v1/attendance', headersFor(collegeA, token), {
      class_id: collegeA.classIds.approved,
      session_date: SESSION_DATE,
      hour_index: 2,
      total_students: 40,
    });
    assert.equal(resp.status, 403);
  });

  await t.test(
    'the staff member genuinely scheduled for the period can mark it: 200, closing the flagged gap end-to-end',
    async () => {
      const token = await login(collegeA, 'scheduledstaffuser');
      const resp = await post(baseUrl, '/api/v1/attendance', headersFor(collegeA, token), {
        class_id: collegeA.classIds.approved,
        session_date: SESSION_DATE,
        hour_index: 3,
        total_students: 40,
      });
      assert.equal(resp.status, 200);
      assert.equal(resp.body.marked_by_user_id, collegeA.userIds.scheduledstaffuser);
    },
  );

  await t.test(
    'an unrelated staff member (not tutor, not HOD, not scheduled) is rejected with 403, not a 500',
    async () => {
      const token = await login(collegeA, 'randomstaffuser');
      const resp = await post(baseUrl, '/api/v1/attendance', headersFor(collegeA, token), {
        class_id: collegeA.classIds.approved,
        session_date: SESSION_DATE,
        hour_index: 4,
        total_students: 40,
      });
      assert.equal(resp.status, 403);
    },
  );

  // --- Basic mechanics ---

  await t.test('mark on a class whose timetable is not Approved returns 409, not a 500', async () => {
    const token = await loginTutor(collegeA);
    const resp = await post(baseUrl, '/api/v1/attendance', headersFor(collegeA, token), {
      class_id: collegeA.classIds.pending,
      session_date: SESSION_DATE,
      hour_index: 1,
      total_students: 40,
    });
    assert.equal(resp.status, 409);
  });

  await t.test('mark rejects a missing class_id with 400, not a 500', async () => {
    const token = await loginTutor(collegeA);
    const resp = await post(baseUrl, '/api/v1/attendance', headersFor(collegeA, token), {
      session_date: SESSION_DATE,
      hour_index: 1,
      total_students: 40,
    });
    assert.equal(resp.status, 400);
  });

  await t.test('mark with a nonexistent class_id returns 404, not a 500', async () => {
    const token = await loginTutor(collegeA);
    const resp = await post(baseUrl, '/api/v1/attendance', headersFor(collegeA, token), {
      class_id: crypto.randomUUID(),
      session_date: SESSION_DATE,
      hour_index: 1,
      total_students: 40,
    });
    assert.equal(resp.status, 404);
  });

  await t.test('re-marking the same (class, date, hour) updates the existing session, not a new one', async () => {
    const token = await loginTutor(collegeA);
    const first = await post(baseUrl, '/api/v1/attendance', headersFor(collegeA, token), {
      class_id: collegeA.classIds.approved,
      session_date: SESSION_DATE,
      hour_index: 5,
      total_students: 40,
    });
    assert.equal(first.status, 200);

    const second = await post(baseUrl, '/api/v1/attendance', headersFor(collegeA, token), {
      class_id: collegeA.classIds.approved,
      session_date: SESSION_DATE,
      hour_index: 5,
      absent_student_ids: ['22222222-2222-2222-2222-222222222222'],
      total_students: 41,
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.id, first.body.id);
    assert.deepEqual(second.body.absent_student_ids, ['22222222-2222-2222-2222-222222222222']);
    assert.equal(second.body.total_students, 41);
  });

  await t.test('a locked session cannot be modified: 409, not a 500', async () => {
    const token = await loginTutor(collegeA);
    const created = await post(baseUrl, '/api/v1/attendance', headersFor(collegeA, token), {
      class_id: collegeA.classIds.approved,
      session_date: SESSION_DATE,
      hour_index: 6,
      total_students: 40,
    });
    assert.equal(created.status, 200);

    // No real code path can lock a session yet (flagged, not solved,
    // since attendanceService.js's own patch) — the only way to reach
    // this state today is a direct UPDATE, same bypass used to reach
    // 'Approved' above.
    await adminPool.query('UPDATE attendance_sessions SET locked_at = now() WHERE id = $1', [created.body.id]);

    const resp = await post(baseUrl, '/api/v1/attendance', headersFor(collegeA, token), {
      class_id: collegeA.classIds.approved,
      session_date: SESSION_DATE,
      hour_index: 6,
      total_students: 99,
    });
    assert.equal(resp.status, 409);
  });

  await t.test('get by id returns 200 for an existing session, 404 for an unknown id', async () => {
    const token = await loginTutor(collegeA);
    const created = await post(baseUrl, '/api/v1/attendance', headersFor(collegeA, token), {
      class_id: collegeA.classIds.approved,
      session_date: SESSION_DATE,
      hour_index: 7,
      total_students: 40,
    });
    const found = await get(baseUrl, `/api/v1/attendance/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(found.status, 200);
    assert.equal(found.body.id, created.body.id);

    const missing = await get(baseUrl, `/api/v1/attendance/${crypto.randomUUID()}`, headersFor(collegeA, token));
    assert.equal(missing.status, 404);
  });

  await t.test('list requires class_id', async () => {
    const token = await loginTutor(collegeA);
    const missingClassId = await get(baseUrl, '/api/v1/attendance', headersFor(collegeA, token));
    assert.equal(missingClassId.status, 400);
  });

  await t.test("list by class_id and session_date returns this class's marked periods that day", async () => {
    const token = await loginTutor(collegeA);
    const resp = await get(
      baseUrl,
      `/api/v1/attendance?class_id=${collegeA.classIds.approved}&session_date=${SESSION_DATE}`,
      headersFor(collegeA, token),
    );
    assert.equal(resp.status, 200);
    assert.ok(Array.isArray(resp.body));
    assert.ok(resp.body.length >= 1);
    assert.ok(resp.body.every((row) => row.class_id === collegeA.classIds.approved));
  });

  await t.test('list by class_id alone (no date filter) returns all-time sessions for that class', async () => {
    const token = await loginTutor(collegeA);
    const resp = await get(
      baseUrl,
      `/api/v1/attendance?class_id=${collegeA.classIds.approved}`,
      headersFor(collegeA, token),
    );
    assert.equal(resp.status, 200);
    assert.ok(Array.isArray(resp.body));
    assert.ok(resp.body.length >= 1);
    assert.ok(resp.body.every((row) => row.class_id === collegeA.classIds.approved));
  });

  await t.test('list by class_id with start_date/end_date filters to that window', async () => {
    const token = await loginTutor(collegeA);
    const inRange = await get(
      baseUrl,
      `/api/v1/attendance?class_id=${collegeA.classIds.approved}&start_date=${SESSION_DATE}&end_date=${SESSION_DATE}`,
      headersFor(collegeA, token),
    );
    assert.equal(inRange.status, 200);
    assert.ok(inRange.body.length >= 1);

    const outOfRange = await get(
      baseUrl,
      `/api/v1/attendance?class_id=${collegeA.classIds.approved}&start_date=1900-01-01&end_date=1900-01-02`,
      headersFor(collegeA, token),
    );
    assert.equal(outOfRange.status, 200);
    assert.equal(outOfRange.body.length, 0);
  });

  // --- RBAC ---

  await t.test('mark requires authentication', async () => {
    const resp = await post(baseUrl, '/api/v1/attendance', headersFor(collegeA), {
      class_id: collegeA.classIds.approved,
      session_date: SESSION_DATE,
      hour_index: 8,
      total_students: 40,
    });
    assert.equal(resp.status, 401);
  });

  await t.test('read requires authentication', async () => {
    const resp = await get(
      baseUrl,
      `/api/v1/attendance?class_id=${collegeA.classIds.approved}&session_date=${SESSION_DATE}`,
      headersFor(collegeA),
    );
    assert.equal(resp.status, 401);
  });

  // --- Cross-tenant isolation ---

  await t.test('an attendance session from tenant A is invisible to tenant B', async () => {
    const tokenA = await loginTutor(collegeA);
    const tokenB = await loginTutor(collegeB);

    const created = await post(baseUrl, '/api/v1/attendance', headersFor(collegeA, tokenA), {
      class_id: collegeA.classIds.approved,
      session_date: SESSION_DATE,
      hour_index: 9,
      total_students: 40,
    });
    assert.equal(created.status, 200);

    const getFromB = await get(baseUrl, `/api/v1/attendance/${created.body.id}`, headersFor(collegeB, tokenB));
    assert.equal(getFromB.status, 404);
  });

  // --- Audit attribution ---

  await t.test(
    'mark then re-mark writes exactly two audit_log rows, attributed correctly and named correctly',
    async () => {
      const token = await loginTutor(collegeA);
      const created = await post(baseUrl, '/api/v1/attendance', headersFor(collegeA, token), {
        class_id: collegeA.classIds.approved,
        session_date: SESSION_DATE,
        hour_index: 10,
        total_students: 40,
      });
      assert.equal(created.status, 200);

      await post(baseUrl, '/api/v1/attendance', headersFor(collegeA, token), {
        class_id: collegeA.classIds.approved,
        session_date: SESSION_DATE,
        hour_index: 10,
        total_students: 41,
      });

      const rows = await adminPool.query(
        `SELECT action, user_id, entity FROM audit_log
       WHERE college_id = $1 AND entity_id = $2 ORDER BY created_at`,
        [collegeA.collegeId, created.body.id],
      );
      assert.equal(rows.rows.length, 2);
      assert.equal(rows.rows[0].action, 'attendance_marked');
      assert.equal(rows.rows[1].action, 'attendance_remarked');
      assert.equal(rows.rows[0].entity, 'attendance_sessions');
      assert.equal(rows.rows[0].user_id, collegeA.userIds.tutoruser);
      assert.equal(rows.rows[1].user_id, collegeA.userIds.tutoruser);
    },
  );
});
