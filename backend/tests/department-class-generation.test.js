'use strict';

// Integration tests for RS-CLS-001/RS-CLS-002 — real HTTP requests
// against a live Postgres, same shape as college-profile.test.js.
// Proves POST /api/v1/departments (principal, post-onboarding) both
// requires courseDuration/defaultSections and actually auto-generates
// the right classes through the real column-level GRANT/constraints —
// not just that collegeProfileService's JS validation runs.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedPrincipalPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'DeptGenApiTestPass123!';

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
        resolve({ status: res.statusCode, body: parsedBody, rawText: text });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
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
  const collegeId = `dgapi${label}${suffix}`;
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)', [
    collegeId,
    `dgapitenant${label}${suffix}`,
  ]);
  const passwordHash = await security.hashPassword(PASSWORD);
  const result = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'principaluser', $2, $3, 'principal', true) RETURNING id`,
    [collegeId, 'principaluser@example.com', passwordHash],
  );
  const principalUserId = result.rows[0].id;
  await seedPrincipalPosition(adminPool, { collegeId, userId: principalUserId, passwordHash });
  return { collegeId, subdomain: `dgapitenant${label}${suffix}`, principalUserId };
}

async function cleanupTenant(adminPool, tenant) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM classes WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM departments WHERE college_id = $1', [tenant.collegeId]);
  await cleanupPositionRows(adminPool, tenant.collegeId);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [tenant.collegeId]);
}

test('department creation auto-generates classes (RS-CLS-001/RS-CLS-002)', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const collegeA = await seedTenant(adminPool, 'a');

  t.after(async () => {
    await stopServer(server);
    await cleanupTenant(adminPool, collegeA);
    await adminPool.end();
  });

  async function login(college) {
    const resp = await requestJson(baseUrl, '/api/v1/auth/login', 'POST', {
      headers: { host: hostFor(college.subdomain) },
      body: { username: 'principaluser', password: PASSWORD },
    });
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  function headersFor(college, token) {
    const headers = { host: hostFor(college.subdomain) };
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  await t.test('rejects a department created without courseDuration or defaultSections', async () => {
    const token = await login(collegeA);
    const resp = await post(baseUrl, '/api/v1/departments', headersFor(collegeA, token), { name: 'No Duration Dept' });
    assert.equal(resp.status, 400);
  });

  await t.test('a 4-year department with 2 sections generates exactly 12 classes, none in year 1', async () => {
    const token = await login(collegeA);
    const resp = await post(baseUrl, '/api/v1/departments', headersFor(collegeA, token), {
      name: 'ECE',
      course_duration: 4,
      default_sections: 2,
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.course_duration, 4);
    assert.equal(resp.body.default_sections, 2);

    // 3 in-scope years (2,3,4) x 2 semesters x 2 sections = 12.
    assert.equal(resp.body.generatedClasses.length, 12);

    const semesters = resp.body.generatedClasses.map((c) => c.semester).sort();
    assert.deepEqual(semesters, ['3', '3', '4', '4', '5', '5', '6', '6', '7', '7', '8', '8']);
    assert.ok(!semesters.includes('1') && !semesters.includes('2'), 'year 1 (semesters 1-2) must never be generated');

    const names = resp.body.generatedClasses.map((c) => c.class_name).sort();
    assert.deepEqual(names, [
      'ECE Sem 3 A',
      'ECE Sem 3 B',
      'ECE Sem 4 A',
      'ECE Sem 4 B',
      'ECE Sem 5 A',
      'ECE Sem 5 B',
      'ECE Sem 6 A',
      'ECE Sem 6 B',
      'ECE Sem 7 A',
      'ECE Sem 7 B',
      'ECE Sem 8 A',
      'ECE Sem 8 B',
    ]);
    for (const cls of resp.body.generatedClasses) {
      assert.equal(cls.department_id, resp.body.id);
    }
  });

  await t.test('a 3-year, 1-section department generates exactly 4 classes', async () => {
    const token = await login(collegeA);
    const resp = await post(baseUrl, '/api/v1/departments', headersFor(collegeA, token), {
      name: 'Diploma CS',
      course_duration: 3,
      default_sections: 1,
    });
    assert.equal(resp.status, 201);
    // 2 in-scope years (2,3) x 2 semesters x 1 section = 4.
    assert.equal(resp.body.generatedClasses.length, 4);
  });
});
