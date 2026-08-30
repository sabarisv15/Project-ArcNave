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
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const PizZip = require('pizzip');
const createApp = require('../src/app');
const security = require('../src/security');
const config = require('../src/config');
const sandboxExecutionService = require('../src/services/sandboxExecutionService');

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

function get(baseUrl, reqPath, headers) {
  return requestJson(baseUrl, reqPath, 'GET', { headers });
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

// Real `%PDF` magic bytes — enough for the route's own sniff to accept it
// (extraction correctness is documentTextExtractionService's own unit tests,
// mocked separately — this file proves the upload/sniff boundary only).
const FAKE_PDF = Buffer.from('%PDF-1.4\n%fake pdf content for the chat-attachments sniff test\n%%EOF');

// A minimal, real ZIP container carrying only the one internal part
// sniffOfficeOpenXmlMimeType actually checks for — not a fully valid Office
// document (no styles/content types), but the same "the sniff only proves
// the container shape, not full document validity" scope the extraction
// unit tests already cover separately.
function fakeDocxBuffer() {
  const zip = new PizZip();
  zip.file('word/document.xml', '<w:document/>');
  return zip.generate({ type: 'nodebuffer' });
}
function fakeXlsxBuffer() {
  const zip = new PizZip();
  zip.file('xl/workbook.xml', '<workbook/>');
  return zip.generate({ type: 'nodebuffer' });
}
function fakePptxBuffer() {
  const zip = new PizZip();
  zip.file('ppt/presentation.xml', '<presentation/>');
  return zip.generate({ type: 'nodebuffer' });
}
// ODT/ODS's own manifest is the raw "mimetype" member content, per the
// ODF spec — same real-internal-structure sniff as the OOXML magic-byte
// checks above, just via file content instead of a fixed member path.
function fakeOdtBuffer() {
  const zip = new PizZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text');
  zip.file('content.xml', '<office:document-content/>');
  return zip.generate({ type: 'nodebuffer' });
}
function fakeOdsBuffer() {
  const zip = new PizZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.spreadsheet');
  zip.file('content.xml', '<office:document-content/>');
  return zip.generate({ type: 'nodebuffer' });
}
// A real ZIP container with none of the internal parts any office/ODF
// sniff check looks for — same magic bytes as docx/xlsx/pptx/odt/ods,
// used to prove a bare .zip is classified by real internal structure,
// not a filename guess: since the File Intelligence Router
// (fileIntelligenceRouter.classifyAttachment), it is accepted as a
// generic archive (ARCHIVE_OR_CONTAINER) rather than rejected — see the
// test below.
function fakeUnrelatedZipBuffer() {
  const zip = new PizZip();
  zip.file('some/unrelated/part.xml', '<nothing/>');
  return zip.generate({ type: 'nodebuffer' });
}

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

  await t.test('a real PDF upload succeeds and is sniffed as application/pdf', async () => {
    const token = await login('userone');
    const resp = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(token), {
      file_name: 'report.pdf',
      file_base64: FAKE_PDF.toString('base64'),
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.mime_type, 'application/pdf');
  });

  await t.test('a real DOCX upload succeeds and is sniffed as the openxml wordprocessing type', async () => {
    const token = await login('userone');
    const resp = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(token), {
      file_name: 'notes.docx',
      file_base64: fakeDocxBuffer().toString('base64'),
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.mime_type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  await t.test('a real XLSX upload succeeds and is sniffed as the openxml spreadsheet type', async () => {
    const token = await login('userone');
    const resp = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(token), {
      file_name: 'marks.xlsx',
      file_base64: fakeXlsxBuffer().toString('base64'),
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.mime_type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  await t.test('a real PPTX upload succeeds and is sniffed as the openxml presentation type', async () => {
    const token = await login('userone');
    const resp = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(token), {
      file_name: 'slides.pptx',
      file_base64: fakePptxBuffer().toString('base64'),
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.mime_type, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  });

  await t.test('a real ODT upload succeeds and is sniffed as the opendocument text type', async () => {
    const token = await login('userone');
    const resp = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(token), {
      file_name: 'notes.odt',
      file_base64: fakeOdtBuffer().toString('base64'),
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.mime_type, 'application/vnd.oasis.opendocument.text');
  });

  await t.test('a real ODS upload succeeds and is sniffed as the opendocument spreadsheet type', async () => {
    const token = await login('userone');
    const resp = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(token), {
      file_name: 'marks.ods',
      file_base64: fakeOdsBuffer().toString('base64'),
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.mime_type, 'application/vnd.oasis.opendocument.spreadsheet');
  });

  await t.test('a bare zip (ZIP magic, but none of the recognized office/ODF internal parts) is now accepted as a generic archive', async () => {
    const token = await login('userone');
    const resp = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(token), {
      file_name: 'archive.zip',
      file_base64: fakeUnrelatedZipBuffer().toString('base64'),
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.category, 'archive_or_container');
  });

  await t.test('an APK (ZIP containing AndroidManifest.xml) is rejected outright, never accepted as a generic archive', async () => {
    const token = await login('userone');
    const zip = new PizZip();
    zip.file('AndroidManifest.xml', '<manifest/>');
    const resp = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(token), {
      file_name: 'app.apk',
      file_base64: zip.generate({ type: 'nodebuffer' }).toString('base64'),
    });
    assert.equal(resp.status, 400);
  });

  await t.test('md/txt/csv uploads succeed and are sniffed by content shape + the declared extension', async () => {
    const token = await login('userone');
    const cases = [
      ['readme.md', 'text/markdown', '# Notes\n\nSome markdown content.'],
      ['plain.txt', 'text/plain', 'Just plain readable text.'],
      ['roster.csv', 'text/csv', 'name,roll_number\nRavi,1\nMeena,2'],
    ];
    for (const [fileName, expectedMime, content] of cases) {
      // eslint-disable-next-line no-await-in-loop
      const resp = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(token), {
        file_name: fileName,
        file_base64: Buffer.from(content, 'utf8').toString('base64'),
      });
      assert.equal(resp.status, 201, `${fileName} should be accepted`);
      assert.equal(resp.body.mime_type, expectedMime);
    }
  });

  await t.test('binary-looking content with a .txt extension (a NUL byte present) is rejected — the content heuristic is the real gate, not the extension', async () => {
    const token = await login('userone');
    const binaryLooking = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x10, 0x20]);
    const resp = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(token), {
      file_name: 'disguised.txt',
      file_base64: binaryLooking.toString('base64'),
    });
    assert.equal(resp.status, 400);
  });

  await t.test('plain text content with no recognized extension is rejected rather than guessed', async () => {
    const token = await login('userone');
    const resp = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(token), {
      file_name: 'notes.rtf',
      file_base64: Buffer.from('some readable text with no supported extension', 'utf8').toString('base64'),
    });
    assert.equal(resp.status, 400);
  });

  await t.test('an archive attachment with the sandbox unconfigured (this test env) lands in a graceful "failed" status, never a 500', async () => {
    const token = await login('userone');
    const resp = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(token), {
      file_name: 'archive.zip',
      file_base64: fakeUnrelatedZipBuffer().toString('base64'),
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.category, 'archive_or_container');
    assert.equal(resp.body.processing_status, 'failed');

    const intelligence = await get(baseUrl, `/api/v1/documents/chat-attachments/${resp.body.id}/intelligence`, headersFor(token));
    assert.equal(intelligence.status, 200);
    assert.equal(intelligence.body.length, 1);
    assert.equal(intelligence.body[0].processing_status, 'failed');
    assert.ok(intelligence.body[0].error_message_safe);
  });

  await t.test('GET .../intelligence: another user in the same college gets 404, never the owner\'s attachment_intelligence rows', async () => {
    const uploaderToken = await login('userone');
    const otherUserToken = await login('usertwo');
    const upload = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(uploaderToken), {
      file_name: 'mark-sheet.png',
      file_base64: ONE_PIXEL_PNG.toString('base64'),
    });
    assert.equal(upload.status, 201);

    const ownerLookup = await get(baseUrl, `/api/v1/documents/chat-attachments/${upload.body.id}/intelligence`, headersFor(uploaderToken));
    assert.equal(ownerLookup.status, 200);
    assert.equal(ownerLookup.body.length, 1);

    const otherLookup = await get(baseUrl, `/api/v1/documents/chat-attachments/${upload.body.id}/intelligence`, headersFor(otherUserToken));
    assert.equal(otherLookup.status, 404);
  });

  await t.test('archive extraction (mocked sandbox): a normal child, a blocked executable child, and a nested archive child are all handled correctly', async (subT) => {
    const token = await login('userone');

    const childPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1, 2, 3, 4]);
    const childExe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    const nestedZip = new PizZip();
    nestedZip.file('inner.txt', 'nested content');
    const nestedZipBuffer = nestedZip.generate({ type: 'nodebuffer' });

    let callCount = 0;
    subT.mock.method(sandboxExecutionService, 'extractArchive', async () => {
      callCount += 1;
      if (callCount === 1) {
        // Top-level archive: one normal file, one blocked executable,
        // one nested archive (drives the recursive call below).
        return {
          status: 'ok',
          files: [
            { name: 'photo.png', buffer: childPng },
            { name: 'app.exe', buffer: childExe },
            { name: 'inner.zip', buffer: nestedZipBuffer },
          ],
        };
      }
      // The recursive call, for inner.zip: one more normal file, no
      // further nesting — proves recursion actually ran, not just that
      // the mock was configured to allow it.
      return {
        status: 'ok',
        files: [{ name: 'deep.png', buffer: childPng }],
      };
    });

    const topLevelZip = new PizZip();
    topLevelZip.file('placeholder.bin', 'irrelevant — extraction result is fully mocked above');
    const resp = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(token), {
      file_name: 'bundle.zip',
      file_base64: topLevelZip.generate({ type: 'nodebuffer' }).toString('base64'),
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.processing_status, 'ready');
    assert.equal(callCount, 2, 'the nested archive child must trigger a second, recursive extraction call');

    const intelligence = await get(baseUrl, `/api/v1/documents/chat-attachments/${resp.body.id}/intelligence`, headersFor(token));
    // Top-level (ready) + png child + zip child + the zip child's own
    // png grandchild = 4 rows. The blocked .exe never gets a row at
    // all — it was never stored.
    assert.equal(intelligence.body.length, 4);
    const categories = intelligence.body.map((row) => row.category).sort();
    assert.deepEqual(categories, ['archive_or_container', 'archive_or_container', 'native_multimodal_image', 'native_multimodal_image']);
    assert.ok(!intelligence.body.some((row) => row.detected_mime_type === 'application/x-msdownload'), 'the blocked executable must never appear');

    // parent_attachment_id references another attachment_intelligence
    // row's own id, not a documents.id — the top-level row (no
    // parent_attachment_id of its own) is the id every direct child
    // points back at.
    const topLevelRow = intelligence.body.find((row) => !row.parent_attachment_id);
    assert.ok(topLevelRow, 'exactly one row has no parent_attachment_id');
    const childRows = intelligence.body.filter((row) => row.parent_attachment_id === topLevelRow.id);
    assert.equal(childRows.length, 2, 'exactly the png and the nested zip are direct children of the top-level archive');
  });

  await t.test('archive extraction recursion depth is bounded — a chain of nested archives beyond the limit fails safely, not infinitely', async (subT) => {
    const token = await login('userone');
    const nestedZip = new PizZip();
    nestedZip.file('x.txt', 'x');
    const nestedZipBuffer = nestedZip.generate({ type: 'nodebuffer' });

    let callCount = 0;
    subT.mock.method(sandboxExecutionService, 'extractArchive', async () => {
      callCount += 1;
      // Every call returns ONE more nested archive — an unbounded chain
      // if depth were not capped.
      return { status: 'ok', files: [{ name: `level${callCount}.zip`, buffer: nestedZipBuffer }] };
    });

    const topLevelZip = new PizZip();
    topLevelZip.file('placeholder.bin', 'irrelevant');
    const resp = await post(baseUrl, '/api/v1/documents/chat-attachments', headersFor(token), {
      file_name: 'infinite.zip',
      file_base64: topLevelZip.generate({ type: 'nodebuffer' }).toString('base64'),
    });
    assert.equal(resp.status, 201);
    // The top-level attachment itself still reports 'ready' (every
    // bounded level it reached extracted successfully) — the recursion
    // cap causes the DEEPEST call to fail quietly rather than the whole
    // upload turning into a user-facing error, matching "one bad nested
    // entry doesn't nuke the rest of what was already extracted."
    assert.equal(resp.body.processing_status, 'ready');
    assert.ok(callCount <= 7, `recursion must stop at the depth cap (6), saw ${callCount} calls`);
    assert.ok(callCount >= 6, `recursion should reach the depth cap, saw only ${callCount} calls`);
  });
});
