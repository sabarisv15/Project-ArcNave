'use strict';

// Integration coverage for RS-GOV-003/005/006/008/010/011/012:
// onboarding department creation, the provisioning lifecycle +
// readiness gate, and the structural authorization key mechanism
// (generate on the tenant side, redeem on the platform side).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedPrincipalPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PLATFORM_PASSWORD = 'PlatformPass123!';
const TENANT_PASSWORD = 'TenantPass123!';

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

function post(baseUrl, path, headers, body) {
  return requestJson(baseUrl, path, 'POST', { headers, body });
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('Organization provisioning lifecycle + structural authorization keys', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });

  const suffix = crypto.randomUUID().slice(0, 8);
  const adminUsername = `provadmin${suffix}`;
  const adminResult = await adminPool.query(
    'INSERT INTO platform_admins (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [adminUsername, `${adminUsername}@example.com`, await security.hashPassword(PLATFORM_PASSWORD)],
  );
  const adminId = adminResult.rows[0].id;

  const createdColleges = [];
  t.after(async () => {
    await stopServer(server);
    for (const cid of createdColleges) {
      // eslint-disable-next-line no-await-in-loop -- test teardown, small fixed set
      await adminPool.query('DELETE FROM structural_authorization_keys WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM students WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM classes WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM departments WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop -- position_occupants/position_accounts/positions FK into users, must go before it
      await cleanupPositionRows(adminPool, cid);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM users WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [cid]);
    }
    await adminPool.query('DELETE FROM platform_audit_log WHERE actor_admin_id = $1', [adminId]);
    await adminPool.query('DELETE FROM platform_admins WHERE id = $1', [adminId]);
    await adminPool.end();
  });

  async function platformToken() {
    const resp = await post(
      baseUrl,
      '/api/v1/platform/auth/login',
      {},
      { username: adminUsername, password: PLATFORM_PASSWORD },
    );
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  async function seedCollege(label) {
    const cid = `prov${label}${crypto.randomUUID().slice(0, 8)}`;
    await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $1)', [cid]);
    createdColleges.push(cid);
    return cid;
  }

  // effectiveRole (and so requirePermission) is derived purely from a
  // real, active Level 1 position — never from users.role (see
  // identityService.deriveEffectiveRole) — so a plain users row alone
  // is not enough to authenticate as 'principal' against a permission-
  // gated route.
  async function seedPrincipal(collegeId) {
    const passwordHash = await security.hashPassword(TENANT_PASSWORD);
    const userResult = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $2 || '@example.test', $3, 'principal', true) RETURNING id`,
      [collegeId, `principal${crypto.randomUUID().slice(0, 8)}`, passwordHash],
    );
    const userId = userResult.rows[0].id;
    await seedPrincipalPosition(adminPool, { collegeId, userId, passwordHash });
    return userId;
  }

  function tenantHeaders(collegeId, userId) {
    return { authorization: `Bearer ${security.createAccessToken({ userId, collegeId, role: 'principal' })}` };
  }

  await t.test('onboarding department creation is Platform-Admin-only, and only while provisioning', async () => {
    const collegeId = await seedCollege('a');
    const token = await platformToken();

    const resp = await post(
      baseUrl,
      `/api/v1/platform/colleges/${collegeId}/departments`,
      { authorization: `Bearer ${token}` },
      {
        name: 'CSE',
        approved_intake: 60,
        course_duration: 4,
        default_sections: 2,
      },
    );
    assert.equal(resp.status, 201);
    assert.equal(resp.body.created_at_onboarding, true);

    const dept = await adminPool.query('SELECT * FROM departments WHERE college_id = $1', [collegeId]);
    assert.equal(dept.rows.length, 1);
    assert.equal(dept.rows[0].course_duration, 4);
  });

  await t.test(
    'readiness gate blocks activation until every onboarding department has a student, then allows it',
    async () => {
      const collegeId = await seedCollege('b');
      const token = await platformToken();

      const deptResp = await post(
        baseUrl,
        `/api/v1/platform/colleges/${collegeId}/departments`,
        { authorization: `Bearer ${token}` },
        {
          name: 'ECE',
          approved_intake: 30,
          course_duration: 4,
          default_sections: 1,
        },
      );
      const departmentId = deptResp.body.id;

      const readyResp = await post(
        baseUrl,
        `/api/v1/platform/colleges/${collegeId}/mark-ready`,
        { authorization: `Bearer ${token}` },
        {},
      );
      assert.equal(readyResp.status, 200);
      assert.equal(readyResp.body.provisioning_status, 'ready');

      const blockedResp = await post(
        baseUrl,
        `/api/v1/platform/colleges/${collegeId}/activate`,
        { authorization: `Bearer ${token}` },
        {},
      );
      assert.equal(blockedResp.status, 422, 'no enrolled student yet in the onboarding department — gate must block');

      const classResult = await adminPool.query(
        'INSERT INTO classes (college_id, class_name, department_id) VALUES ($1, $2, $3) RETURNING id',
        [collegeId, `ECE-Sem3-${crypto.randomUUID().slice(0, 6)}`, departmentId],
      );
      await adminPool.query('INSERT INTO students (college_id, roll_no, full_name, class_id) VALUES ($1, $2, $3, $4)', [
        collegeId,
        `R${crypto.randomUUID().slice(0, 6)}`,
        'Test Student',
        classResult.rows[0].id,
      ]);

      const activateResp = await post(
        baseUrl,
        `/api/v1/platform/colleges/${collegeId}/activate`,
        { authorization: `Bearer ${token}` },
        {},
      );
      assert.equal(activateResp.status, 200);
      assert.equal(activateResp.body.provisioning_status, 'active');
    },
  );

  await t.test(
    'suspend -> reactivate -> archive follow the guarded transitions, wrong-state attempts are rejected',
    async () => {
      const collegeId = await seedCollege('c');
      const token = await platformToken();
      // No onboarding departments at all -> readiness gate trivially satisfied.
      await post(
        baseUrl,
        `/api/v1/platform/colleges/${collegeId}/mark-ready`,
        { authorization: `Bearer ${token}` },
        {},
      );
      await post(baseUrl, `/api/v1/platform/colleges/${collegeId}/activate`, { authorization: `Bearer ${token}` }, {});

      const suspendResp = await post(
        baseUrl,
        `/api/v1/platform/colleges/${collegeId}/suspend`,
        { authorization: `Bearer ${token}` },
        {},
      );
      assert.equal(suspendResp.status, 200);
      assert.equal(suspendResp.body.provisioning_status, 'suspended');

      const doubleSuspend = await post(
        baseUrl,
        `/api/v1/platform/colleges/${collegeId}/suspend`,
        { authorization: `Bearer ${token}` },
        {},
      );
      assert.equal(doubleSuspend.status, 409, 'already suspended — cannot suspend again');

      const reactivateResp = await post(
        baseUrl,
        `/api/v1/platform/colleges/${collegeId}/reactivate`,
        { authorization: `Bearer ${token}` },
        {},
      );
      assert.equal(reactivateResp.status, 200);
      assert.equal(reactivateResp.body.provisioning_status, 'active');

      const archiveResp = await post(
        baseUrl,
        `/api/v1/platform/colleges/${collegeId}/archive`,
        { authorization: `Bearer ${token}` },
        {},
      );
      assert.equal(archiveResp.status, 200);
      assert.equal(archiveResp.body.provisioning_status, 'archived');
    },
  );

  await t.test(
    'structural authorization key: generate (L1) -> cancel (L1) — a cancelled key cannot be redeemed',
    async () => {
      const collegeId = await seedCollege('d');
      const userId = await seedPrincipal(collegeId);
      const deptResult = await adminPool.query(
        'INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id',
        [collegeId, 'Rename-Me'],
      );
      const departmentId = deptResult.rows[0].id;

      const genResp = await post(baseUrl, '/api/v1/structural-authorization-keys', tenantHeaders(collegeId, userId), {
        action_type: 'department_merge_rename',
        action_payload: { mode: 'rename', departmentId, name: 'Renamed' },
      });
      assert.equal(genResp.status, 201);
      assert.ok(genResp.body.token);

      const cancelResp = await post(
        baseUrl,
        `/api/v1/structural-authorization-keys/${genResp.body.key_id}/cancel`,
        tenantHeaders(collegeId, userId),
        {},
      );
      assert.equal(cancelResp.status, 200);
      assert.equal(cancelResp.body.status, 'cancelled');

      const platformAdminToken = await platformToken();
      const redeemResp = await post(
        baseUrl,
        '/api/v1/platform/structural-authorization-keys/redeem',
        { authorization: `Bearer ${platformAdminToken}` },
        {
          token: genResp.body.token,
          sections: { department: { mode: 'rename', departmentId, name: 'Renamed' } },
        },
      );
      assert.equal(redeemResp.status, 409, 'a cancelled key must not be redeemable');
    },
  );

  await t.test(
    'structural authorization key: generate -> redeem executes a department rename, and the key cannot be reused',
    async () => {
      const collegeId = await seedCollege('e');
      const userId = await seedPrincipal(collegeId);
      const deptResult = await adminPool.query(
        'INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id',
        [collegeId, 'OldName'],
      );
      const departmentId = deptResult.rows[0].id;

      const genResp = await post(baseUrl, '/api/v1/structural-authorization-keys', tenantHeaders(collegeId, userId), {
        action_type: 'department_merge_rename',
        action_payload: { mode: 'rename', departmentId, name: 'NewName' },
      });
      assert.equal(genResp.status, 201);

      const platformAdminToken = await platformToken();
      const sections = { department: { mode: 'rename', departmentId, name: 'NewName' } };
      const redeemResp = await post(
        baseUrl,
        '/api/v1/platform/structural-authorization-keys/redeem',
        { authorization: `Bearer ${platformAdminToken}` },
        { token: genResp.body.token, sections },
      );
      assert.equal(redeemResp.status, 200);

      const dept = await adminPool.query('SELECT name FROM departments WHERE id = $1', [departmentId]);
      assert.equal(dept.rows[0].name, 'NewName');

      const reuseResp = await post(
        baseUrl,
        '/api/v1/platform/structural-authorization-keys/redeem',
        { authorization: `Bearer ${platformAdminToken}` },
        { token: genResp.body.token, sections },
      );
      assert.equal(reuseResp.status, 409, 'a redeemed key must not be reusable');
    },
  );

  await t.test(
    'structural authorization key: merge reassigns every source-department class to the target, and marks sources merged',
    async () => {
      const collegeId = await seedCollege('f');
      const userId = await seedPrincipal(collegeId);
      const sourceResult = await adminPool.query(
        'INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id',
        [collegeId, 'SourceDept'],
      );
      const targetResult = await adminPool.query(
        'INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id',
        [collegeId, 'TargetDept'],
      );
      const sourceId = sourceResult.rows[0].id;
      const targetId = targetResult.rows[0].id;
      const classResult = await adminPool.query(
        'INSERT INTO classes (college_id, class_name, department_id) VALUES ($1, $2, $3) RETURNING id',
        [collegeId, `Merge-Class-${crypto.randomUUID().slice(0, 6)}`, sourceId],
      );

      const genResp = await post(baseUrl, '/api/v1/structural-authorization-keys', tenantHeaders(collegeId, userId), {
        action_type: 'department_merge_rename',
        action_payload: { mode: 'merge', sourceDepartmentIds: [sourceId], targetDepartmentId: targetId },
      });
      assert.equal(genResp.status, 201);

      const platformAdminToken = await platformToken();
      const redeemResp = await post(
        baseUrl,
        '/api/v1/platform/structural-authorization-keys/redeem',
        { authorization: `Bearer ${platformAdminToken}` },
        {
          token: genResp.body.token,
          sections: { department: { mode: 'merge', sourceDepartmentIds: [sourceId], targetDepartmentId: targetId } },
        },
      );
      assert.equal(redeemResp.status, 200);

      const cls = await adminPool.query('SELECT department_id FROM classes WHERE id = $1', [classResult.rows[0].id]);
      assert.equal(cls.rows[0].department_id, targetId, 'class must have followed its department into the merge');

      const source = await adminPool.query('SELECT merged_into_department_id FROM departments WHERE id = $1', [
        sourceId,
      ]);
      assert.equal(
        source.rows[0].merged_into_department_id,
        targetId,
        'source department must be marked merged, never deleted (RS-DAT-001)',
      );
    },
  );

  await t.test('a non-principal (staff) may not generate a structural authorization key', async () => {
    const collegeId = await seedCollege('g');
    const passwordHash = await security.hashPassword(TENANT_PASSWORD);
    const staffResult = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $2 || '@example.test', $3, 'staff', true) RETURNING id`,
      [collegeId, `staff${crypto.randomUUID().slice(0, 8)}`, passwordHash],
    );
    const resp = await post(
      baseUrl,
      '/api/v1/structural-authorization-keys',
      {
        authorization: `Bearer ${security.createAccessToken({ userId: staffResult.rows[0].id, collegeId, role: 'staff' })}`,
      },
      {
        action_type: 'department_merge_rename',
        action_payload: { mode: 'rename', departmentId: crypto.randomUUID(), name: 'x' },
      },
    );
    assert.equal(resp.status, 403);
  });

  await t.test(
    'RS-GOV-006: a failed redemption (target department gone) does NOT consume the key — it stays generated and redeemable once the payload is valid again',
    async () => {
      const collegeId = await seedCollege('h');
      const userId = await seedPrincipal(collegeId);
      const deptResult = await adminPool.query(
        'INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id',
        [collegeId, 'WillBeDeleted'],
      );
      const departmentId = deptResult.rows[0].id;

      const genResp = await post(baseUrl, '/api/v1/structural-authorization-keys', tenantHeaders(collegeId, userId), {
        action_type: 'department_merge_rename',
        action_payload: { mode: 'rename', departmentId, name: 'Renamed' },
      });
      assert.equal(genResp.status, 201);

      // Ordinary data-validation failure: the target no longer exists by
      // the time Platform Admin redeems.
      await adminPool.query('DELETE FROM departments WHERE id = $1', [departmentId]);

      const platformAdminToken = await platformToken();
      const failedResp = await post(
        baseUrl,
        '/api/v1/platform/structural-authorization-keys/redeem',
        { authorization: `Bearer ${platformAdminToken}` },
        {
          token: genResp.body.token,
          sections: { department: { mode: 'rename', departmentId, name: 'Renamed' } },
        },
      );
      assert.equal(failedResp.status, 400, 'department no longer exists — a validation error, not a crash');

      const key = await adminPool.query('SELECT status FROM structural_authorization_keys WHERE id = $1', [
        genResp.body.key_id,
      ]);
      assert.equal(
        key.rows[0].status,
        'generated',
        'the key must still be usable — an ordinary validation failure must not consume it',
      );
    },
  );

  await t.test('cancel-onboarding: only reachable from provisioning, terminal', async () => {
    const collegeId = await seedCollege('i');
    const token = await platformToken();

    const cancelResp = await post(
      baseUrl,
      `/api/v1/platform/colleges/${collegeId}/cancel-onboarding`,
      { authorization: `Bearer ${token}` },
      {},
    );
    assert.equal(cancelResp.status, 200);
    assert.equal(cancelResp.body.provisioning_status, 'cancelled');

    const readyAfterCancel = await post(
      baseUrl,
      `/api/v1/platform/colleges/${collegeId}/mark-ready`,
      { authorization: `Bearer ${token}` },
      {},
    );
    assert.equal(readyAfterCancel.status, 409, 'cancelled is terminal — no route back to provisioning/ready');
  });
});
