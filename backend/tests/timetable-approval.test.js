'use strict';

// Integration tests for the Module 3->4 gap fix: timetable approval
// wired through WorkflowService (CLAUDE.md rule 3/ADR-005 — the same
// generic workflow_requests mechanism every other approval uses, a
// new 'timetable_approval' entityType, not a parallel path) so
// classes.timetable_status can actually reach 'Approved' through a
// real API, unblocking attendanceService.assertTimetableApproved's
// gate without the raw-UPDATE workaround attendance.test.js's own
// fixture seeding previously needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedClassTutorPosition } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'TimetableApprovalTestPass123!';

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

async function seedTenant(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const college = { collegeId: `tta${suffix}`, subdomain: `ttatenant${suffix}` };
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [college.collegeId, college.subdomain],
  );
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
      [college.collegeId, username, `${username}@example.com`, passwordHash, role],
    );
    userIds[username] = result.rows[0].id;
  }

  const department = await adminPool.query(
    `INSERT INTO departments (college_id, name, approved_intake)
     VALUES ($1, 'Timetable Approval Dept', 60) RETURNING id`,
    [college.collegeId],
  );
  const departmentId = department.rows[0].id;

  // staff rows link the hod/principal *users* rows to a real
  // department (findHodForDepartment/findPrincipal resolve approvers
  // from staff+users, never a bare role) — HOD's own department_id is
  // what submitTimetableForApproval must match against the class's.
  await adminPool.query(
    `INSERT INTO staff (college_id, user_id, full_name, department_id)
     VALUES ($1, $2, 'HOD Person', $3)`,
    [college.collegeId, userIds.hoduser, departmentId],
  );
  await adminPool.query(
    `INSERT INTO staff (college_id, user_id, full_name)
     VALUES ($1, $2, 'Principal Person')`,
    [college.collegeId, userIds.principaluser],
  );

  // Phase 1 (Capability Resolver integration): workflowChainService's
  // 'principal'/'hod' resolution now reads Position/Position Account/
  // Occupant (positionRepository), not staff+users — every tenant this
  // suite seeds needs the equivalent Position rows, same as
  // authService.acceptInvitation/staffService.provisionHodAccount
  // create in the real onboarding/HOD-assignment flows.
  const principalPosition = await adminPool.query(
    `INSERT INTO positions (college_id, level, title, created_by)
     VALUES ($1, 1, 'Principal', $2) RETURNING id`,
    [college.collegeId, userIds.principaluser],
  );
  const principalAccount = await adminPool.query(
    `INSERT INTO position_accounts (college_id, position_id, official_email, password_hash)
     VALUES ($1, $2, 'principal-position@timetable-approval-test.internal', $3) RETURNING id`,
    [college.collegeId, principalPosition.rows[0].id, passwordHash],
  );
  await adminPool.query(
    `INSERT INTO position_occupants (college_id, position_account_id, user_id, assigned_by)
     VALUES ($1, $2, $3, $3)`,
    [college.collegeId, principalAccount.rows[0].id, userIds.principaluser],
  );

  const hodPosition = await adminPool.query(
    `INSERT INTO positions (college_id, level, title, created_by)
     VALUES ($1, 3, 'HOD', $2) RETURNING id`,
    [college.collegeId, userIds.hoduser],
  );
  const hodAccount = await adminPool.query(
    `INSERT INTO position_accounts (college_id, position_id, official_email, password_hash)
     VALUES ($1, $2, 'hod-position@timetable-approval-test.internal', $3) RETURNING id`,
    [college.collegeId, hodPosition.rows[0].id, passwordHash],
  );
  await adminPool.query(
    `INSERT INTO position_department_assignments (college_id, position_id, department_id, assigned_by)
     VALUES ($1, $2, $3, $4)`,
    [college.collegeId, hodPosition.rows[0].id, departmentId, userIds.principaluser],
  );
  await adminPool.query(
    `INSERT INTO position_occupants (college_id, position_account_id, user_id, assigned_by)
     VALUES ($1, $2, $3, $3)`,
    [college.collegeId, hodAccount.rows[0].id, userIds.hoduser],
  );

  const cls = await adminPool.query(
    `INSERT INTO classes (college_id, class_name, department_id)
     VALUES ($1, 'Timetable Approval Class', $2) RETURNING id`,
    [college.collegeId, departmentId],
  );

  // RS-ATT-002/RS-CLS-009 (D3, Stage 5): attendance authority is
  // ownership-based, not title-based — the HOD used elsewhere in this
  // suite to exercise the timetable-approval gate is not this class's
  // owner, so markAttendance needs a real tutor now. staffuser is given
  // the class's Class Tutor position purely so this suite's own
  // attendance calls (unrelated to who owns the hour) stay authorized.
  const { officialEmail } = await seedClassTutorPosition(adminPool, {
    collegeId: college.collegeId, userId: userIds.staffuser, classId: cls.rows[0].id, passwordHash,
  });

  return {
    ...college, userIds, departmentId, classId: cls.rows[0].id, classTutorEmail: officialEmail,
  };
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM approval_history WHERE college_id = $1', [college.collegeId]);
  // timetable_revisions.workflow_request_id FKs workflow_requests(id)
  // (task #3's own revision ledger, created on terminal Approved
  // transition) — must go before the workflow_requests delete below.
  await adminPool.query('DELETE FROM timetable_revisions WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM workflow_requests WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM attendance_sessions WHERE college_id = $1', [college.collegeId]);
  // position_account_refresh_tokens: new since this suite's own
  // loginTutor() (4-login authorization architecture, 2026-08-09) —
  // POST /position-accounts/login issues one, must go before the
  // position_accounts delete below or that delete 23503s.
  await adminPool.query('DELETE FROM position_account_refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM position_occupants WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM position_department_assignments WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM position_class_assignments WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM position_accounts WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM positions WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM classes WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM departments WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('timetable approval (Module 3->4 gap fix)', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const college = await seedTenant(adminPool);

  t.after(async () => {
    await stopServer(server);
    await cleanupTenant(adminPool, college);
    await adminPool.end();
  });

  async function login(username) {
    const resp = await requestJson(
      baseUrl,
      '/api/v1/auth/login',
      'POST',
      { headers: { host: hostFor(college.subdomain) }, body: { username, password: PASSWORD } },
    );
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  // 4-login authorization architecture (2026-08-09): marking any hour
  // of a class on tutor authority alone (rather than a specific
  // scheduled/substitute assignment — this suite's own attendance
  // calls aren't scheduled-faculty, just "the class's tutor") now
  // requires the L4 Position Account login, not staffuser's personal
  // login — Position Occupancy alone no longer suffices.
  async function loginTutor() {
    const resp = await requestJson(
      baseUrl,
      '/api/v1/position-accounts/login',
      'POST',
      { headers: { host: hostFor(college.subdomain) }, body: { official_email: college.classTutorEmail, password: PASSWORD } },
    );
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  function headersFor(token) {
    const headers = { host: hostFor(college.subdomain) };
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  async function markAttendance(token) {
    return post(baseUrl, '/api/v1/attendance', headersFor(token), {
      class_id: college.classId,
      session_date: '2026-07-08',
      hour_index: 1,
      total_students: 30,
      absent_student_ids: [],
    });
  }

  const principalToken = await login('principaluser');
  const hodToken = await login('hoduser');
  // Submitted by a third actor, deliberately not the HOD or Principal:
  // both of those are approver_chain entries too, and ADR-005 blocks a
  // requester from approving their own request — same reasoning
  // staff.js's own submit-registration route comment gives for why
  // that route isn't requireRole('principal').
  const staffToken = await login('staffuser');
  const tutorToken = await loginTutor();

  await t.test('attendance marking is blocked before any approval', async () => {
    const resp = await markAttendance(tutorToken);
    assert.equal(resp.status, 409);
  });

  let workflowRequestId;

  await t.test('submitting for approval creates a real workflow_requests row and sets Pending HOD', async () => {
    const resp = await post(baseUrl, `/api/v1/classes/${college.classId}/submit-for-approval`, headersFor(staffToken), {});
    assert.equal(resp.status, 201);
    assert.equal(resp.body.entity_type, 'timetable_approval');
    assert.equal(resp.body.entity_id, college.classId);
    assert.equal(resp.body.status, 'Pending');
    assert.equal(resp.body.current_step, 1);
    workflowRequestId = resp.body.id;

    const cls = await get(baseUrl, `/api/v1/classes/${college.classId}`, headersFor(principalToken));
    assert.equal(cls.body.timetable_status, 'Pending HOD');
  });

  await t.test('attendance marking is still blocked mid-chain, before the HOD acts', async () => {
    const resp = await markAttendance(tutorToken);
    assert.equal(resp.status, 409);
  });

  await t.test('HOD approval advances the chain without closing it, sets Pending Principal', async () => {
    const resp = await post(baseUrl, `/api/v1/workflow-requests/${workflowRequestId}/approve`, headersFor(hodToken), {});
    assert.equal(resp.status, 200);
    assert.equal(resp.body.workflowRequest.status, 'Pending');
    assert.equal(resp.body.workflowRequest.current_step, 2);
    assert.equal(resp.body.class.timetable_status, 'Pending Principal');
  });

  await t.test('attendance marking is still blocked after only the HOD has approved', async () => {
    const resp = await markAttendance(tutorToken);
    assert.equal(resp.status, 409);
  });

  await t.test('Principal approval closes the chain and sets Approved', async () => {
    const resp = await post(baseUrl, `/api/v1/workflow-requests/${workflowRequestId}/approve`, headersFor(principalToken), {});
    assert.equal(resp.status, 200);
    assert.equal(resp.body.workflowRequest.status, 'Approved');
    assert.equal(resp.body.class.timetable_status, 'Approved');
  });

  await t.test('attendance marking now succeeds, end to end, no manual DB intervention', async () => {
    const resp = await markAttendance(tutorToken);
    assert.equal(resp.status, 200);
    assert.equal(resp.body.class_id, college.classId);
  });

  await t.test('a resolved workflow request cannot be approved again', async () => {
    const resp = await post(baseUrl, `/api/v1/workflow-requests/${workflowRequestId}/approve`, headersFor(principalToken), {});
    assert.equal(resp.status, 409);
  });
});

test('timetable approval rejection resets status to Rejected', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const college = await seedTenant(adminPool);

  t.after(async () => {
    await stopServer(server);
    await cleanupTenant(adminPool, college);
    await adminPool.end();
  });

  async function login(username) {
    const resp = await requestJson(
      baseUrl,
      '/api/v1/auth/login',
      'POST',
      { headers: { host: hostFor(college.subdomain) }, body: { username, password: PASSWORD } },
    );
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  function headersFor(token) {
    const headers = { host: hostFor(college.subdomain) };
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  const principalToken = await login('principaluser');
  const hodToken = await login('hoduser');

  const submitted = await post(baseUrl, `/api/v1/classes/${college.classId}/submit-for-approval`, headersFor(principalToken), {});
  assert.equal(submitted.status, 201);

  const rejected = await post(baseUrl, `/api/v1/workflow-requests/${submitted.body.id}/reject`, headersFor(hodToken), {
    remarks: 'timetable_data is incomplete',
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.workflowRequest.status, 'Rejected');
  assert.equal(rejected.body.class.timetable_status, 'Rejected');
});
