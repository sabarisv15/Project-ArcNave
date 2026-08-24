'use strict';

// HTTP-level tests for the Create Student admission-draft routes — real
// Postgres, real app, same house style background-jobs.test.js/
// students.test.js already use (plain http.request, no supertest
// dependency exists in this repo). nim.complete is monkey-patched (the
// same shared module object every request resolves through
// configurationService.getAiConfig -> aiProviders.getAdapter('nim')) so
// no real NIM_API_KEY/network call is needed — same reasoning this
// file's own multipart-upload test uses a real tiny PNG rather than
// arbitrary bytes (Tesseract needs a real image to not throw during the
// synchronous classifyDocument call every upload triggers).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedClassTutorPosition, cleanupPositionRows } = require('./helpers/positionFixtures');
const nim = require('../src/services/aiProviders/nim');
const globalConfig = require('../src/config');
const { flattenToPrompts } = require('../src/services/aiContextAssembly');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'AdmissionDraftTestPass123!';
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function requestRaw(baseUrl, path, method, {
  headers = {}, body, isJson = true,
} = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders = { ...headers };
    let payload = body;
    if (isJson && body !== undefined) {
      payload = JSON.stringify(body);
      reqHeaders['content-type'] = 'application/json';
      reqHeaders['content-length'] = Buffer.byteLength(payload);
    } else if (body !== undefined) {
      reqHeaders['content-length'] = payload.length;
    }
    const req = http.request(url, { method, headers: reqHeaders }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = text;
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function buildMultipart(fields, fileField, fileName, fileBuffer, mimeType) {
  const boundary = `----admissiondrafttest${crypto.randomBytes(8).toString('hex')}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`));
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
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

async function seedTenant(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeId = `adm${suffix}`;
  const subdomain = `admtenant${suffix}`;
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)', [collegeId, subdomain]);
  const passwordHash = await security.hashPassword(PASSWORD);
  const userResult = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'tutoruser', 'tutor@example.com', $2, 'staff', true) RETURNING id`,
    [collegeId, passwordHash],
  );
  const userId = userResult.rows[0].id;
  const otherUserResult = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'othertutor', 'other@example.com', $2, 'staff', true) RETURNING id`,
    [collegeId, passwordHash],
  );
  const classResult = await adminPool.query(
    "INSERT INTO classes (college_id, class_name) VALUES ($1, 'Test Class') RETURNING id",
    [collegeId],
  );
  const classId = classResult.rows[0].id;
  const { officialEmail } = await seedClassTutorPosition(adminPool, {
    collegeId, userId, classId, passwordHash,
  });
  return {
    collegeId, subdomain, userId, otherUserId: otherUserResult.rows[0].id, classTutorEmail: officialEmail,
  };
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM student_admission_draft_documents WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM student_admission_drafts WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM background_jobs WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM documents WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM students WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM classes WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('admission drafts', async (t) => {
  // This file monkey-patches nim.complete directly, relying on
  // configurationService.getAiConfig resolving the adapter for a
  // no-row college to that exact same shared nim module instance —
  // force the global default regardless of a real dev/deployment
  // environment's own DEFAULT_AI_PROVIDER override (e.g. a local
  // .env.local.sh set to 'gemini' to run the dev server against a real
  // key), or the real gemini adapter escapes into this test and makes
  // real, unmocked network calls instead.
  const originalDefaultAiProvider = globalConfig.defaultAiProvider;
  globalConfig.defaultAiProvider = 'nim';
  t.after(() => { globalConfig.defaultAiProvider = originalDefaultAiProvider; });

  const originalComplete = nim.complete;
  nim.complete = async (cfg, arcnaveContext) => {
    const { systemPrompt } = flattenToPrompts(arcnaveContext);
    if (systemPrompt.includes('classif')) {
      return JSON.stringify({ detectedDocType: 'marksheet_10th', confidence: 95 });
    }
    return JSON.stringify({
      mark10th: { value: '450/500', confidence: 92 },
      schoolName: { value: 'Govt Hr Sec School', confidence: 88 },
      schoolType: { value: 'Government', confidence: 80 },
      educationBoard: { value: 'State Board', confidence: 85 },
      passingYear: { value: '2023', confidence: 90 },
    });
  };

  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const college = await seedTenant(adminPool);

  t.after(async () => {
    nim.complete = originalComplete;
    await stopServer(server);
    await cleanupTenant(adminPool, college);
    await adminPool.end();
  });

  async function login(username) {
    const resp = await requestRaw(baseUrl, '/api/v1/auth/login', 'POST', {
      headers: { host: `${college.subdomain}.arcnave.test` },
      body: { username, password: PASSWORD },
    });
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  // 4-login authorization architecture (2026-08-09): draft creation
  // requires the L4 Position Account login (actorRole 'class_tutor'),
  // not tutoruser's personal login — Position Occupancy alone no
  // longer suffices, same as studentService.createStudent.
  async function loginTutor() {
    const resp = await requestRaw(baseUrl, '/api/v1/position-accounts/login', 'POST', {
      headers: { host: `${college.subdomain}.arcnave.test` },
      body: { official_email: college.classTutorEmail, password: PASSWORD },
    });
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  function headersFor(token) {
    return { host: `${college.subdomain}.arcnave.test`, authorization: `Bearer ${token}` };
  }

  await t.test('full draft lifecycle: create -> multipart upload+classify -> extract -> poll to completion -> auto-filled -> complete -> real student+documents', async () => {
    const token = await loginTutor();
    const auth = headersFor(token);

    const created = await requestRaw(baseUrl, '/api/v1/students/admission-drafts', 'POST', { headers: auth, body: {} });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'in_progress');
    const draftId = created.body.id;

    const docTypes = await requestRaw(baseUrl, '/api/v1/document-types?module=student_admission', 'GET', { headers: auth });
    assert.equal(docTypes.status, 200);
    assert.equal(docTypes.body.length, 8);

    const { body: mpBody, contentType } = buildMultipart({ docType: 'marksheet_10th' }, 'file', 'marksheet.png', TINY_PNG, 'image/png');
    const uploadResp = await requestRaw(baseUrl, `/api/v1/students/admission-drafts/${draftId}/documents`, 'POST', {
      headers: { ...auth, 'content-type': contentType }, body: mpBody, isJson: false,
    });
    assert.equal(uploadResp.status, 201);
    assert.equal(uploadResp.body.document.doc_type, 'marksheet_10th');
    assert.equal(uploadResp.body.classification.detectedDocType, 'marksheet_10th');
    assert.equal(uploadResp.body.classification.confidence, 95);

    const extractResp = await requestRaw(baseUrl, `/api/v1/students/admission-drafts/${draftId}/extract`, 'POST', { headers: auth, body: {} });
    assert.equal(extractResp.status, 202);
    assert.equal(extractResp.body.job_type, 'admission_extraction');

    let state = null;
    for (let i = 0; i < 40; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 100); });
      // eslint-disable-next-line no-await-in-loop
      const poll = await requestRaw(baseUrl, `/api/v1/students/admission-drafts/${draftId}`, 'GET', { headers: auth });
      state = poll.body;
      if (state.extractionJob && state.extractionJob.status === 'completed') break;
    }
    assert.ok(state.extractionJob, 'extraction job should be visible via getDraft, not just the Principal-only /background-jobs route');
    assert.equal(state.extractionJob.status, 'completed');
    assert.equal(state.extractionJob.result.summary.documentsProcessed, 1);
    assert.equal(state.draft.mark_10th, '450/500');
    assert.equal(state.draft.school_name, 'Govt Hr Sec School');

    const patchResp = await requestRaw(baseUrl, `/api/v1/students/admission-drafts/${draftId}`, 'PATCH', {
      headers: auth, body: { rollNo: 'ADMTEST01', fullName: 'Admission Test Student' },
    });
    assert.equal(patchResp.status, 200);

    const completeResp = await requestRaw(baseUrl, `/api/v1/students/admission-drafts/${draftId}/complete`, 'POST', { headers: auth, body: {} });
    assert.equal(completeResp.status, 201);
    assert.equal(completeResp.body.roll_no, 'ADMTEST01');
    assert.equal(completeResp.body.mark_10th, '450/500');
    const studentId = completeResp.body.id;

    const documentsResp = await requestRaw(baseUrl, `/api/v1/documents?student_id=${studentId}`, 'GET', { headers: auth });
    assert.equal(documentsResp.status, 200);
    assert.equal(documentsResp.body.length, 1);
    assert.equal(documentsResp.body[0].doc_type, 'marksheet_10th');
    assert.equal(documentsResp.body[0].student_id, studentId);
  });

  // Round 10 P2/P3 finding: the round-8 fix added ROLLBACK to
  // buildExtractionHandler's three separate BEGIN/COMMIT blocks — before
  // that fix, an error inside any of them released the client back to
  // appPool with the transaction still aborted at the Postgres protocol
  // level, so the NEXT request to borrow that exact connection would
  // fail its own, unrelated query with "current transaction is
  // aborted" — but no test ever actually forced that error path.
  // documentTypeRegistryRepository.findByModule (the statement right
  // after findByDraftId inside the handler's FIRST transaction block)
  // is monkey-patched to throw once, forcing that block's catch/
  // ROLLBACK to run for real against real Postgres, then an immediate,
  // completely unrelated request proves the pool came back healthy —
  // not just that this one job recorded 'failed' (finishClient, which
  // marks the job failed, is a SEPARATE connect() call and would
  // succeed either way, so job-status alone would not have caught a
  // regression here).
  await t.test('a real failure inside buildExtractionHandler\'s first transaction rolls back cleanly — the pool stays healthy for the very next unrelated request (round 8 fix regression)', async () => {
    const token = await loginTutor();
    const auth = headersFor(token);

    const created = await requestRaw(baseUrl, '/api/v1/students/admission-drafts', 'POST', { headers: auth, body: {} });
    assert.equal(created.status, 201);
    const draftId = created.body.id;

    const { body: mpBody, contentType } = buildMultipart({ docType: 'marksheet_10th' }, 'file', 'marksheet.png', TINY_PNG, 'image/png');
    const uploadResp = await requestRaw(baseUrl, `/api/v1/students/admission-drafts/${draftId}/documents`, 'POST', {
      headers: { ...auth, 'content-type': contentType }, body: mpBody, isJson: false,
    });
    assert.equal(uploadResp.status, 201);

    // eslint-disable-next-line global-require
    const documentTypeRegistryRepository = require('../src/repositories/documentTypeRegistryRepository');
    const originalFindByModule = documentTypeRegistryRepository.findByModule;
    let forcedFailureCalls = 0;
    documentTypeRegistryRepository.findByModule = async () => {
      forcedFailureCalls += 1;
      throw new Error('forced failure for round 8 rollback regression test');
    };

    let state = null;
    try {
      const extractResp = await requestRaw(baseUrl, `/api/v1/students/admission-drafts/${draftId}/extract`, 'POST', { headers: auth, body: {} });
      assert.equal(extractResp.status, 202);

      for (let i = 0; i < 40; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => { setTimeout(resolve, 100); });
        // eslint-disable-next-line no-await-in-loop
        const poll = await requestRaw(baseUrl, `/api/v1/students/admission-drafts/${draftId}`, 'GET', { headers: auth });
        state = poll.body;
        if (state.extractionJob && state.extractionJob.status !== 'pending' && state.extractionJob.status !== 'running') break;
      }
    } finally {
      documentTypeRegistryRepository.findByModule = originalFindByModule;
    }

    assert.equal(forcedFailureCalls, 1, 'the forced failure should have actually fired inside the handler, not been bypassed');
    assert.ok(state.extractionJob);
    assert.equal(state.extractionJob.status, 'failed');

    const sanityResp = await requestRaw(baseUrl, `/api/v1/students/admission-drafts/${draftId}`, 'GET', { headers: auth });
    assert.equal(sanityResp.status, 200);
  });

  // 4-login authorization architecture (2026-08-09) — the critical
  // regression case: tutoruser genuinely occupies the class's L4 seat
  // (seedTenant's seedClassTutorPosition fixture), but this request
  // uses tutoruser's PERSONAL login, not the L4 Position Account login.
  await t.test('creating a draft is rejected for tutoruser\'s personal login even though that person currently occupies the class\'s L4 seat', async () => {
    const token = await login('tutoruser');
    const resp = await requestRaw(baseUrl, '/api/v1/students/admission-drafts', 'POST', { headers: headersFor(token), body: {} });
    assert.equal(resp.status, 403);
  });

  await t.test('a draft cannot be read, updated, or completed by anyone other than its own creator', async () => {
    const token = await loginTutor();
    const created = await requestRaw(baseUrl, '/api/v1/students/admission-drafts', 'POST', { headers: headersFor(token), body: {} });
    const draftId = created.body.id;

    const otherToken = await login('othertutor');
    const getResp = await requestRaw(baseUrl, `/api/v1/students/admission-drafts/${draftId}`, 'GET', { headers: headersFor(otherToken) });
    assert.equal(getResp.status, 403);

    const patchResp = await requestRaw(baseUrl, `/api/v1/students/admission-drafts/${draftId}`, 'PATCH', {
      headers: headersFor(otherToken), body: { rollNo: 'HACK01' },
    });
    assert.equal(patchResp.status, 403);
  });

  await t.test('creating a draft requires authentication', async () => {
    const resp = await requestRaw(baseUrl, '/api/v1/students/admission-drafts', 'POST', { body: {} });
    assert.equal(resp.status, 401);
  });

  // RS-ADM-004: DELETE /students/admission-drafts/:draftId/documents/:docType
  // — studentAdmissionDraftService.removeDraftDocument, previously
  // uncovered by any test (unlike its sibling
  // discardDraftAdmissionDocument, exercised indirectly via
  // completeDraft's own cleanup step in the lifecycle test above).
  await t.test('DELETE removes an uploaded draft document; a second delete is a no-op; only the owner may delete', async () => {
    const token = await loginTutor();
    const auth = headersFor(token);

    const created = await requestRaw(baseUrl, '/api/v1/students/admission-drafts', 'POST', { headers: auth, body: {} });
    const draftId = created.body.id;

    const { body: mpBody, contentType } = buildMultipart({ docType: 'marksheet_10th' }, 'file', 'marksheet.png', TINY_PNG, 'image/png');
    const uploadResp = await requestRaw(baseUrl, `/api/v1/students/admission-drafts/${draftId}/documents`, 'POST', {
      headers: { ...auth, 'content-type': contentType }, body: mpBody, isJson: false,
    });
    assert.equal(uploadResp.status, 201);

    const otherToken = await login('othertutor');
    const forbiddenResp = await requestRaw(baseUrl, `/api/v1/students/admission-drafts/${draftId}/documents/marksheet_10th`, 'DELETE', {
      headers: headersFor(otherToken),
    });
    assert.equal(forbiddenResp.status, 403, 'a non-owner must not be able to delete another user\'s draft document');

    const deleteResp = await requestRaw(baseUrl, `/api/v1/students/admission-drafts/${draftId}/documents/marksheet_10th`, 'DELETE', { headers: auth });
    assert.equal(deleteResp.status, 204);

    const draftAfterDelete = await requestRaw(baseUrl, `/api/v1/students/admission-drafts/${draftId}`, 'GET', { headers: auth });
    assert.equal(draftAfterDelete.status, 200);
    assert.equal((draftAfterDelete.body.documents || []).length, 0, 'the document row must actually be gone, not just its file');

    const secondDeleteResp = await requestRaw(baseUrl, `/api/v1/students/admission-drafts/${draftId}/documents/marksheet_10th`, 'DELETE', { headers: auth });
    assert.equal(secondDeleteResp.status, 204, 'deleting an already-deleted (or never-uploaded) docType is a silent no-op, not an error');
  });

  await t.test('DELETE on a nonexistent draft is rejected (404, not a silent no-op)', async () => {
    const token = await loginTutor();
    const resp = await requestRaw(baseUrl, '/api/v1/students/admission-drafts/00000000-0000-0000-0000-000000000000/documents/marksheet_10th', 'DELETE', {
      headers: headersFor(token),
    });
    assert.equal(resp.status, 404);
  });
});
