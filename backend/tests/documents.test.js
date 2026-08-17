'use strict';

// Integration tests for the Documents API (/api/v1/documents/...) —
// real HTTP requests against a live Postgres AND the real filesystem
// (fileStorage.js is not mocked here — document-service.test.js
// already covers the mocked business-logic paths; this file proves
// the whole upload -> disk -> DB -> download round-trip actually
// works end to end, same "prove the real thing once" reasoning
// tenantApp.js's own /whoami route uses).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedPrincipalPosition, cleanupPositionRows } = require('./helpers/positionFixtures');
const config = require('../src/config');
const fileStorage = require('../src/storage/fileStorage');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'DocumentsTestPass123!';

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

// Raw-buffer variant for the download endpoint — requestJson's
// utf8-decode-then-JSON.parse would corrupt arbitrary binary bytes.
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
  const college = { collegeId: `doc${label}${suffix}`, subdomain: `doctenant${label}${suffix}` };
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [college.collegeId, college.subdomain],
  );
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

  // visibilityService.assertIsPrincipalOfCollege (studentService.
  // assertCanViewStudent's own real scope check, which every
  // student-scoped document read routes through) verifies via
  // staffService.findPrincipal, which JOINs staff to users — a plain
  // users row with role='principal' alone does not satisfy it, same
  // as real principal onboarding always creating both together.
  await adminPool.query(
    `INSERT INTO staff (college_id, user_id, full_name) VALUES ($1, $2, 'Documents API Test Principal')`,
    [college.collegeId, userIds.principaluser],
  );
  await seedPrincipalPosition(adminPool, { collegeId: college.collegeId, userId: userIds.principaluser, passwordHash });

  const student = await adminPool.query(
    `INSERT INTO students (college_id, roll_no, full_name) VALUES ($1, $2, $3) RETURNING id`,
    [college.collegeId, `DOC-${suffix}`, 'Documents API Test Student'],
  );

  return { ...college, userIds, studentId: student.rows[0].id };
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM ocr_results WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM documents WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM students WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('documents', async (t) => {
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
    // Empties documentStorageRoot's CONTENTS, not the directory itself:
    // docker-compose.yml now mounts a named volume at this exact path
    // (this session's own task — durable storage), so the path itself
    // is a mount point and can't be rmdir'd from inside the container,
    // only emptied. Works the same whether documentStorageRoot is a
    // plain directory (local, non-Docker test runs) or a volume mount.
    const entries = await fs.readdir(config.documentStorageRoot).catch(() => []);
    await Promise.all(entries.map((entry) => fs.rm(
      path.join(config.documentStorageRoot, entry),
      { recursive: true, force: true },
    )));
    const backupEntries = await fs.readdir(config.documentBackupRoot).catch(() => []);
    await Promise.all(backupEntries.map((entry) => fs.rm(
      path.join(config.documentBackupRoot, entry),
      { recursive: true, force: true },
    )));
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

  const fileBytes = Buffer.from('%PDF-1.4 fake certificate bytes');

  await t.test('principal uploads a document: 201, real bytes land on disk, row matches', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/documents', headersFor(collegeA, token), {
      student_id: collegeA.studentId, doc_type: 'aadhaar', file_name: 'aadhaar.pdf', mime_type: 'application/pdf',
      file_base64: fileBytes.toString('base64'),
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.student_id, collegeA.studentId);
    assert.equal(resp.body.doc_type, 'aadhaar');
    assert.equal(resp.body.status, 'uploaded');
    assert.equal(resp.body.file_size_bytes, String(fileBytes.length));
    assert.equal(resp.body.college_id, collegeA.collegeId);

    const onDisk = await fs.readFile(require('path').join(config.documentStorageRoot, resp.body.storage_path));
    assert.equal(onDisk.equals(fileBytes), false, 'bytes at rest must not be plain uploaded bytes');
    const fromStorage = await fileStorage.readFile(resp.body.storage_path);
    assert.ok(fromStorage.equals(fileBytes), 'DocumentService reads back the original bytes');
  });

  await t.test('upload rejects a missing file_base64 with 400, not a 500', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/documents', headersFor(collegeA, token), {
      student_id: collegeA.studentId, doc_type: 'photo', file_name: 'p.jpg', mime_type: 'image/jpeg',
    });
    assert.equal(resp.status, 400);
  });

  await t.test('upload rejects a missing doc_type with 400', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/documents', headersFor(collegeA, token), {
      student_id: collegeA.studentId, file_name: 'p.jpg', mime_type: 'image/jpeg', file_base64: fileBytes.toString('base64'),
    });
    assert.equal(resp.status, 400);
  });

  await t.test('upload with a nonexistent student_id returns 404, not a 500', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/documents', headersFor(collegeA, token), {
      student_id: crypto.randomUUID(), doc_type: 'photo', file_name: 'p.jpg', mime_type: 'image/jpeg', file_base64: fileBytes.toString('base64'),
    });
    assert.equal(resp.status, 404);
  });

  await t.test('staff (non-principal) cannot upload: 403', async () => {
    const token = await login(collegeA, 'staffuser');
    const resp = await post(baseUrl, '/api/v1/documents', headersFor(collegeA, token), {
      student_id: collegeA.studentId, doc_type: 'photo', file_name: 'p.jpg', mime_type: 'image/jpeg', file_base64: fileBytes.toString('base64'),
    });
    assert.equal(resp.status, 403);
  });

  await t.test('GET /documents/:id returns the metadata row', async () => {
    const token = await login(collegeA, 'principaluser');
    const uploaded = await post(baseUrl, '/api/v1/documents', headersFor(collegeA, token), {
      student_id: collegeA.studentId, doc_type: 'birth_cert', file_name: 'birth.pdf', mime_type: 'application/pdf', file_base64: fileBytes.toString('base64'),
    });
    const resp = await get(baseUrl, `/api/v1/documents/${uploaded.body.id}`, headersFor(collegeA, token));
    assert.equal(resp.status, 200);
    assert.equal(resp.body.id, uploaded.body.id);
  });

  await t.test('GET /documents/:id 404s for a tenant that does not own it (RLS via a real cross-tenant attempt)', async () => {
    const tokenA = await login(collegeA, 'principaluser');
    const uploaded = await post(baseUrl, '/api/v1/documents', headersFor(collegeA, tokenA), {
      student_id: collegeA.studentId, doc_type: 'income_cert', file_name: 'income.pdf', mime_type: 'application/pdf', file_base64: fileBytes.toString('base64'),
    });

    const tokenB = await login(collegeB, 'principaluser');
    const resp = await get(baseUrl, `/api/v1/documents/${uploaded.body.id}`, headersFor(collegeB, tokenB));
    assert.equal(resp.status, 404);
  });

  await t.test('GET /documents/:id/download streams the exact original bytes with correct headers', async () => {
    const token = await login(collegeA, 'principaluser');
    const uploaded = await post(baseUrl, '/api/v1/documents', headersFor(collegeA, token), {
      student_id: collegeA.studentId, doc_type: 'transfer_cert', file_name: 'transfer.pdf', mime_type: 'application/pdf', file_base64: fileBytes.toString('base64'),
    });

    const resp = await requestRaw(baseUrl, `/api/v1/documents/${uploaded.body.id}/download`, headersFor(collegeA, token));
    assert.equal(resp.status, 200);
    assert.equal(resp.headers['content-type'], 'application/pdf');
    assert.match(resp.headers['content-disposition'], /transfer\.pdf/);
    assert.ok(resp.buffer.equals(fileBytes), 'downloaded bytes must match uploaded bytes exactly');
  });

  await t.test('OCR extracts readable text and stores the result', async () => {
    const token = await login(collegeA, 'principaluser');
    const textBytes = Buffer.from('OCR readable certificate text');
    const uploaded = await post(baseUrl, '/api/v1/documents', headersFor(collegeA, token), {
      student_id: collegeA.studentId, doc_type: 'certificate', file_name: 'ocr.txt', mime_type: 'text/plain', file_base64: textBytes.toString('base64'),
    });
    assert.equal(uploaded.status, 201);

    const ocr = await post(baseUrl, `/api/v1/documents/${uploaded.body.id}/ocr`, headersFor(collegeA, token), {});
    assert.equal(ocr.status, 201);
    assert.equal(ocr.body.document_id, uploaded.body.id);
    assert.match(ocr.body.extracted_text, /certificate text/);
  });

  await t.test('a file_name containing CRLF is neutralized in the Content-Disposition header', async () => {
    const token = await login(collegeA, 'principaluser');
    const maliciousName = 'evil.pdf"\r\nX-Injected: yes';
    const uploaded = await post(baseUrl, '/api/v1/documents', headersFor(collegeA, token), {
      student_id: collegeA.studentId, doc_type: 'photo', file_name: maliciousName, mime_type: 'application/pdf', file_base64: fileBytes.toString('base64'),
    });
    assert.equal(uploaded.status, 201);

    const resp = await requestRaw(baseUrl, `/api/v1/documents/${uploaded.body.id}/download`, headersFor(collegeA, token));
    assert.equal(resp.status, 200);
    assert.equal(resp.headers['x-injected'], undefined, 'CRLF in file_name must not inject a new header');
    assert.ok(!resp.headers['content-disposition'].includes('\r') && !resp.headers['content-disposition'].includes('\n'));
  });

  await t.test('GET /documents?student_id=... lists every document for that student, newest first', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await get(baseUrl, `/api/v1/documents?student_id=${collegeA.studentId}`, headersFor(collegeA, token));
    assert.equal(resp.status, 200);
    assert.ok(Array.isArray(resp.body));
    assert.ok(resp.body.length >= 1);
    assert.ok(resp.body.every((d) => d.student_id === collegeA.studentId));
  });

  await t.test('GET /documents without student_id returns 400', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await get(baseUrl, '/api/v1/documents', headersFor(collegeA, token));
    assert.equal(resp.status, 400);
  });

  await t.test('POST /documents/:id/review verifies a document and stamps the reviewer', async () => {
    const token = await login(collegeA, 'principaluser');
    const uploaded = await post(baseUrl, '/api/v1/documents', headersFor(collegeA, token), {
      student_id: collegeA.studentId, doc_type: 'community_cert', file_name: 'community.pdf', mime_type: 'application/pdf', file_base64: fileBytes.toString('base64'),
    });

    const resp = await post(baseUrl, `/api/v1/documents/${uploaded.body.id}/review`, headersFor(collegeA, token), {
      status: 'verified', remarks: 'Checked against original',
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.status, 'verified');
    assert.equal(resp.body.verified_by_user_id, collegeA.userIds.principaluser);
    assert.equal(resp.body.remarks, 'Checked against original');
  });

  await t.test('review rejects an unknown status with 400', async () => {
    const token = await login(collegeA, 'principaluser');
    const uploaded = await post(baseUrl, '/api/v1/documents', headersFor(collegeA, token), {
      student_id: collegeA.studentId, doc_type: 'disability_cert', file_name: 'd.pdf', mime_type: 'application/pdf', file_base64: fileBytes.toString('base64'),
    });
    const resp = await post(baseUrl, `/api/v1/documents/${uploaded.body.id}/review`, headersFor(collegeA, token), { status: 'uploaded' });
    assert.equal(resp.status, 400);
  });

  await t.test('review on a nonexistent id returns 404', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, `/api/v1/documents/${crypto.randomUUID()}/review`, headersFor(collegeA, token), { status: 'verified' });
    assert.equal(resp.status, 404);
  });

  await t.test('DELETE /documents/:id soft-deletes: 204, then a 404 on re-fetch, but the file stays on disk', async () => {
    const token = await login(collegeA, 'principaluser');
    const uploaded = await post(baseUrl, '/api/v1/documents', headersFor(collegeA, token), {
      student_id: collegeA.studentId, doc_type: 'scholarship_cert', file_name: 's.pdf', mime_type: 'application/pdf', file_base64: fileBytes.toString('base64'),
    });

    const delResp = await del(baseUrl, `/api/v1/documents/${uploaded.body.id}`, headersFor(collegeA, token));
    assert.equal(delResp.status, 204);

    const getResp = await get(baseUrl, `/api/v1/documents/${uploaded.body.id}`, headersFor(collegeA, token));
    assert.equal(getResp.status, 404);

    const restored = await fileStorage.readFile(uploaded.body.storage_path);
    assert.ok(restored.equals(fileBytes), 'soft-delete must not remove the recoverable file bytes');
  });

  await t.test('delete on a nonexistent id returns 404', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await del(baseUrl, `/api/v1/documents/${crypto.randomUUID()}`, headersFor(collegeA, token));
    assert.equal(resp.status, 404);
  });
});
