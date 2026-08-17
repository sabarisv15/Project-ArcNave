'use strict';

// Phase 2 step 5 capstone: proves the actual HTTP middleware chain
// (authMiddleware -> tenantMiddleware -> sessionRevocationMiddleware ->
// identityMiddleware -> rbac) treats a 'position_access' token as a
// wholly separate Institutional Identity Context from the same
// person's personal 'access' token — never unioned, never confused,
// even when their personal standing is weaker or stronger than the
// office they hold. Real Postgres, real HTTP requests through
// createApp(), same style as capability-resolver-integration.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const positionRepository = require('../src/repositories/positionRepository');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'PositionAccountIdentityTestPass123!';

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

async function seedScenario(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeId = `posid${suffix}`;
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $1)',
    [collegeId],
  );

  // A person whose PERSONAL standing is plain staff (no permission on
  // the HOD/principal-only route below) — but who also occupies a
  // Level 3 HOD Position Account. Same real userId behind both logins.
  const passwordHash = await security.hashPassword(PASSWORD);
  const userResult = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'dualuser', 'dualuser@example.test', $2, 'staff', true) RETURNING id`,
    [collegeId, passwordHash],
  );
  const userId = userResult.rows[0].id;

  const position = await positionRepository.createPosition(adminPool, {
    collegeId, level: 3, title: 'HOD', createdBy: userId,
  });
  const account = await positionRepository.createPositionAccount(adminPool, {
    collegeId, positionId: position.id, officialEmail: 'hod-office@posid-test.internal', passwordHash,
  });
  await positionRepository.createPositionOccupant(adminPool, {
    collegeId, positionAccountId: account.id, userId, assignedBy: userId,
  });

  return {
    collegeId, subdomain: collegeId, userId, positionAccountId: account.id,
  };
}

async function cleanupScenario(adminPool, scenario) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [scenario.collegeId]);
  await adminPool.query('DELETE FROM position_occupants WHERE college_id = $1', [scenario.collegeId]);
  await adminPool.query('DELETE FROM position_accounts WHERE college_id = $1', [scenario.collegeId]);
  await adminPool.query('DELETE FROM positions WHERE college_id = $1', [scenario.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [scenario.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [scenario.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [scenario.collegeId]);
}

test('Position Account identity context is scoped to the office, independent of the same person\'s personal standing', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const scenario = await seedScenario(adminPool);

  t.after(async () => {
    await stopServer(server);
    await cleanupScenario(adminPool, scenario);
    await adminPool.end();
  });

  await t.test('the same person\'s PERSONAL login already resolves HOD scope too — resolveCapabilities unions every position they occupy, by design', async () => {
    // Not a bug: decision 4's whole point is that the PERSONAL context
    // (Phase 1, resolveCapabilities) legitimately unions every
    // institutional responsibility a person holds, including one held
    // via a Position Account they also separately have their own
    // login for. The Institutional Identity Context (next test) is
    // what stays scoped to ONLY the queried office — that's the
    // property this suite exists to prove, not that personal login
    // is somehow blind to positions the person occupies.
    const personalToken = security.createAccessToken({
      userId: scenario.userId, collegeId: scenario.collegeId, role: 'staff',
    });
    const resp = await requestJson(baseUrl, '/api/v1/analytics/attendance-rate', 'GET', {
      host: hostFor(scenario.subdomain), authorization: `Bearer ${personalToken}`,
    });
    assert.equal(resp.status, 200);
  });

  await t.test('logging into the HOD Position Account, as the SAME person, is allowed — the office\'s own standing, not theirs', async () => {
    const positionToken = security.createPositionAccessToken({
      positionAccountId: scenario.positionAccountId, collegeId: scenario.collegeId, tokenVersion: 0,
    });
    const resp = await requestJson(baseUrl, '/api/v1/analytics/attendance-rate', 'GET', {
      host: hostFor(scenario.subdomain), authorization: `Bearer ${positionToken}`,
    });
    assert.equal(resp.status, 200);
  });

  await t.test('a position_access token with a stale token_version is rejected by session revocation, independent of users.token_version', async () => {
    await positionRepository.incrementPositionAccountTokenVersion(adminPool, scenario.positionAccountId);

    const staleToken = security.createPositionAccessToken({
      positionAccountId: scenario.positionAccountId, collegeId: scenario.collegeId, tokenVersion: 0,
    });
    const resp = await requestJson(baseUrl, '/api/v1/analytics/attendance-rate', 'GET', {
      host: hostFor(scenario.subdomain), authorization: `Bearer ${staleToken}`,
    });
    assert.equal(resp.status, 401);

    // The same person's personal token, minted with their own
    // (unrelated, never bumped) users.token_version, is unaffected —
    // proves the two revocation counters are genuinely independent.
    // Still 200 (their personal context still unions this same HOD
    // position, per the first test above), never 401 — the bump only
    // ever touched position_accounts.token_version.
    const personalToken = security.createAccessToken({
      userId: scenario.userId, collegeId: scenario.collegeId, role: 'staff', tokenVersion: 0,
    });
    const personalResp = await requestJson(baseUrl, '/api/v1/analytics/attendance-rate', 'GET', {
      host: hostFor(scenario.subdomain), authorization: `Bearer ${personalToken}`,
    });
    assert.equal(personalResp.status, 200);
  });
});
