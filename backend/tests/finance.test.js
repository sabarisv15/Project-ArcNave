'use strict';

// Integration tests for the Finance API (/api/v1/finance/...) — real
// HTTP requests against a live Postgres, same discipline as
// staff.test.js/attendance.test.js.
//
// RS-FIN-001 (D4, Stage 4): fee_structures is gone entirely — the old
// fee-structure create/update/list test block is gone with it, not
// ported. RS-FIN-002/003 (D5): a fee status is now a single mark per
// student (class tutor, own class only, receipt required) plus a
// correction path (hod approves) — every test below is rebuilt around
// that shape.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedClassTutorPosition, seedHodPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'FinanceTestPass123!';

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
  const college = { collegeId: `fin${label}${suffix}`, subdomain: `fintenant${label}${suffix}` };
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [college.collegeId, college.subdomain],
  );
  const passwordHash = await security.hashPassword(PASSWORD);
  const userIds = {};
  for (const [username, role] of [
    ['principaluser', 'principal'],
    ['tutoruser', 'staff'],
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
    `INSERT INTO departments (college_id, name, approved_intake) VALUES ($1, 'Finance API Test Dept', 60) RETURNING id`,
    [college.collegeId],
  );
  // financeService.requestFeeCorrection now resolves its approver via
  // workflowChainService.resolveApproverChain (entityType
  // 'fee_correction'), same as every other chain-driven workflow — the
  // 'hod' step resolves through identityService.resolvePositionOccupant
  // (Position/Account/Occupant model), not a raw `staff` row, hence
  // seedHodPosition here (mirrors seedClassTutorPosition below, one
  // level up). The `staff` row is still seeded too since other Finance
  // API assertions independently expect a real staff record for this
  // user.
  await adminPool.query(
    `INSERT INTO staff (college_id, user_id, full_name, department_id) VALUES ($1, $2, 'Finance API Test HOD', $3)`,
    [college.collegeId, userIds.hoduser, department.rows[0].id],
  );
  await seedHodPosition(adminPool, {
    collegeId: college.collegeId, userId: userIds.hoduser, departmentId: department.rows[0].id, passwordHash,
  });

  const cls = await adminPool.query(
    `INSERT INTO classes (college_id, class_name, department_id) VALUES ($1, $2, $3) RETURNING id`,
    [college.collegeId, 'Finance API Test Class', department.rows[0].id],
  );
  const { officialEmail: tutorEmail } = await seedClassTutorPosition(adminPool, {
    collegeId: college.collegeId, userId: userIds.tutoruser, classId: cls.rows[0].id, passwordHash,
  });

  const receiptDoc = await adminPool.query(
    `INSERT INTO documents (college_id, doc_type, file_name, storage_path, mime_type, file_size_bytes, uploaded_by_user_id)
     VALUES ($1, 'fee_receipt', 'receipt.pdf', $2, 'application/pdf', 1024, $3) RETURNING id`,
    [college.collegeId, `${college.collegeId}/receipts/${crypto.randomUUID()}.pdf`, userIds.tutoruser],
  );

  return {
    ...college,
    userIds,
    departmentId: department.rows[0].id,
    classId: cls.rows[0].id,
    receiptDocumentId: receiptDoc.rows[0].id,
    classTutorEmail: tutorEmail,
  };
}

