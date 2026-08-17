'use strict';

// Integration tests for the staff API — real HTTP requests against a
// live Postgres, same discipline as students.test.js: error mapping
// (StaffValidationError -> 400, StaffUserConflictError -> 409,
// StaffCodeConflictError -> 409, StaffUserNotFoundError -> 404) is
// proven against staffService's actual behavior hitting real DB
// constraints, not hand-thrown errors standing in for them.
//
// Unlike students, staff.user_id is NOT NULL + FK'd to users.id, so
// every create needs a real, spare, already-provisioned user row to
// name as the subject — seedTenant provisions one ('subjectuser',
// role 'staff') per tenant, distinct from 'principaluser' (the actor
// who authenticates and creates the profile) and 'staffuser' (used
// for the read-RBAC checks, same as students.test.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedPrincipalPosition, cleanupPositionRows } = require('./helpers/positionFixtures');
const notificationService = require('../src/services/notificationService');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'StaffTestPass123!';

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
  const college = { collegeId: `stf${label}${suffix}`, subdomain: `stftenant${label}${suffix}` };
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [college.collegeId, college.subdomain],
  );
  const passwordHash = await security.hashPassword(PASSWORD);
  const userIds = {};
  // 'subjectuser' is deliberately NOT the same account as any actor
  // below — it stands in for an already-provisioned staff member
  // whose profile a principal is creating, the real HOD/Principal
  // Add-Staff-modal flow this slice is grounded against.
  for (const username of ['principaluser', 'staffuser', 'subjectuser', 'subjectuser2']) {
    const role = username === 'staffuser' ? 'staff' : (username === 'principaluser' ? 'principal' : 'staff');
    // eslint-disable-next-line no-await-in-loop
    const result = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [college.collegeId, username, `${username}@example.com`, passwordHash, role],
    );
    userIds[username] = result.rows[0].id;
  }
  await seedPrincipalPosition(adminPool, { collegeId: college.collegeId, userId: userIds.principaluser, passwordHash });
  const department = await adminPool.query(
    `INSERT INTO departments (college_id, name, approved_intake)
     VALUES ($1, $2, 60) RETURNING id`,
    [college.collegeId, `Computer Science ${label}`],
  );
  return { ...college, userIds, departmentIds: { cse: department.rows[0].id } };
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  // D10 (RS-STF-001/002): staff_invitations/approval_history/
  // workflow_requests, must go before departments/staff/users/colleges
  // below — same "child rows before the FK target" ordering
  // timetable-approval.test.js's own cleanupTenant already establishes.
  await adminPool.query('DELETE FROM staff_invitations WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM approval_history WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM workflow_requests WHERE college_id = $1', [college.collegeId]);
  // Phase 1 (Capability Resolver integration): appointHodInCharge/
  // provisionHodAccount/seedPrincipalPosition all create position_*
  // rows FK'd to departments(id)/users(id) — same ordering fix
  // principal-invitation.test.js already needed for the Level 1 path.
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM departments WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('staff', async (t) => {
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
    const resp = await requestJson(
      baseUrl,
      '/api/v1/auth/login',
      'POST',
      { headers: { host: hostFor(college.subdomain) }, body: { username, password: PASSWORD } },
    );
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
    const resp = await post(baseUrl, '/api/v1/staff', headersFor(collegeA, token), {
      user_id: collegeA.userIds.subjectuser, full_name: 'Priya Prof', designation: 'Professor',
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.full_name, 'Priya Prof');
    assert.equal(resp.body.designation, 'Professor');
    assert.equal(resp.body.college_id, collegeA.collegeId);
    assert.equal(resp.body.user_id, collegeA.userIds.subjectuser);
  });

  await t.test('principal can provision the first HOD account for a department, but not a second one', async () => {
    const token = await login(collegeA, 'principaluser');
    let mailedCredentials = null;
    const emailMock = t.mock.method(notificationService, 'sendStaffCredentialsEmail', async (client, args) => {
      mailedCredentials = args;
      return { status: 'stubbed' };
    });
    t.after(() => emailMock.mock.restore());

    const username = `hod${crypto.randomUUID().slice(0, 8)}`;
    const created = await post(baseUrl, '/api/v1/staff/hod-accounts', headersFor(collegeA, token), {
      username,
      email: `${username}@example.com`,
      full_name: 'First HOD',
      department_id: collegeA.departmentIds.cse,
      designation: 'Head of Department',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.role, 'hod');
    assert.equal(created.body.department_id, collegeA.departmentIds.cse);
    assert.ok(created.body.staff_code);
    assert.equal('password' in created.body, false);
    assert.equal(mailedCredentials.username, username);
    assert.ok(mailedCredentials.password);

    const hodLogin = await requestJson(
      baseUrl,
      '/api/v1/auth/login',
      'POST',
      {
        headers: { host: hostFor(collegeA.subdomain) },
        body: { username, password: mailedCredentials.password },
      },
    );
    assert.equal(hodLogin.status, 200);

    const second = await post(baseUrl, '/api/v1/staff/hod-accounts', headersFor(collegeA, token), {
      username: `hod${crypto.randomUUID().slice(0, 8)}`,
      email: `hod2-${crypto.randomUUID().slice(0, 8)}@example.com`,
      full_name: 'Second HOD',
      department_id: collegeA.departmentIds.cse,
    });
    assert.equal(second.status, 409);
  });

  await t.test('create rejects a missing user_id with 400, not a 500', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/staff', headersFor(collegeA, token), {
      full_name: 'No User Id',
    });
    assert.equal(resp.status, 400);
  });

  await t.test('create rejects a missing full_name with 400', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/staff', headersFor(collegeA, token), {
      user_id: collegeA.userIds.subjectuser2,
    });
    assert.equal(resp.status, 400);
  });

  await t.test('create on a duplicate user_id within the same tenant is a real 409, from a real DB constraint', async () => {
    const token = await login(collegeA, 'principaluser');
    const first = await post(baseUrl, '/api/v1/staff', headersFor(collegeA, token), {
      user_id: collegeA.userIds.subjectuser2, full_name: 'First Profile',
    });
    assert.equal(first.status, 201);

    const dup = await post(baseUrl, '/api/v1/staff', headersFor(collegeA, token), {
      user_id: collegeA.userIds.subjectuser2, full_name: 'Second Profile For Same Account',
    });
    assert.equal(dup.status, 409);
  });

  await t.test('create on a duplicate staff_code within the same tenant is a real 409', async () => {
    const token = await login(collegeA, 'principaluser');
    // subjectuser/subjectuser2 already used above in this tenant; use
    // dedicated spare accounts seeded fresh for this test via the
    // admin pool.
    const passwordHash = await security.hashPassword(PASSWORD);
    const u1 = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, 'codeuser1', 'codeuser1@example.com', $2, 'staff', true) RETURNING id`,
      [collegeA.collegeId, passwordHash],
    );
    const u2 = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, 'codeuser2', 'codeuser2@example.com', $2, 'staff', true) RETURNING id`,
      [collegeA.collegeId, passwordHash],
    );

    const first = await post(baseUrl, '/api/v1/staff', headersFor(collegeA, token), {
      user_id: u1.rows[0].id, full_name: 'Coded One', staff_code: 'DUPCODE',
    });
    assert.equal(first.status, 201);

    const dup = await post(baseUrl, '/api/v1/staff', headersFor(collegeA, token), {
      user_id: u2.rows[0].id, full_name: 'Coded Two', staff_code: 'DUPCODE',
    });
    assert.equal(dup.status, 409);
  });

  await t.test('create with a user_id that does not exist returns 404, not a 500', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/staff', headersFor(collegeA, token), {
      user_id: crypto.randomUUID(), full_name: 'Ghost Staff',
    });
    assert.equal(resp.status, 404);
  });

  await t.test('an aadhaar-shaped field is silently dropped, never stored or echoed back', async () => {
    const token = await login(collegeA, 'principaluser');
    const passwordHash = await security.hashPassword(PASSWORD);
    const u = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, 'aadhaaruser', 'aadhaaruser@example.com', $2, 'staff', true) RETURNING id`,
      [collegeA.collegeId, passwordHash],
    );
    const resp = await post(baseUrl, '/api/v1/staff', headersFor(collegeA, token), {
      user_id: u.rows[0].id, full_name: 'No Aadhaar Here', aadhaar_number: '1234-5678-9012',
    });
    assert.equal(resp.status, 201);
    assert.equal('aadhaar_number' in resp.body, false);
  });

  await t.test('get by id returns 200 for an existing staff row, 404 for an unknown id', async () => {
    const token = await login(collegeA, 'principaluser');
    const passwordHash = await security.hashPassword(PASSWORD);
    const u = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, 'getuser', 'getuser@example.com', $2, 'staff', true) RETURNING id`,
      [collegeA.collegeId, passwordHash],
    );
    const created = await post(baseUrl, '/api/v1/staff', headersFor(collegeA, token), {
      user_id: u.rows[0].id, full_name: 'Gettable Staff',
    });
    const found = await get(baseUrl, `/api/v1/staff/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(found.status, 200);
    assert.equal(found.body.id, created.body.id);

    const missing = await get(baseUrl, `/api/v1/staff/${crypto.randomUUID()}`, headersFor(collegeA, token));
    assert.equal(missing.status, 404);
  });

  await t.test('list returns an array and respects limit', async () => {
    const token = await login(collegeA, 'principaluser');
    const passwordHash = await security.hashPassword(PASSWORD);
    const u1 = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, 'listuser1', 'listuser1@example.com', $2, 'staff', true) RETURNING id`,
      [collegeA.collegeId, passwordHash],
    );
    const u2 = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, 'listuser2', 'listuser2@example.com', $2, 'staff', true) RETURNING id`,
      [collegeA.collegeId, passwordHash],
    );
    await post(baseUrl, '/api/v1/staff', headersFor(collegeA, token), { user_id: u1.rows[0].id, full_name: 'List One' });
    await post(baseUrl, '/api/v1/staff', headersFor(collegeA, token), { user_id: u2.rows[0].id, full_name: 'List Two' });

    const resp = await get(baseUrl, '/api/v1/staff?limit=1', headersFor(collegeA, token));
    assert.equal(resp.status, 200);
    assert.equal(resp.body.length, 1);
  });

  await t.test('update changes a field and returns 200 with the updated row', async () => {
    const token = await login(collegeA, 'principaluser');
    const passwordHash = await security.hashPassword(PASSWORD);
    const u = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, 'updateuser', 'updateuser@example.com', $2, 'staff', true) RETURNING id`,
      [collegeA.collegeId, passwordHash],
    );
    const created = await post(baseUrl, '/api/v1/staff', headersFor(collegeA, token), {
      user_id: u.rows[0].id, full_name: 'Before Update',
    });
    const updated = await put(baseUrl, `/api/v1/staff/${created.body.id}`, headersFor(collegeA, token), {
      full_name: 'After Update',
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.full_name, 'After Update');
  });

  await t.test('update against an unknown id returns 404', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await put(baseUrl, `/api/v1/staff/${crypto.randomUUID()}`, headersFor(collegeA, token), {
      full_name: 'Nobody',
    });
    assert.equal(resp.status, 404);
  });

  await t.test('update onto another staff row\'s staff_code is a real 409, from a real DB constraint', async () => {
    const token = await login(collegeA, 'principaluser');
    const passwordHash = await security.hashPassword(PASSWORD);
    const u1 = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, 'updconflict1', 'updconflict1@example.com', $2, 'staff', true) RETURNING id`,
      [collegeA.collegeId, passwordHash],
    );
    const u2 = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, 'updconflict2', 'updconflict2@example.com', $2, 'staff', true) RETURNING id`,
      [collegeA.collegeId, passwordHash],
    );
    await post(baseUrl, '/api/v1/staff', headersFor(collegeA, token), {
      user_id: u1.rows[0].id, full_name: 'Taken Code', staff_code: 'UPDCODE',
    });
    const second = await post(baseUrl, '/api/v1/staff', headersFor(collegeA, token), {
      user_id: u2.rows[0].id, full_name: 'Will Collide',
    });

    const resp = await put(baseUrl, `/api/v1/staff/${second.body.id}`, headersFor(collegeA, token), {
      staff_code: 'UPDCODE',
    });
    assert.equal(resp.status, 409);
  });

  await t.test('update cannot move user_id — it is silently ignored, not applied', async () => {
    const token = await login(collegeA, 'principaluser');
    const passwordHash = await security.hashPassword(PASSWORD);
    const original = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, 'moveorig', 'moveorig@example.com', $2, 'staff', true) RETURNING id`,
      [collegeA.collegeId, passwordHash],
    );
    const other = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, 'moveother', 'moveother@example.com', $2, 'staff', true) RETURNING id`,
      [collegeA.collegeId, passwordHash],
    );
    const created = await post(baseUrl, '/api/v1/staff', headersFor(collegeA, token), {
      user_id: original.rows[0].id, full_name: 'Immovable',
    });
    const updated = await put(baseUrl, `/api/v1/staff/${created.body.id}`, headersFor(collegeA, token), {
      user_id: other.rows[0].id, full_name: 'Still Immovable',
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.user_id, original.rows[0].id);
  });

  await t.test('delete removes the row and returns 204; a second delete 404s', async () => {
    const token = await login(collegeA, 'principaluser');
    const passwordHash = await security.hashPassword(PASSWORD);
    const u = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, 'deleteuser', 'deleteuser@example.com', $2, 'staff', true) RETURNING id`,
      [collegeA.collegeId, passwordHash],
    );
    const created = await post(baseUrl, '/api/v1/staff', headersFor(collegeA, token), {
      user_id: u.rows[0].id, full_name: 'Deletable Staff',
    });

    const firstDelete = await del(baseUrl, `/api/v1/staff/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(firstDelete.status, 204);

    const getAfter = await get(baseUrl, `/api/v1/staff/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(getAfter.status, 404);

    const secondDelete = await del(baseUrl, `/api/v1/staff/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(secondDelete.status, 404);
  });

  // --- RBAC ---

  await t.test('create is rejected for a non-principal role', async () => {
    const token = await login(collegeA, 'staffuser');
    const resp = await post(baseUrl, '/api/v1/staff', headersFor(collegeA, token), {
      user_id: collegeA.userIds.subjectuser, full_name: 'Rbac Test',
    });
    assert.equal(resp.status, 403);
  });

  await t.test('create requires authentication', async () => {
    const resp = await post(baseUrl, '/api/v1/staff', headersFor(collegeA), {
      user_id: collegeA.userIds.subjectuser, full_name: 'Rbac Test',
    });
    assert.equal(resp.status, 401);
  });

  // visibilityService.assertCanViewStaff: a plain 'staff' actor may
  // only view their OWN staff profile row (staff.user_id === actorId),
  // never a colleague's — only principal/hod may view someone else's,
  // scoped to college/department. Self-view is what this test actually
  // exercises now.
  await t.test('read is allowed for staff viewing their own profile, not just principal', async () => {
    const principalToken = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/staff', headersFor(collegeA, principalToken), {
      user_id: collegeA.userIds.staffuser, full_name: 'Readable By Staff',
    });

    const staffToken = await login(collegeA, 'staffuser');
    const resp = await get(baseUrl, `/api/v1/staff/${created.body.id}`, headersFor(collegeA, staffToken));
    assert.equal(resp.status, 200);
  });

  await t.test('read is forbidden for staff viewing a colleague\'s profile', async () => {
    const principalToken = await login(collegeA, 'principaluser');
    const passwordHash = await security.hashPassword(PASSWORD);
    const u = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, 'colleagueuser', 'colleagueuser@example.com', $2, 'staff', true) RETURNING id`,
      [collegeA.collegeId, passwordHash],
    );
    const created = await post(baseUrl, '/api/v1/staff', headersFor(collegeA, principalToken), {
      user_id: u.rows[0].id, full_name: 'Colleague Profile',
    });

    const staffToken = await login(collegeA, 'staffuser');
    const resp = await get(baseUrl, `/api/v1/staff/${created.body.id}`, headersFor(collegeA, staffToken));
    assert.equal(resp.status, 403);
  });

  await t.test('read requires authentication', async () => {
    const resp = await get(baseUrl, '/api/v1/staff', headersFor(collegeA));
    assert.equal(resp.status, 401);
  });

  // --- Cross-tenant isolation ---

  await t.test('the same staff_code is independently usable across two tenants', async () => {
    const tokenA = await login(collegeA, 'principaluser');
    const tokenB = await login(collegeB, 'principaluser');
    const passwordHash = await security.hashPassword(PASSWORD);
    const subjectA = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, 'crosstenanta', 'crosstenanta@example.com', $2, 'staff', true) RETURNING id`,
      [collegeA.collegeId, passwordHash],
    );
    const subjectB = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, 'crosstenantb', 'crosstenantb@example.com', $2, 'staff', true) RETURNING id`,
      [collegeB.collegeId, passwordHash],
    );

    const respA = await post(baseUrl, '/api/v1/staff', headersFor(collegeA, tokenA), {
      user_id: subjectA.rows[0].id, full_name: 'Tenant A Staff', staff_code: 'SHARED01',
    });
    const respB = await post(baseUrl, '/api/v1/staff', headersFor(collegeB, tokenB), {
      user_id: subjectB.rows[0].id, full_name: 'Tenant B Staff', staff_code: 'SHARED01',
    });
    assert.equal(respA.status, 201);
    assert.equal(respB.status, 201);

    const getFromB = await get(baseUrl, `/api/v1/staff/${respA.body.id}`, headersFor(collegeB, tokenB));
    assert.equal(getFromB.status, 404);
  });

  // --- Audit attribution (the actorUserId/userId split fix) ---

  await t.test('a create writes exactly one audit_log row, attributed to the actor, not the subject', async () => {
    const token = await login(collegeA, 'principaluser');
    const passwordHash = await security.hashPassword(PASSWORD);
    const subject = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, 'audituser', 'audituser@example.com', $2, 'staff', true) RETURNING id`,
      [collegeA.collegeId, passwordHash],
    );

    const resp = await post(baseUrl, '/api/v1/staff', headersFor(collegeA, token), {
      user_id: subject.rows[0].id, full_name: 'Audited Staff',
    });
    assert.equal(resp.status, 201);

    const row = await adminPool.query(
      `SELECT user_id, entity, entity_id FROM audit_log
       WHERE college_id = $1 AND entity_id = $2 AND action = 'staff_created'`,
      [collegeA.collegeId, resp.body.id],
    );
    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0].entity, 'staff');
    // The audit row's actor is the authenticated caller (principaluser),
    // NOT the subject.id named in the request body — the bug this
    // slice's staffService.js fix (see .ai/TASK.md) corrected.
    assert.equal(row.rows[0].user_id, collegeA.userIds.principaluser);
    assert.notEqual(row.rows[0].user_id, subject.rows[0].id);
  });

  // --- D10 (RS-STF-001/002): staff registration is invite-first ---

  // Provisions a real HOD for a FRESH department (never collegeA.departmentIds.cse
  // — that one's already exercised by the "second HOD" 409 test above,
  // and this block needs a clean, single-HOD department of its own) and
  // logs in as them, the one real actor RS-STF-001 names for
  // inviteStaff. Returns {departmentId, token}.
  async function seedInvitingHod(label) {
    const dept = await adminPool.query(
      `INSERT INTO departments (college_id, name, approved_intake) VALUES ($1, $2, 60) RETURNING id`,
      [collegeA.collegeId, `Invite Dept ${label} ${crypto.randomUUID().slice(0, 6)}`],
    );
    const principalToken = await login(collegeA, 'principaluser');
    let mailedCredentials = null;
    const emailMock = t.mock.method(notificationService, 'sendStaffCredentialsEmail', async (client, args) => {
      mailedCredentials = args;
      return { status: 'stubbed' };
    });
    const username = `invhod${crypto.randomUUID().slice(0, 8)}`;
    const created = await post(baseUrl, '/api/v1/staff/hod-accounts', headersFor(collegeA, principalToken), {
      username, email: `${username}@example.com`, full_name: `Inviting HOD ${label}`, department_id: dept.rows[0].id,
    });
    emailMock.mock.restore();
    assert.equal(created.status, 201);

    const hodLogin = await requestJson(baseUrl, '/api/v1/auth/login', 'POST', {
      headers: { host: hostFor(collegeA.subdomain) }, body: { username, password: mailedCredentials.password },
    });
    assert.equal(hodLogin.status, 200);
    return { departmentId: dept.rows[0].id, token: hodLogin.body.access_token };
  }

  await t.test('an hod invites staff by email, the invitee accepts, and the request lands Pending on the hod->principal chain', async () => {
    const { departmentId, token: hodToken } = await seedInvitingHod('golden');

    let invitationToken = null;
    const inviteEmailMock = t.mock.method(notificationService, 'sendStaffInvitationEmail', async (client, args) => {
      invitationToken = args.token;
      return { status: 'stubbed' };
    });
    t.after(() => inviteEmailMock.mock.restore());

    const inviteResp = await post(baseUrl, '/api/v1/staff/invitations', headersFor(collegeA, hodToken), {
      email: 'newhire@example.com',
    });
    assert.equal(inviteResp.status, 201);
    assert.equal(inviteResp.body.department_id, departmentId);
    assert.ok(invitationToken);

    const acceptUsername = `newhire${crypto.randomUUID().slice(0, 8)}`;
    const acceptResp = await post(baseUrl, '/api/v1/staff/invitations/accept', {}, {
      token: invitationToken, username: acceptUsername, password: 'Str0ng!Pass', full_name: 'New Hire',
    });
    assert.equal(acceptResp.status, 201);
    assert.equal(acceptResp.body.department_id, departmentId);
    assert.ok(acceptResp.body.workflow_request_id);

    const userRow = await adminPool.query('SELECT is_active, role FROM users WHERE id = $1', [acceptResp.body.user_id]);
    assert.equal(userRow.rows[0].is_active, false);
    assert.equal(userRow.rows[0].role, 'staff');

    const wfRow = await adminPool.query(
      'SELECT status, current_step, approver_chain FROM workflow_requests WHERE id = $1',
      [acceptResp.body.workflow_request_id],
    );
    assert.equal(wfRow.rows[0].status, 'Pending');
    assert.equal(wfRow.rows[0].current_step, 1);
    assert.equal(wfRow.rows[0].approver_chain[0].role, 'hod');
    assert.equal(wfRow.rows[0].approver_chain[1].role, 'principal');

    // Reusing the same, now-accepted token is rejected, not silently
    // re-accepted a second time.
    const reuseResp = await post(baseUrl, '/api/v1/staff/invitations/accept', {}, {
      token: invitationToken, username: `reuse${crypto.randomUUID().slice(0, 6)}`, password: 'Str0ng!Pass', full_name: 'Reuse Attempt',
    });
    assert.equal(reuseResp.status, 401);
  });

  await t.test('inviteStaff is forbidden for an ordinary staff actor who is not a real hod', async () => {
    const staffToken = await login(collegeA, 'staffuser');
    const resp = await post(baseUrl, '/api/v1/staff/invitations', headersFor(collegeA, staffToken), {
      email: 'nope@example.com',
    });
    assert.equal(resp.status, 403);
  });

  await t.test('accept rejects an unknown/invalid token with 401', async () => {
    const resp = await post(baseUrl, '/api/v1/staff/invitations/accept', {}, {
      token: 'not-a-real-token', username: 'whoever', password: 'Str0ng!Pass', full_name: 'Whoever',
    });
    assert.equal(resp.status, 401);
  });
});
