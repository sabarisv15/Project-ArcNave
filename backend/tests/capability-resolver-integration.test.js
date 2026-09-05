'use strict';

// Phase 1 (Capability Resolver integration) capstone coverage: proves
// Authorization, Workflow Routing, Visibility/Data Scope, and Audit
// Identity all agree on the SAME resolved identity for the same
// seeded actor, in one place — each consumer already has its own unit
// coverage elsewhere (rbac via route tests, workflowChainService.test.js,
// visibility-service.test.js, identity-resolvers.test.js), but nothing
// else proves the four don't disagree with each other for one person.
// Real Postgres throughout — no mocks — since the whole point is the
// real cross-table resolution a mock would hide a regression behind,
// same reasoning analytics-service-actor-scope.test.js's own docstring
// gives for its style.
//
// Scenarios (Definition of Done's named cases): Principal, permanent
// HOD, Acting HOD (via the real staffService.appointHodInCharge path,
// not raw SQL — proving occupant-swap provisioning end to end), plain
// staff (no position), Level 2 with no configured policy (default
// fallback), and a user with no position at all.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const identityService = require('../src/services/identityService');
const workflowChainService = require('../src/services/workflowChainService');
const actorContextService = require('../src/services/actorContextService');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const staffService = require('../src/services/staffService');
const { runWithRequestContext } = require('../src/logging/context');
const { seedPrincipalPosition, seedHodPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'CapabilityResolverTestPass123!';

function requestJson(baseUrl, path, method, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = text;
        }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
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

async function insertUser(adminPool, collegeId, username, role) {
  const passwordHash = await security.hashPassword(PASSWORD);
  const result = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
    [collegeId, username, `${username}@example.test`, passwordHash, role],
  );
  return { userId: result.rows[0].id, passwordHash };
}

async function seedScenario(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const college = { collegeId: `capres${suffix}`, subdomain: `capres${suffix}` };
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)', [
    college.collegeId,
    college.subdomain,
  ]);

  const deptA = await adminPool.query('INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id', [
    college.collegeId,
    `Dept A ${suffix}`,
  ]);
  const deptB = await adminPool.query('INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id', [
    college.collegeId,
    `Dept B ${suffix}`,
  ]);
  const departmentAId = deptA.rows[0].id;
  const departmentBId = deptB.rows[0].id;

  const principal = await insertUser(adminPool, college.collegeId, 'principaluser', 'principal');
  await seedPrincipalPosition(adminPool, {
    collegeId: college.collegeId,
    userId: principal.userId,
    passwordHash: principal.passwordHash,
  });

  const permanentHod = await insertUser(adminPool, college.collegeId, 'permhoduser', 'hod');
  await seedHodPosition(adminPool, {
    collegeId: college.collegeId,
    userId: permanentHod.userId,
    departmentId: departmentAId,
    passwordHash: permanentHod.passwordHash,
  });

  // Acting HOD for department B, via the real service path (not raw
  // SQL) — the actual thing Phase 1 added, exercised end to end.
  const actingHod = await insertUser(adminPool, college.collegeId, 'actinghoduser', 'staff');
  await staffService.appointHodInCharge(
    adminPool,
    departmentBId,
    actingHod.userId,
    { reason: 'permanent HOD on leave' },
    { actorUserId: principal.userId, collegeId: college.collegeId },
  );

  const plainStaff = await insertUser(adminPool, college.collegeId, 'staffuser', 'staff');

  const level2 = await insertUser(adminPool, college.collegeId, 'level2user', 'staff');
  const level2Position = await adminPool.query(
    `INSERT INTO positions (college_id, level, title, created_by) VALUES ($1, 2, 'Dean', $2) RETURNING id`,
    [college.collegeId, principal.userId],
  );
  const level2Account = await adminPool.query(
    `INSERT INTO position_accounts (college_id, position_id, official_email, password_hash)
     VALUES ($1, $2, 'dean-position@capres-test.internal', $3) RETURNING id`,
    [college.collegeId, level2Position.rows[0].id, level2.passwordHash],
  );
  await adminPool.query(
    `INSERT INTO position_occupants (college_id, position_account_id, user_id, assigned_by)
     VALUES ($1, $2, $3, $3)`,
    [college.collegeId, level2Account.rows[0].id, level2.userId],
  );

  const noPosition = await insertUser(adminPool, college.collegeId, 'noposition', 'staff');

  return {
    ...college,
    departmentAId,
    departmentBId,
    principal,
    permanentHod,
    actingHod,
    plainStaff,
    level2,
    noPosition,
  };
}

