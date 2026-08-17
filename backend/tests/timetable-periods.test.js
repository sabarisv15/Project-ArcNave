'use strict';

// Integration tests for the timetable-periods API — real HTTP requests
// against a live Postgres, same discipline as classes.test.js: error
// mapping (TimetablePeriodValidationError -> 400,
// TimetablePeriodSlotTakenError -> 409, TimetablePeriodInUseError ->
// 409) is proven against academicService's actual behavior hitting
// real DB constraints, not hand-thrown errors standing in for them.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedPrincipalPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'PeriodsTestPass123!';

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
  const college = { collegeId: `ttp${label}${suffix}`, subdomain: `ttptenant${label}${suffix}` };
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [college.collegeId, college.subdomain],
  );
  const passwordHash = await security.hashPassword(PASSWORD);
  const userIds = {};
  for (const username of ['principaluser', 'staffuser']) {
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
  return { ...college, userIds };
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM faculty_allocation WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM documents WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM timetable_periods WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM classes WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('timetable periods', async (t) => {
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
    const resp = await post(baseUrl, '/api/v1/timetable-periods', headersFor(collegeA, token), {
      day_of_week: 'Monday', hour_index: 1, start_time: '09:00', end_time: '10:00',
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.day_of_week, 'Monday');
    assert.equal(resp.body.hour_index, 1);
    assert.equal(resp.body.college_id, collegeA.collegeId);
  });

  await t.test('CSV import creates periods and stores the raw file', async () => {
    const token = await login(collegeA, 'principaluser');
    const csv = 'day_of_week,hour_index,start_time,end_time\nMonday,41,09:00,10:00\nMonday,42,10:00,11:00';
    const resp = await post(baseUrl, '/api/v1/timetable-periods/import-csv', headersFor(collegeA, token), {
      file_name: 'timetable.csv',
      file_base64: Buffer.from(csv).toString('base64'),
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.imported.length, 2);
    assert.equal(resp.body.skipped.length, 0);
    assert.ok(resp.body.raw_document_id);

    const raw = await adminPool.query('SELECT doc_type FROM documents WHERE id = $1', [resp.body.raw_document_id]);
    assert.equal(raw.rows[0].doc_type, 'timetable_import');
  });

  await t.test('CSV import skips a duplicate-slot row and keeps the valid ones, no 500', async () => {
    const token = await login(collegeA, 'principaluser');
    const csv = [
      'day_of_week,hour_index,start_time,end_time',
      'Wednesday,51,09:00,10:00',
      'Wednesday,51,09:00,10:00',
      'Wednesday,52,10:00,11:00',
    ].join('\n');
    const resp = await post(baseUrl, '/api/v1/timetable-periods/import-csv', headersFor(collegeA, token), {
      file_name: 'timetable-dup.csv',
      file_base64: Buffer.from(csv).toString('base64'),
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.imported.length, 2);
    assert.equal(resp.body.skipped.length, 1);
    assert.equal(resp.body.skipped[0].row, 2);
    assert.equal(resp.body.total_rows, 3);
  });

  await t.test('CSV import with class_id/subject/staff_user_id columns also creates faculty_allocation and appends classes.timetable_data', async () => {
    const token = await login(collegeA, 'principaluser');
    const classResp = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'CSV Alloc Class',
    });
    assert.equal(classResp.status, 201);
    const classId = classResp.body.id;
    const staffUserId = collegeA.userIds.staffuser;

    const csv = [
      'day_of_week,hour_index,start_time,end_time,class_id,subject,staff_user_id',
      `Thursday,61,09:00,10:00,${classId},Maths,${staffUserId}`,
    ].join('\n');
    const resp = await post(baseUrl, '/api/v1/timetable-periods/import-csv', headersFor(collegeA, token), {
      file_name: 'timetable-alloc.csv',
      file_base64: Buffer.from(csv).toString('base64'),
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.imported.length, 1);
    assert.equal(resp.body.skipped.length, 0);

    const allocation = await adminPool.query(
      'SELECT subject, staff_user_id FROM faculty_allocation WHERE class_id = $1',
      [classId],
    );
    assert.equal(allocation.rows.length, 1);
    assert.equal(allocation.rows[0].subject, 'Maths');
    assert.equal(allocation.rows[0].staff_user_id, staffUserId);

    const cls = await adminPool.query('SELECT timetable_data FROM classes WHERE id = $1', [classId]);
    assert.equal(cls.rows[0].timetable_data.length, 1);
    assert.equal(cls.rows[0].timetable_data[0].subject, 'Maths');
  });

  await t.test('create rejects a missing day_of_week with 400, not a 500', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/timetable-periods', headersFor(collegeA, token), {
      hour_index: 1, start_time: '09:00', end_time: '10:00',
    });
    assert.equal(resp.status, 400);
  });

  await t.test('create on a duplicate (day_of_week, hour_index) within the same tenant is a real 409', async () => {
    const token = await login(collegeA, 'principaluser');
    const first = await post(baseUrl, '/api/v1/timetable-periods', headersFor(collegeA, token), {
      day_of_week: 'Tuesday', hour_index: 1, start_time: '09:00', end_time: '10:00',
    });
    assert.equal(first.status, 201);

    const dup = await post(baseUrl, '/api/v1/timetable-periods', headersFor(collegeA, token), {
      day_of_week: 'Tuesday', hour_index: 1, start_time: '09:30', end_time: '10:30',
    });
    assert.equal(dup.status, 409);
  });

  await t.test('get by id returns 200 for an existing period, 404 for an unknown id', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/timetable-periods', headersFor(collegeA, token), {
      day_of_week: 'Wednesday', hour_index: 1, start_time: '09:00', end_time: '10:00',
    });
    const found = await get(baseUrl, `/api/v1/timetable-periods/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(found.status, 200);
    assert.equal(found.body.id, created.body.id);

    const missing = await get(baseUrl, `/api/v1/timetable-periods/${crypto.randomUUID()}`, headersFor(collegeA, token));
    assert.equal(missing.status, 404);
  });

  await t.test('list returns an array and respects limit', async () => {
    const token = await login(collegeA, 'principaluser');
    await post(baseUrl, '/api/v1/timetable-periods', headersFor(collegeA, token), { day_of_week: 'Thursday', hour_index: 1, start_time: '09:00', end_time: '10:00' });
    await post(baseUrl, '/api/v1/timetable-periods', headersFor(collegeA, token), { day_of_week: 'Thursday', hour_index: 2, start_time: '10:00', end_time: '11:00' });

    const resp = await get(baseUrl, '/api/v1/timetable-periods?limit=1', headersFor(collegeA, token));
    assert.equal(resp.status, 200);
    assert.equal(resp.body.length, 1);
  });

  await t.test('delete removes the row and returns 204; a second delete 404s', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/timetable-periods', headersFor(collegeA, token), {
      day_of_week: 'Friday', hour_index: 1, start_time: '09:00', end_time: '10:00',
    });

    const firstDelete = await del(baseUrl, `/api/v1/timetable-periods/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(firstDelete.status, 204);

    const getAfter = await get(baseUrl, `/api/v1/timetable-periods/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(getAfter.status, 404);

    const secondDelete = await del(baseUrl, `/api/v1/timetable-periods/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(secondDelete.status, 404);
  });

  await t.test('delete on a period still referenced by a faculty_allocation is a real 409, not a 500', async () => {
    const token = await login(collegeA, 'principaluser');
    const period = await post(baseUrl, '/api/v1/timetable-periods', headersFor(collegeA, token), {
      day_of_week: 'Saturday', hour_index: 1, start_time: '09:00', end_time: '10:00',
    });
    const passwordHash = await security.hashPassword(PASSWORD);
    const teacher = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, 'ttpteacher', 'ttpteacher@example.com', $2, 'staff', true) RETURNING id`,
      [collegeA.collegeId, passwordHash],
    );
    const cls = await adminPool.query(
      `INSERT INTO classes (college_id, class_name) VALUES ($1, 'TTP In-Use Class') RETURNING id`,
      [collegeA.collegeId],
    );
    await adminPool.query(
      `INSERT INTO faculty_allocation (college_id, class_id, period_id, subject, staff_user_id)
       VALUES ($1, $2, $3, 'DBMS', $4)`,
      [collegeA.collegeId, cls.rows[0].id, period.body.id, teacher.rows[0].id],
    );

    const resp = await del(baseUrl, `/api/v1/timetable-periods/${period.body.id}`, headersFor(collegeA, token));
    assert.equal(resp.status, 409);
  });

  // --- RBAC ---

  await t.test('create is rejected for a non-principal role', async () => {
    const token = await login(collegeA, 'staffuser');
    const resp = await post(baseUrl, '/api/v1/timetable-periods', headersFor(collegeA, token), {
      day_of_week: 'Monday', hour_index: 9, start_time: '09:00', end_time: '10:00',
    });
    assert.equal(resp.status, 403);
  });

  await t.test('create requires authentication', async () => {
    const resp = await post(baseUrl, '/api/v1/timetable-periods', headersFor(collegeA), {
      day_of_week: 'Monday', hour_index: 9, start_time: '09:00', end_time: '10:00',
    });
    assert.equal(resp.status, 401);
  });

  await t.test('read is allowed for staff, not just principal', async () => {
    const principalToken = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/timetable-periods', headersFor(collegeA, principalToken), {
      day_of_week: 'Monday', hour_index: 10, start_time: '16:00', end_time: '17:00',
    });

    const staffToken = await login(collegeA, 'staffuser');
    const resp = await get(baseUrl, `/api/v1/timetable-periods/${created.body.id}`, headersFor(collegeA, staffToken));
    assert.equal(resp.status, 200);
  });

  await t.test('read requires authentication', async () => {
    const resp = await get(baseUrl, '/api/v1/timetable-periods', headersFor(collegeA));
    assert.equal(resp.status, 401);
  });

  // Capability Coverage Audit finding (2026-07-26): plain 'staff' used
  // to be able to reach generate-grid and rewrite the college's whole
  // shared bell schedule — this route has no per-class/department
  // ownership check to fall back on (see permissions.js's own comment
  // on 'timetable_periods.generate_grid'), so it's narrowed to
  // principal/hod, matching create/import_csv's own blast radius.
  await t.test('generate-grid is rejected for plain staff (Capability Coverage Audit fix)', async () => {
    const token = await login(collegeA, 'staffuser');
    const resp = await post(baseUrl, '/api/v1/timetable-periods/generate-grid', headersFor(collegeA, token), {
      working_days: ['Monday'], start_time: '09:00', end_time: '10:00', slot_duration_minutes: 60,
    });
    assert.equal(resp.status, 403);
  });

  await t.test('generate-grid is allowed for principal', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/timetable-periods/generate-grid', headersFor(collegeA, token), {
      working_days: ['Monday'], start_time: '09:00', end_time: '10:00', slot_duration_minutes: 60,
    });
    assert.equal(resp.status, 201);
  });

  // --- Cross-tenant isolation ---

  await t.test('the same (day_of_week, hour_index) is independently usable across two tenants', async () => {
    const tokenA = await login(collegeA, 'principaluser');
    const tokenB = await login(collegeB, 'principaluser');

    const respA = await post(baseUrl, '/api/v1/timetable-periods', headersFor(collegeA, tokenA), {
      day_of_week: 'Monday', hour_index: 20, start_time: '09:00', end_time: '10:00',
    });
    const respB = await post(baseUrl, '/api/v1/timetable-periods', headersFor(collegeB, tokenB), {
      day_of_week: 'Monday', hour_index: 20, start_time: '09:00', end_time: '10:00',
    });
    assert.equal(respA.status, 201);
    assert.equal(respB.status, 201);

    const getFromB = await get(baseUrl, `/api/v1/timetable-periods/${respA.body.id}`, headersFor(collegeB, tokenB));
    assert.equal(getFromB.status, 404);
  });

  // --- Audit attribution ---

  await t.test('a create writes exactly one audit_log row, attributed to the actor', async () => {
    const token = await login(collegeA, 'principaluser');

    const resp = await post(baseUrl, '/api/v1/timetable-periods', headersFor(collegeA, token), {
      day_of_week: 'Monday', hour_index: 30, start_time: '09:00', end_time: '10:00',
    });
    assert.equal(resp.status, 201);

    const row = await adminPool.query(
      `SELECT user_id, entity, entity_id FROM audit_log
       WHERE college_id = $1 AND entity_id = $2 AND action = 'timetable_period_created'`,
      [collegeA.collegeId, resp.body.id],
    );
    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0].entity, 'timetable_periods');
    assert.equal(row.rows[0].user_id, collegeA.userIds.principaluser);
  });
});
