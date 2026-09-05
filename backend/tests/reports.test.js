'use strict';

// Integration tests for the Reports API (/api/v1/reports/...) — real
// HTTP requests against a live Postgres AND the real filesystem
// (documentService/fileStorage are not mocked — same "prove the real
// thing once" reasoning documents.test.js already applies to its own
// upload/download round-trip).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedPrincipalPosition, cleanupPositionRows } = require('./helpers/positionFixtures');
const { cleanupCollegeStorage } = require('./helpers/storageFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'ReportsTestPass123!';

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

function requestRaw(baseUrl, path, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, { method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
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
  const college = { collegeId: `rpt${label}${suffix}`, subdomain: `rpttenant${label}${suffix}` };
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)', [
    college.collegeId,
    college.subdomain,
  ]);
  const passwordHash = await security.hashPassword(PASSWORD);
  const userIds = {};
  for (const [username, role] of [
    ['principaluser', 'principal'],
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
  await seedPrincipalPosition(adminPool, { collegeId: college.collegeId, userId: userIds.principaluser, passwordHash });
  await adminPool.query(`INSERT INTO students (college_id, roll_no, full_name) VALUES ($1, 'R001', 'Alice')`, [
    college.collegeId,
  ]);
  return { ...college, userIds };
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM generated_reports WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM documents WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM students WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('reports', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const college = await seedTenant(adminPool, 'a');

  t.after(async () => {
    await stopServer(server);
    await cleanupTenant(adminPool, college);
    await adminPool.end();
    // This tenant's subtree only, never the whole shared storage root
    // — see tests/helpers/storageFixtures.js.
    await cleanupCollegeStorage(college.collegeId);
  });

  async function login(username) {
    const resp = await requestJson(baseUrl, '/api/v1/auth/login', 'POST', {
      headers: { host: hostFor(college.subdomain) },
      body: { username, password: PASSWORD },
    });
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  function headersFor(token) {
    const headers = { host: hostFor(college.subdomain) };
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  await t.test('principal generates a student-export CSV: 201, downloadable via documents/:id/download', async () => {
    const token = await login('principaluser');
    const resp = await post(baseUrl, '/api/v1/reports/student-export', headersFor(token), { format: 'csv' });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.status, 'completed');
    assert.equal(resp.body.report_type, 'student_export');
    assert.equal(resp.body.format, 'csv');
    assert.ok(resp.body.document_id);

    const download = await requestRaw(
      baseUrl,
      `/api/v1/documents/${resp.body.document_id}/download`,
      headersFor(token),
    );
    assert.equal(download.status, 200);
    // Express appends '; charset=utf-8' to text-ish Content-Types set
    // via res.set() automatically — real behavior, not asserted away.
    assert.ok(download.headers['content-type'].startsWith('text/csv'));
    assert.ok(download.buffer.toString('utf8').includes('Alice'));
  });

  await t.test('principal generates attendance and finance reports', async () => {
    const token = await login('principaluser');
    const attendance = await post(baseUrl, '/api/v1/reports/attendance', headersFor(token), { format: 'csv' });
    assert.equal(attendance.status, 201);
    assert.equal(attendance.body.report_type, 'attendance_report');
    assert.equal(attendance.body.status, 'completed');

    const finance = await post(baseUrl, '/api/v1/reports/finance', headersFor(token), { format: 'csv' });
    assert.equal(finance.status, 201);
    assert.equal(finance.body.report_type, 'finance_report');
    assert.equal(finance.body.status, 'completed');
  });

  await t.test('defaults to csv when format is omitted', async () => {
    const token = await login('principaluser');
    const resp = await post(baseUrl, '/api/v1/reports/student-export', headersFor(token), {});
    assert.equal(resp.status, 201);
    assert.equal(resp.body.format, 'csv');
  });

  // pdf's own magic bytes are '%PDF-'; xlsx/docx are both zip
  // containers (OOXML), so 'PK' — the same real-format distinction
  // report-service.test.js's own generator tests already check.
  const MAGIC_BYTES = { pdf: '%PDF-', xlsx: 'PK', docx: 'PK' };

  for (const format of ['pdf', 'xlsx', 'docx']) {
    await t.test(`generates a real ${format} report`, async () => {
      const token = await login('principaluser');
      const resp = await post(baseUrl, '/api/v1/reports/student-export', headersFor(token), { format });
      assert.equal(resp.status, 201);
      assert.equal(resp.body.status, 'completed');
      assert.equal(resp.body.format, format);

      const download = await requestRaw(
        baseUrl,
        `/api/v1/documents/${resp.body.document_id}/download`,
        headersFor(token),
      );
      assert.equal(download.status, 200);
      const magic = MAGIC_BYTES[format];
      assert.equal(download.buffer.subarray(0, magic.length).toString('latin1'), magic);
    });
  }

  await t.test('rejects an unsupported format with 400, not a 500', async () => {
    const token = await login('principaluser');
    const resp = await post(baseUrl, '/api/v1/reports/student-export', headersFor(token), { format: 'pptx' });
    assert.equal(resp.status, 400);
  });

  // RS-CLS-005 (D21 fix): staff MAY export now, but scoped to their own
  // timetable-linked classes — this fixture's staffuser has no class or
  // faculty_allocation link at all, so the export succeeds (201) with
  // zero students, not a 403. "Staff with no timetable link have zero
  // access" is expressed as an empty result, same as GET /students.
  await t.test('staff with no timetable link gets 201 with zero students exported', async () => {
    const token = await login('staffuser');
    const resp = await post(baseUrl, '/api/v1/reports/student-export', headersFor(token), { format: 'csv' });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.parameters.studentCount, 0);
  });

  await t.test('unauthenticated request is rejected with 401', async () => {
    const resp = await post(baseUrl, '/api/v1/reports/student-export', headersFor(null), { format: 'csv' });
    assert.equal(resp.status, 401);
  });
});