async function cleanupScenario(adminPool, scenario) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [scenario.collegeId]);
  await cleanupPositionRows(adminPool, scenario.collegeId);
  await adminPool.query('DELETE FROM hod_in_charge_appointments WHERE college_id = $1', [scenario.collegeId]);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [scenario.collegeId]);
  await adminPool.query('DELETE FROM departments WHERE college_id = $1', [scenario.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [scenario.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [scenario.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [scenario.collegeId]);
}

test('Capability Resolver integration — Authorization, Workflow Routing, Visibility, Audit Identity agree', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const appPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const scenario = await seedScenario(adminPool);

  t.after(async () => {
    await stopServer(server);
    await cleanupScenario(adminPool, scenario);
    await adminPool.end();
    await appPool.end();
  });

  function bearerFor(userId, role) {
    return `Bearer ${security.createAccessToken({ userId, collegeId: scenario.collegeId, role })}`;
  }

  async function withTenantClient(fn) {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [scenario.collegeId]);
      return await fn(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  // --- Authorization: analytics.attendance_rate.read is ['principal', 'hod', 'staff'] ---
  // Widened 2026-07-26 (UAT discovery) — plain staff is now allowed too,
  // scoped to their own visible classes via getAttendanceRateForActor.

  await t.test('Authorization: principal, both HOD kinds, and plain staff (scoped) are all allowed', async () => {
    const principalResp = await requestJson(baseUrl, '/api/v1/analytics/attendance-rate', 'GET', {
      host: hostFor(scenario.subdomain),
      authorization: bearerFor(scenario.principal.userId, 'principal'),
    });
    assert.equal(principalResp.status, 200);

    const permanentHodResp = await requestJson(baseUrl, '/api/v1/analytics/attendance-rate', 'GET', {
      host: hostFor(scenario.subdomain),
      authorization: bearerFor(scenario.permanentHod.userId, 'hod'),
    });
    assert.equal(permanentHodResp.status, 200);

    // actingHod's JWT still carries the legacy 'staff' role claim
    // (there is no separate 'acting hod' role string) — proves
    // Authorization now derives from the resolved Position/Occupant,
    // not the stale claim, since a plain 'staff' claim would otherwise
    // 403 here.
    const actingHodResp = await requestJson(baseUrl, '/api/v1/analytics/attendance-rate', 'GET', {
      host: hostFor(scenario.subdomain),
      authorization: bearerFor(scenario.actingHod.userId, 'staff'),
    });
    assert.equal(actingHodResp.status, 200);

    const staffResp = await requestJson(baseUrl, '/api/v1/analytics/attendance-rate', 'GET', {
      host: hostFor(scenario.subdomain),
      authorization: bearerFor(scenario.plainStaff.userId, 'staff'),
    });
    assert.equal(staffResp.status, 200);
  });

  // --- Workflow Routing ---

  await t.test('Workflow Routing: resolves principal and both HOD kinds to the real occupant', async () => {
    await withTenantClient(async (client) => {
      // record_restoration's default chain is ['principal'] — isolates
      // the principal-resolution step with no departmentId needed.
      const principalChain = await workflowChainService.resolveApproverChain(client, {
        collegeId: scenario.collegeId,
        entityType: 'record_restoration',
      });
      assert.equal(principalChain[0].user_id, scenario.principal.userId);

      // timetable_approval's default chain is ['hod', 'principal'] —
      // step 1 isolates hod-resolution for whichever department is
      // passed.
      const permanentHodChain = await workflowChainService.resolveApproverChain(client, {
        collegeId: scenario.collegeId,
        entityType: 'timetable_approval',
        departmentId: scenario.departmentAId,
      });
      assert.equal(permanentHodChain[0].user_id, scenario.permanentHod.userId);

      const actingHodChain = await workflowChainService.resolveApproverChain(client, {
        collegeId: scenario.collegeId,
        entityType: 'timetable_approval',
        departmentId: scenario.departmentBId,
      });
      assert.equal(actingHodChain[0].user_id, scenario.actingHod.userId);
    });
  });

  // --- Visibility / Data Scope ---

  await t.test(
    'Visibility/Data Scope: college-wide for principal, own-department for both HOD kinds, self_assigned for staff',
    async () => {
      await withTenantClient(async (client) => {
        const principalCtx = await actorContextService.buildActorContext(client, {
          actorId: scenario.principal.userId,
          tenantId: scenario.collegeId,
        });
        assert.equal(principalCtx.scopeLevel, 'college');

        const permanentHodCtx = await actorContextService.buildActorContext(client, {
          actorId: scenario.permanentHod.userId,
          tenantId: scenario.collegeId,
        });
        assert.equal(permanentHodCtx.scopeLevel, 'department');
        assert.deepEqual(permanentHodCtx.departmentIds, [scenario.departmentAId]);

        const actingHodCtx = await actorContextService.buildActorContext(client, {
          actorId: scenario.actingHod.userId,
          tenantId: scenario.collegeId,
        });
        assert.equal(actingHodCtx.scopeLevel, 'department');
        assert.deepEqual(actingHodCtx.departmentIds, [scenario.departmentBId]);

        const staffCtx = await actorContextService.buildActorContext(client, {
          actorId: scenario.plainStaff.userId,
          tenantId: scenario.collegeId,
        });
        assert.equal(staffCtx.scopeLevel, 'self_assigned');
      });
    },
  );

  // --- Audit Identity ---

  await t.test(
    'Audit Identity: a principal-context action records position_account_id/position_id; a no-position action records neither',
    async () => {
      await withTenantClient(async (client) => {
        const capabilities = await identityService.resolveCapabilities(client, {
          userId: scenario.principal.userId,
          collegeId: scenario.collegeId,
        });
        await runWithRequestContext(
          { requestId: 'test-req-1', collegeId: scenario.collegeId, capabilities },
          async () => {
            await auditLogRepository.createAuditLogEntry(client, {
              collegeId: scenario.collegeId,
              userId: scenario.principal.userId,
              action: 'capability_resolver_integration_test',
              entity: 'test',
              entityId: 'principal-case',
              metadata: null,
            });
          },
        );

        const noPositionCapabilities = await identityService.resolveCapabilities(client, {
          userId: scenario.noPosition.userId,
          collegeId: scenario.collegeId,
        });
        await runWithRequestContext(
          { requestId: 'test-req-2', collegeId: scenario.collegeId, capabilities: noPositionCapabilities },
          async () => {
            await auditLogRepository.createAuditLogEntry(client, {
              collegeId: scenario.collegeId,
              userId: scenario.noPosition.userId,
              action: 'capability_resolver_integration_test',
              entity: 'test',
              entityId: 'no-position-case',
              metadata: null,
            });
          },
        );

        const rows = await client.query(
          `SELECT entity_id, position_account_id, position_id FROM audit_log
         WHERE college_id = $1 AND action = 'capability_resolver_integration_test'
         ORDER BY entity_id`,
          [scenario.collegeId],
        );
        const byEntityId = Object.fromEntries(rows.rows.map((r) => [r.entity_id, r]));

        assert.ok(byEntityId['principal-case'].position_account_id !== null);
        assert.ok(byEntityId['principal-case'].position_id !== null);
        assert.equal(byEntityId['no-position-case'].position_account_id, null);
        assert.equal(byEntityId['no-position-case'].position_id, null);
      });
    },
  );

  // --- Capability Resolution / Effective Role (Level 2 default, no-position case) ---

  await t.test(
    'Capability Resolution: Level 2 with no configured policy defaults to staff/self_assigned; a user with no position at all is the ordinary staff case, not an error',
    async () => {
      await withTenantClient(async (client) => {
        const level2Capabilities = await identityService.resolveCapabilities(client, {
          userId: scenario.level2.userId,
          collegeId: scenario.collegeId,
        });
        assert.equal(level2Capabilities.effectiveRole, 'staff');
        assert.equal(level2Capabilities.scopeLevel, 'self_assigned');

        const noPositionCapabilities = await identityService.resolveCapabilities(client, {
          userId: scenario.noPosition.userId,
          collegeId: scenario.collegeId,
        });
        assert.equal(noPositionCapabilities.effectiveRole, 'staff');
        assert.deepEqual(noPositionCapabilities.positions, []);
      });
    },
  );
});