async function seedStudent(adminPool, college, label) {
  const student = await adminPool.query(
    `INSERT INTO students (college_id, roll_no, full_name, class_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [college.collegeId, `FIN-${label}-${crypto.randomUUID().slice(0, 6)}`, `Finance Test Student ${label}`, college.classId],
  );
  return student.rows[0].id;
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM fee_corrections WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM approval_history WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM workflow_requests WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM fee_payments WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM documents WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM students WHERE college_id = $1', [college.collegeId]);
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM classes WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM departments WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('finance', async (t) => {
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

  // 4-login authorization architecture (2026-08-09): fee marking/
  // scholarship/correction-request tutor authority now requires the L4
  // Position Account login — Position Occupancy alone (tutoruser's
  // personal login) no longer suffices.
  async function loginTutor(college) {
    const resp = await requestJson(
      baseUrl,
      '/api/v1/position-accounts/login',
      'POST',
      { headers: { host: hostFor(college.subdomain) }, body: { official_email: college.classTutorEmail, password: PASSWORD } },
    );
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  // --- fee_payments: mark (RS-FIN-002) ---

  await t.test('the class tutor marks a fee payment paid: 201 with the created row, snake_case', async () => {
    const studentId = await seedStudent(adminPool, collegeA, 'mark1');
    const token = await loginTutor(collegeA);
    const resp = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: studentId, status: 'paid', receipt_document_id: collegeA.receiptDocumentId,
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.student_id, studentId);
    assert.equal(resp.body.status, 'paid');
    assert.equal(resp.body.marked_by_user_id, collegeA.userIds.tutoruser);
    assert.equal(resp.body.college_id, collegeA.collegeId);
    assert.equal('fee_structure_id' in resp.body, false);
  });

  await t.test('mark rejects a missing status with 400, not a 500', async () => {
    const studentId = await seedStudent(adminPool, collegeA, 'nostatus');
    const token = await loginTutor(collegeA);
    const resp = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: studentId, receipt_document_id: collegeA.receiptDocumentId,
    });
    assert.equal(resp.status, 400);
  });

  await t.test('mark rejects a missing receipt_document_id with 400 — required evidence of record', async () => {
    const studentId = await seedStudent(adminPool, collegeA, 'noreceipt');
    const token = await loginTutor(collegeA);
    const resp = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: studentId, status: 'paid',
    });
    assert.equal(resp.status, 400);
  });

  await t.test('mark rejects an unknown status with 400', async () => {
    const studentId = await seedStudent(adminPool, collegeA, 'badstatus');
    const token = await loginTutor(collegeA);
    const resp = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: studentId, status: 'partially_paid', receipt_document_id: collegeA.receiptDocumentId,
    });
    assert.equal(resp.status, 400);
  });

  await t.test('mark with a nonexistent student_id returns 404, not a 500', async () => {
    const token = await loginTutor(collegeA);
    const resp = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: crypto.randomUUID(), status: 'paid', receipt_document_id: collegeA.receiptDocumentId,
    });
    assert.equal(resp.status, 404);
  });

  await t.test('mark with a nonexistent receipt_document_id returns 404, not a 500', async () => {
    const studentId = await seedStudent(adminPool, collegeA, 'badreceipt');
    const token = await loginTutor(collegeA);
    const resp = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: studentId, status: 'paid', receipt_document_id: crypto.randomUUID(),
    });
    assert.equal(resp.status, 404);
  });

  await t.test('mark requires authentication', async () => {
    const studentId = await seedStudent(adminPool, collegeA, 'noauth');
    const resp = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA), {
      student_id: studentId, status: 'paid', receipt_document_id: collegeA.receiptDocumentId,
    });
    assert.equal(resp.status, 401);
  });

  await t.test('mark is rejected (403) for an authenticated actor who is not the student\'s own class tutor', async () => {
    const studentId = await seedStudent(adminPool, collegeA, 'wrongactor');
    const token = await login(collegeA, 'staffuser');
    const resp = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: studentId, status: 'paid', receipt_document_id: collegeA.receiptDocumentId,
    });
    assert.equal(resp.status, 403);
  });

  // 4-login authorization architecture (2026-08-09) — the critical
  // regression case: tutoruser genuinely occupies this class's L4 seat,
  // but this request uses their personal login. Must be rejected
  // exactly like a stranger.
  await t.test('mark is rejected (403) for tutoruser\'s personal login even though that person occupies this class\'s L4 seat', async () => {
    const studentId = await seedStudent(adminPool, collegeA, 'personallogin');
    const token = await login(collegeA, 'tutoruser');
    const resp = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: studentId, status: 'paid', receipt_document_id: collegeA.receiptDocumentId,
    });
    assert.equal(resp.status, 403);
  });

  await t.test('marking the same student twice is a real 409 (FeePaymentAlreadyMarkedError), not an upsert', async () => {
    const studentId = await seedStudent(adminPool, collegeA, 'remark');
    const token = await loginTutor(collegeA);
    const first = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: studentId, status: 'not_paid', receipt_document_id: collegeA.receiptDocumentId,
    });
    assert.equal(first.status, 201);

    const second = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: studentId, status: 'paid', receipt_document_id: collegeA.receiptDocumentId,
    });
    assert.equal(second.status, 409);
  });

  // --- fee_payments: read ---

  await t.test('GET requires student_id', async () => {
    const token = await loginTutor(collegeA);
    const resp = await get(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token));
    assert.equal(resp.status, 400);
  });

  await t.test('GET returns 404 for a student with no fee payment marked yet', async () => {
    const studentId = await seedStudent(adminPool, collegeA, 'unmarked');
    const token = await loginTutor(collegeA);
    const resp = await get(baseUrl, `/api/v1/finance/fee-payments?student_id=${studentId}`, headersFor(collegeA, token));
    assert.equal(resp.status, 404);
  });

  await t.test('GET returns this student\'s effective fee status, effective:false before any correction', async () => {
    const studentId = await seedStudent(adminPool, collegeA, 'read1');
    const token = await loginTutor(collegeA);
    await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: studentId, status: 'paid', receipt_document_id: collegeA.receiptDocumentId,
    });

    const resp = await get(baseUrl, `/api/v1/finance/fee-payments?student_id=${studentId}`, headersFor(collegeA, token));
    assert.equal(resp.status, 200);
    assert.equal(resp.body.student_id, studentId);
    assert.equal(resp.body.status, 'paid');
    assert.equal(resp.body.effective, false);
  });

  await t.test('GET requires authentication', async () => {
    const studentId = await seedStudent(adminPool, collegeA, 'noauthread');
    const resp = await get(baseUrl, `/api/v1/finance/fee-payments?student_id=${studentId}`, headersFor(collegeA));
    assert.equal(resp.status, 401);
  });

  await t.test('a student\'s fee payment from tenant A is invisible to tenant B (RLS via a real student_id collision attempt)', async () => {
    const studentIdA = await seedStudent(adminPool, collegeA, 'crosstenant');
    const tokenA = await loginTutor(collegeA);
    await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, tokenA), {
      student_id: studentIdA, status: 'paid', receipt_document_id: collegeA.receiptDocumentId,
    });

    const tokenB = await loginTutor(collegeB);
    const resp = await get(baseUrl, `/api/v1/finance/fee-payments?student_id=${studentIdA}`, headersFor(collegeB, tokenB));
    assert.equal(resp.status, 404);
  });

  // --- fee corrections (RS-FIN-003) ---

  await t.test('the golden path: mark -> request correction -> hod approves -> GET reflects the corrected, effective value', async () => {
    const studentId = await seedStudent(adminPool, collegeA, 'correction1');
    const tutorToken = await loginTutor(collegeA);
    const marked = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, tutorToken), {
      student_id: studentId, status: 'not_paid', receipt_document_id: collegeA.receiptDocumentId,
    });
    assert.equal(marked.status, 201);

    const requested = await post(
      baseUrl,
      `/api/v1/finance/fee-payments/${marked.body.id}/corrections`,
      headersFor(collegeA, tutorToken),
      { proposed_status: 'paid', reason: 'receipt was found afterwards' },
    );
    assert.equal(requested.status, 201);
    assert.equal(requested.body.proposed_status, 'paid');
    assert.ok(requested.body.correction_id);

    // Original untouched while pending.
    const stillOriginal = await get(baseUrl, `/api/v1/finance/fee-payments?student_id=${studentId}`, headersFor(collegeA, tutorToken));
    assert.equal(stillOriginal.body.status, 'not_paid');
    assert.equal(stillOriginal.body.effective, false);

    const hodToken = await login(collegeA, 'hoduser');
    const approved = await post(
      baseUrl,
      `/api/v1/finance/fee-corrections/${requested.body.correction_id}/approve`,
      headersFor(collegeA, hodToken),
    );
    assert.equal(approved.status, 200);
    assert.ok(approved.body.applied_at);

    const effective = await get(baseUrl, `/api/v1/finance/fee-payments?student_id=${studentId}`, headersFor(collegeA, tutorToken));
    assert.equal(effective.body.status, 'paid');
    assert.equal(effective.body.effective, true);
    assert.equal(effective.body.effective_correction_id, requested.body.correction_id);
  });

  await t.test('a rejected correction never becomes effective', async () => {
    const studentId = await seedStudent(adminPool, collegeA, 'correction2');
    const tutorToken = await loginTutor(collegeA);
    const marked = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, tutorToken), {
      student_id: studentId, status: 'not_paid', receipt_document_id: collegeA.receiptDocumentId,
    });

    const requested = await post(
      baseUrl,
      `/api/v1/finance/fee-payments/${marked.body.id}/corrections`,
      headersFor(collegeA, tutorToken),
      { proposed_status: 'paid' },
    );
    assert.equal(requested.status, 201);

    const hodToken = await login(collegeA, 'hoduser');
    const rejected = await post(
      baseUrl,
      `/api/v1/finance/fee-corrections/${requested.body.correction_id}/reject`,
      headersFor(collegeA, hodToken),
    );
    assert.equal(rejected.status, 200);

    const effective = await get(baseUrl, `/api/v1/finance/fee-payments?student_id=${studentId}`, headersFor(collegeA, tutorToken));
    assert.equal(effective.body.status, 'not_paid');
    assert.equal(effective.body.effective, false);
  });

  await t.test('a fee_correction cannot be approved through the generic workflow-requests endpoint — 409, correction never applied', async () => {
    const studentId = await seedStudent(adminPool, collegeA, 'genericguard');
    const tutorToken = await loginTutor(collegeA);
    const marked = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, tutorToken), {
      student_id: studentId, status: 'not_paid', receipt_document_id: collegeA.receiptDocumentId,
    });
    const requested = await post(
      baseUrl,
      `/api/v1/finance/fee-payments/${marked.body.id}/corrections`,
      headersFor(collegeA, tutorToken),
      { proposed_status: 'paid' },
    );

    const hodToken = await login(collegeA, 'hoduser');
    const genericAttempt = await post(
      baseUrl,
      `/api/v1/workflow-requests/${requested.body.workflow_request_id}/approve`,
      headersFor(collegeA, hodToken),
    );
    assert.equal(genericAttempt.status, 409);

    const effective = await get(baseUrl, `/api/v1/finance/fee-payments?student_id=${studentId}`, headersFor(collegeA, tutorToken));
    assert.equal(effective.body.status, 'not_paid');
    assert.equal(effective.body.effective, false);
  });

  await t.test('requesting a correction on a nonexistent fee payment returns 404', async () => {
    const token = await loginTutor(collegeA);
    const resp = await post(
      baseUrl,
      `/api/v1/finance/fee-payments/${crypto.randomUUID()}/corrections`,
      headersFor(collegeA, token),
      { proposed_status: 'paid' },
    );
    assert.equal(resp.status, 404);
  });

  await t.test('GET corrections for a payment lists the request', async () => {
    const studentId = await seedStudent(adminPool, collegeA, 'listcorrections');
    const tutorToken = await loginTutor(collegeA);
    const marked = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, tutorToken), {
      student_id: studentId, status: 'not_paid', receipt_document_id: collegeA.receiptDocumentId,
    });
    await post(
      baseUrl,
      `/api/v1/finance/fee-payments/${marked.body.id}/corrections`,
      headersFor(collegeA, tutorToken),
      { proposed_status: 'paid' },
    );

    const resp = await get(baseUrl, `/api/v1/finance/fee-payments/${marked.body.id}/corrections`, headersFor(collegeA, tutorToken));
    assert.equal(resp.status, 200);
    assert.ok(Array.isArray(resp.body));
    assert.equal(resp.body.length, 1);
    assert.equal(resp.body[0].proposed_status, 'paid');
  });

  // --- Audit attribution ---

  await t.test('mark writes exactly one audit_log row, attributed to the actor', async () => {
    const studentId = await seedStudent(adminPool, collegeA, 'audit1');
    const token = await loginTutor(collegeA);
    const resp = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: studentId, status: 'paid', receipt_document_id: collegeA.receiptDocumentId,
    });
    assert.equal(resp.status, 201);

    const rows = await adminPool.query(
      `SELECT action, user_id, entity FROM audit_log WHERE college_id = $1 AND entity_id = $2`,
      [collegeA.collegeId, resp.body.id],
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].action, 'fee_payment_marked');
    assert.equal(rows.rows[0].entity, 'fee_payments');
    assert.equal(rows.rows[0].user_id, collegeA.userIds.tutoruser);
  });

  await t.test('approving a correction writes an audit_log row attributed to the approving hod', async () => {
    const studentId = await seedStudent(adminPool, collegeA, 'audit2');
    const tutorToken = await loginTutor(collegeA);
    const marked = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, tutorToken), {
      student_id: studentId, status: 'not_paid', receipt_document_id: collegeA.receiptDocumentId,
    });
    const requested = await post(
      baseUrl,
      `/api/v1/finance/fee-payments/${marked.body.id}/corrections`,
      headersFor(collegeA, tutorToken),
      { proposed_status: 'paid' },
    );

    const hodToken = await login(collegeA, 'hoduser');
    await post(baseUrl, `/api/v1/finance/fee-corrections/${requested.body.correction_id}/approve`, headersFor(collegeA, hodToken));

    const rows = await adminPool.query(
      `SELECT action, user_id FROM audit_log WHERE college_id = $1 AND entity_id = $2 AND action = 'fee_correction_approved'`,
      [collegeA.collegeId, requested.body.correction_id],
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].user_id, collegeA.userIds.hoduser);
  });
});
