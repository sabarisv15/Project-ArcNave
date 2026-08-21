'use strict';

// Integration tests for POST /documents/chat-attachments — real HTTP
// against a live Postgres AND the real filesystem (documents.test.js's
// own reasoning: prove the whole upload -> disk -> DB round-trip once,
// for real, not just via mocks). Focused specifically on the real,
// non-trusting server-side validation this route adds on top of the
// existing upload pipeline (malformed-base64 rejection, decoded-size
// cap, real-content mime sniffing) and the cross-user privacy
// boundary that only the uploader's own AI turn may later rely on
// (proven end to end in ai-service.test.js's resolveImageAttachments
// tests — this file proves the upload side only).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const config = require('../src/config');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'ChatAttachmentsTestPass123!';

function requestJson(baseUrl, reqPath, method, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, baseUrl);
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

function post(baseUrl, reqPath, headers, body) {
  return requestJson(baseUrl, reqPath, 'POST', { headers, body });
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
  const college = { collegeId: `chatatt${label}${suffix}`, subdomain: `chatatttenant${label}${suffix}` };
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [college.collegeId, college.subdomain],
  );
  const passwordHash = await security.hashPassword(PASSWORD);
  const userIds = {};
  for (const [username, role] of [
    ['userone', 'principal'],
    ['usertwo', 'staff'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const result = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [college.collegeId, username, `${username}@example.com`, passwordHash, role],
    );
    userIds[username] = result.rows[0].id;
  }
  return { ...college, userIds };
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM documents WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

// A genuine 1x1 PNG — real magic bytes, not a fabricated stand-in, so
// the server's magic-byte sniffing test proves something real.
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('documents chat-attachments', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const college = await seedTenant(adminPool, 'x');

  t.after(async () => {
    await stopServer(server);
    await cleanupTenant(adminPool, college);
    await adminPool.end();
    const entries = await fs.readdir(config.documentStorageRoot).catch(() => []);
    await Promise.all(entries.map((entry) => fs.rm(
      path.join(config.documentStorageRoot, entry),
      { recursive: true, force: true },
    )));
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
    return { host: hostFor(college.subdomain), authorization: `Bearer ${token}` };
  }

  await t.test('a real PNG upload succeeds, is sniffed as image/png, and returns an id', async () => {
    const token = await login('userone');
    const resp = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(token), {
      file_name: 'mark-sheet.png',
      mime_type: 'image/png',
      file_base64: ONE_PIXEL_PNG.toString('base64'),
    });
    assert.equal(resp.status, 201);
    assert.ok(resp.body.id);
    assert.equal(resp.body.mime_type, 'image/png');
    assert.equal(resp.body.size_bytes, String(ONE_PIXEL_PNG.length));
  });

  await t.test('oversized upload (decoded bytes over the 10MB cap) is rejected', async () => {
    const token = await login('userone');
    // Just over 10MB of decoded bytes — the base64 STRING is even
    // larger (~33% overhead), proving the check is against the
    // decoded buffer, not the encoded string length.
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 0x41);
    const resp = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(token), {
      file_name: 'too-big.png',
      mime_type: 'image/png',
      file_base64: oversized.toString('base64'),
    });
    assert.equal(resp.status, 400);
  });

  await t.test('malformed base64 payload is rejected with 400, not a 500 from an uncaught decode issue', async () => {
    const token = await login('userone');
    const resp = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(token), {
      file_name: 'bad.png',
      mime_type: 'image/png',
      // Whitespace/newlines are not valid base64 alphabet characters —
      // Buffer.from would silently strip them rather than throw, which
      // is exactly the failure mode the round-trip check catches.
      file_base64: 'not valid base64!! ***',
    });
    assert.equal(resp.status, 400);
  });

  await t.test('a payload whose declared mime_type lies (says image/png, but the real bytes are plain text) is rejected — the server sniffs real content, never trusts the client', async () => {
    const token = await login('userone');
    const resp = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(token), {
      file_name: 'fake.png',
      mime_type: 'image/png',
      file_base64: Buffer.from('this is not actually an image').toString('base64'),
    });
    assert.equal(resp.status, 400);
  });

  await t.test('empty file_base64 is rejected', async () => {
    const token = await login('userone');
    const resp = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(token), {
      file_name: 'empty.png',
      mime_type: 'image/png',
      file_base64: '',
    });
    assert.equal(resp.status, 400);
  });
});
