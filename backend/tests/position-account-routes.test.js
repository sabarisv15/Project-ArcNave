'use strict';

// End-to-end HTTP coverage for Phase 2 step 7 — the routes group (a)
// delivers: Position Account login/refresh/logout (tenant router),
// Level 1/2 invite (platform router, Platform-Admin-initiated) and
// Level 3/HOD invite (tenant router, Level 1 actor's personal login —
// RS-IDN-004: L2 is optional, no L3 action may require one),
// and the shared unauthenticated accept route. Same real-HTTP,
// real-Postgres, mock-only-the-email style as principal-invitation.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const notificationService = require('../src/services/notificationService');
const { seedHodPosition, seedClassTutorPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PLATFORM_PASSWORD = 'PlatformPass123!';
const ACCEPT_PASSWORD = 'AcceptedPass123!';

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
        resolve({ status: res.statusCode, body: parsedBody, headers: res.headers });
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

// ARCNAVE modernization P0 (PDF 5.1 / clash C6): position-account
// refresh tokens now travel as an httpOnly Set-Cookie
// (arcnave_position_refresh_token), not a JSON body field — see
// tests/auth.test.js's own copy of this same helper for the personal-
// login equivalent.
function refreshCookieFrom(resp) {
  const setCookie = resp.headers['set-cookie'];
  if (!setCookie) return null;
  const raw = Array.isArray(setCookie) ? setCookie : [setCookie];
  const match = raw.find((c) => c.startsWith('arcnave_position_refresh_token='));
  return match ? match.split(';')[0] : null;
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

test('Position Account routes (Phase 2 step 7)', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });

  const suffix = crypto.randomUUID().slice(0, 8);
  const adminUsername = `parplatadmin${suffix}`;
  const adminResult = await adminPool.query(
    `INSERT INTO platform_admins (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
    [adminUsername, `${adminUsername}@example.com`, await security.hashPassword(PLATFORM_PASSWORD)],
  );
  const adminId = adminResult.rows[0].id;

  const createdColleges = [];
  async function seedCollege(label) {
    const cid = `par${label}${crypto.randomUUID().slice(0, 8)}`;
    await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $1)', [cid]);
    createdColleges.push(cid);
    return cid;
  }

  t.after(async () => {
    await stopServer(server);
    for (const cid of createdColleges) {
      // eslint-disable-next-line no-await-in-loop -- test teardown, small fixed set
      await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await cleanupPositionRows(adminPool, cid);
      // eslint-disable-next-line no-await-in-loop -- Phase 4 Group (d)'s own faculty_allocation fixture FKs classes/timetable_periods, so both must run before the classes delete below
      await adminPool.query('DELETE FROM faculty_allocation WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM timetable_periods WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop -- Phase 3 Group (d)'s own class fixtures; classes.department_id FKs departments, so this must run before that delete
      await adminPool.query('DELETE FROM classes WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM departments WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [cid]);
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

  let lastInvitationToken = null;
  const emailMock = t.mock.method(
    notificationService,
    'sendPositionAccountInvitationEmail',
    async (client, { to, token }) => {
      lastInvitationToken = token;
      return { status: 'stubbed', to };
    },
  );
  t.after(() => emailMock.mock.restore());

  async function inviteLevel12(platformAdminToken, collegeId, level, email) {
    lastInvitationToken = null;
    const resp = await post(
      baseUrl,
      `/api/v1/platform/colleges/${collegeId}/position-accounts/invite`,
      { authorization: `Bearer ${platformAdminToken}` },
      { level, email },
    );
    return { ...resp, rawToken: lastInvitationToken };
  }

  function acceptPositionInvite(rawToken, password = ACCEPT_PASSWORD) {
    return post(baseUrl, '/api/v1/position-accounts/invitations/accept', {}, { token: rawToken, password });
  }

  // --- Level 2 invite (Platform Admin) -> accept -> login -> refresh -> logout ---

  await t.test(
    'Platform Admin invites Level 2, accept sets real credentials, login/refresh/logout all work',
    async () => {
      const collegeId = await seedCollege('l2');
      const platformAdminToken = await platformToken();

      const inviteResp = await inviteLevel12(platformAdminToken, collegeId, 2, 'dean@example.edu');
      assert.equal(inviteResp.status, 201);
      assert.equal(inviteResp.body.email, 'dean@example.edu');
      assert.equal('token' in inviteResp.body, false);
      assert.ok(inviteResp.rawToken);

      // Human-visible provenance: platform_audit_log records the real
      // admin as actor (never blank) — the same table/join
      // AuditLogsPage.jsx renders as `entry.actor_username`.
      const auditRow = await adminPool.query(
        `SELECT l.actor_admin_id, a.username AS actor_username, l.action, l.entity_id
       FROM platform_audit_log l JOIN platform_admins a ON a.id = l.actor_admin_id
       WHERE l.action = 'position_account.invited' AND l.entity_id = $1`,
        [inviteResp.body.position_id],
      );
      assert.equal(auditRow.rows.length, 1);
      assert.equal(auditRow.rows[0].actor_admin_id, adminId);
      assert.equal(auditRow.rows[0].actor_username, adminUsername);

      const acceptResp = await acceptPositionInvite(inviteResp.rawToken);
      assert.equal(acceptResp.status, 201);
      assert.equal(acceptResp.body.official_email, 'dean@example.edu');
      assert.equal(acceptResp.body.college_id, collegeId);

      const collegeRow = await adminPool.query('SELECT subdomain FROM colleges WHERE college_id = $1', [collegeId]);
      const subdomain = collegeRow.rows[0].subdomain;

      const loginResp = await post(
        baseUrl,
        '/api/v1/position-accounts/login',
        { host: hostFor(subdomain) },
        { official_email: 'dean@example.edu', password: ACCEPT_PASSWORD },
      );
      assert.equal(loginResp.status, 200);
      assert.ok(loginResp.body.access_token);
      assert.equal(loginResp.body.refresh_token, undefined, 'refresh token must never appear in the JSON body');
      const loginCookie = refreshCookieFrom(loginResp);
      assert.ok(loginCookie, 'refresh token must be set as an httpOnly cookie');

      const claims = security.decodeAccessToken(loginResp.body.access_token);
      assert.equal(claims.type, 'position_access');
      assert.equal(claims.sub, acceptResp.body.position_account_id);

      const refreshResp = await post(baseUrl, '/api/v1/position-accounts/refresh', {
        host: hostFor(subdomain),
        cookie: loginCookie,
      });
      assert.equal(refreshResp.status, 200);
      assert.ok(refreshResp.body.access_token);
      const refreshCookie = refreshCookieFrom(refreshResp);

      const logoutResp = await post(baseUrl, '/api/v1/position-accounts/logout', {
        host: hostFor(subdomain),
        cookie: refreshCookie,
      });
      assert.equal(logoutResp.status, 204);

      // The just-logged-out refresh token is now dead — a repeat refresh
      // with it fails, proving logout actually revoked it.
      const reuseResp = await post(baseUrl, '/api/v1/position-accounts/refresh', {
        host: hostFor(subdomain),
        cookie: refreshCookie,
      });
      assert.equal(reuseResp.status, 401);
    },
  );

  await t.test('a wrong password at login is rejected generically', async () => {
    const collegeId = await seedCollege('l2b');
    const platformAdminToken = await platformToken();
    const inviteResp = await inviteLevel12(platformAdminToken, collegeId, 2, 'dean2@example.edu');
    await acceptPositionInvite(inviteResp.rawToken);

    const collegeRow = await adminPool.query('SELECT subdomain FROM colleges WHERE college_id = $1', [collegeId]);
    const loginResp = await post(
      baseUrl,
      '/api/v1/position-accounts/login',
      { host: hostFor(collegeRow.rows[0].subdomain) },
      { official_email: 'dean2@example.edu', password: 'wrong-password' },
    );
    assert.equal(loginResp.status, 401);
  });

  // --- Level 1/2 invite is Platform-Admin-only ---

  await t.test('the platform invite route requires a valid Platform Admin token', async () => {
    const collegeId = await seedCollege('l2c');
    const resp = await post(
      baseUrl,
      `/api/v1/platform/colleges/${collegeId}/position-accounts/invite`,
      {},
      { level: 2, email: 'nobody@example.edu' },
    );
    assert.equal(resp.status, 401);
  });

  await t.test(
    'inviting Level 3 through the platform route is forbidden — that is a tenant-actor-only level',
    async () => {
      const collegeId = await seedCollege('l2d');
      const platformAdminToken = await platformToken();
      const resp = await post(
        baseUrl,
        `/api/v1/platform/colleges/${collegeId}/position-accounts/invite`,
        { authorization: `Bearer ${platformAdminToken}` },
        { level: 3, email: 'hod@example.edu' },
      );
      assert.equal(resp.status, 403);
    },
  );

  await t.test(
    'inviting to an already-provisioned Level 2 seat a second time is a 409, not a silent overwrite',
    async () => {
      const collegeId = await seedCollege('l2e');
      const platformAdminToken = await platformToken();
      await inviteLevel12(platformAdminToken, collegeId, 2, 'first-dean@example.edu');

      const secondResp = await inviteLevel12(platformAdminToken, collegeId, 2, 'second-dean@example.edu');
      assert.equal(secondResp.status, 409);
    },
  );

  // --- Level 3 (HOD) invite — RS-IDN-004: a Level 1 tenant actor's
  // PERSONAL login, not Level 2 — L2 is optional and no L3 action may
  // require one to exist (D2/ADL-006).

  async function seedLevel1Occupant(collegeId) {
    const passwordHash = await security.hashPassword(ACCEPT_PASSWORD);
    const userResult = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $2 || '@example.test', $3, 'principal', true) RETURNING id`,
      [collegeId, `level1occ${crypto.randomUUID().slice(0, 8)}`, passwordHash],
    );
    const userId = userResult.rows[0].id;
    const position = await adminPool.query(
      `INSERT INTO positions (college_id, level, title, created_by) VALUES ($1, 1, 'Principal', $2) RETURNING id`,
      [collegeId, userId],
    );
    const account = await adminPool.query(
      `INSERT INTO position_accounts (college_id, position_id, official_email, password_hash)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [collegeId, position.rows[0].id, `principal-${position.rows[0].id}@positions.test`, passwordHash],
    );
    await adminPool.query(
      `INSERT INTO position_occupants (college_id, position_account_id, user_id, assigned_by) VALUES ($1, $2, $3, $3)`,
      [collegeId, account.rows[0].id, userId],
    );
    return userId;
  }

  async function personalToken(collegeId, userId) {
    return security.createAccessToken({ userId, collegeId, role: 'staff' });
  }

  await t.test('a Level 1 actor invites Level 3 (HOD), accept -> login works end to end', async () => {
    const collegeId = await seedCollege('l3a');
    const deptResult = await adminPool.query(
      'INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id',
      [collegeId, 'CSE'],
    );
    const departmentId = deptResult.rows[0].id;
    const level1UserId = await seedLevel1Occupant(collegeId);
    const collegeRow = await adminPool.query('SELECT subdomain FROM colleges WHERE college_id = $1', [collegeId]);
    const subdomain = collegeRow.rows[0].subdomain;

    lastInvitationToken = null;
    const inviteResp = await post(
      baseUrl,
      `/api/v1/departments/${departmentId}/position-accounts/invite`,
      { authorization: `Bearer ${await personalToken(collegeId, level1UserId)}`, host: hostFor(subdomain) },
      { email: 'hod-cse@example.edu' },
    );
    assert.equal(inviteResp.status, 201);
    const rawToken = lastInvitationToken;
    assert.ok(rawToken);

    const acceptResp = await acceptPositionInvite(rawToken);
    assert.equal(acceptResp.status, 201);
    assert.equal(acceptResp.body.official_email, 'hod-cse@example.edu');

    const loginResp = await post(
      baseUrl,
      '/api/v1/position-accounts/login',
      { host: hostFor(subdomain) },
      { official_email: 'hod-cse@example.edu', password: ACCEPT_PASSWORD },
    );
    assert.equal(loginResp.status, 200);
    const claims = security.decodeAccessToken(loginResp.body.access_token);
    assert.equal(claims.type, 'position_access');
  });

  // Phase 3 (AI Identity Context Integration), Group (a) step 2 — the
  // first real exercise of a 'position_access' token against
  // /api/v1/ai/*. Before this phase, routes/ai.js read req.jwtClaims.role
  // directly, which doesn't exist on a Position Account token at all
  // (claims.sub IS the position_account_id — ADR-023) — every AI call
  // from an Institutional session would have 403'd via
  // allowedRoles.includes(undefined). Uses an HOD (Level 3) Position
  // Account specifically because 'hod' is already in get_college_profile's
  // allowedRoles today — proving Group (a) alone (the identityContext
  // wiring) without depending on Group (b) (the level2/class_tutor
  // label gap), which hasn't shipped yet.
  await t.test(
    'a Position Account (Institutional Identity Context) session can successfully call an AI tool',
    async () => {
      const collegeId = await seedCollege('l3ai');
      const deptResult = await adminPool.query(
        'INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id',
        [collegeId, 'AI-CSE'],
      );
      const departmentId = deptResult.rows[0].id;
      const level1UserId = await seedLevel1Occupant(collegeId);
      const collegeRow = await adminPool.query('SELECT subdomain FROM colleges WHERE college_id = $1', [collegeId]);
      const subdomain = collegeRow.rows[0].subdomain;

      lastInvitationToken = null;
      const inviteResp = await post(
        baseUrl,
        `/api/v1/departments/${departmentId}/position-accounts/invite`,
        { authorization: `Bearer ${await personalToken(collegeId, level1UserId)}`, host: hostFor(subdomain) },
        { email: 'hod-ai@example.edu' },
      );
      assert.equal(inviteResp.status, 201);
      const acceptResp = await acceptPositionInvite(lastInvitationToken);
      assert.equal(acceptResp.status, 201);

      const loginResp = await post(
        baseUrl,
        '/api/v1/position-accounts/login',
        { host: hostFor(subdomain) },
        { official_email: 'hod-ai@example.edu', password: ACCEPT_PASSWORD },
      );
      assert.equal(loginResp.status, 200);
      const claims = security.decodeAccessToken(loginResp.body.access_token);
      assert.equal(claims.type, 'position_access');

      const toolsResp = await post(
        baseUrl,
        '/api/v1/ai/tools/get_college_profile/invoke',
        { authorization: `Bearer ${loginResp.body.access_token}`, host: hostFor(subdomain) },
        { params: {} },
      );
      assert.equal(
        toolsResp.status,
        200,
        'an Institutional Identity Context session with effectiveRole "hod" must be able to call a tool hod is allowed to call',
      );
      const profile = JSON.parse(toolsResp.body.entries[0].data);
      assert.equal(profile.college_id, collegeId);

      // The negative side of the same proof: get_college_profile is not
      // in finance_status_summary's allowedRoles (principal-only) — a
      // Position Account session must be denied exactly the same way a
      // Personal session with effectiveRole 'hod' already is, not bypass
      // the Policy Gate just because it's a different kind of token.
      const deniedResp = await post(
        baseUrl,
        '/api/v1/ai/tools/finance_status_summary/invoke',
        { authorization: `Bearer ${loginResp.body.access_token}`, host: hostFor(subdomain) },
        { params: {} },
      );
      assert.equal(deniedResp.status, 403);
    },
  );

  // Phase 3 Group (d) — final verification. Both tests below use the
  // direct /ai/tools/:name/invoke endpoint (no LLM call, no mocking
  // needed) — the Policy Gate outcome (200/403) is the observable proof
  // of which effectiveRole/tool-set each auth path actually resolved,
  // exercised over a real HTTP+DB round trip, not a unit-level stub.
  await t.test(
    "Phase 3 Group (d): different offices — an HOD's Personal login and a separate person's Class Tutor Position Account get correctly different, non-leaking tool access",
    async () => {
      const collegeId = await seedCollege('d1off');
      const deptResult = await adminPool.query(
        'INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id',
        [collegeId, 'D1-CSE'],
      );
      const departmentId = deptResult.rows[0].id;
      const classResult = await adminPool.query(
        'INSERT INTO classes (college_id, class_name) VALUES ($1, $2) RETURNING id',
        [collegeId, 'D1-3rd-Sem-CSE-A'],
      );
      const classId = classResult.rows[0].id;

      const hodUserResult = await adminPool.query(
        `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $2 || '@example.test', 'x', 'staff', true) RETURNING id`,
        [collegeId, `d1hod${crypto.randomUUID().slice(0, 8)}`],
      );
      await seedHodPosition(adminPool, { collegeId, userId: hodUserResult.rows[0].id, departmentId });
      const hodToken = await personalToken(collegeId, hodUserResult.rows[0].id);

      const tutorUserResult = await adminPool.query(
        `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $2 || '@example.test', 'x', 'staff', true) RETURNING id`,
        [collegeId, `d1tutor${crypto.randomUUID().slice(0, 8)}`],
      );
      const { accountId: tutorAccountId } = await seedClassTutorPosition(adminPool, {
        collegeId,
        userId: tutorUserResult.rows[0].id,
        classId,
      });
      const tutorToken = security.createPositionAccessToken({ positionAccountId: tutorAccountId, collegeId });

      const collegeRow = await adminPool.query('SELECT subdomain FROM colleges WHERE college_id = $1', [collegeId]);
      const subdomain = collegeRow.rows[0].subdomain;

      // staff_roster: granted to hod, deliberately NOT to class_tutor
      // (Group (b)'s own audit) — the sharpest boundary available, the
      // same tool, one office admitted and the other correctly denied.
      const hodStaffRoster = await post(
        baseUrl,
        '/api/v1/ai/tools/staff_roster/invoke',
        { authorization: `Bearer ${hodToken}`, host: hostFor(subdomain) },
        { params: {} },
      );
      assert.equal(hodStaffRoster.status, 200);
      const tutorStaffRoster = await post(
        baseUrl,
        '/api/v1/ai/tools/staff_roster/invoke',
        { authorization: `Bearer ${tutorToken}`, host: hostFor(subdomain) },
        { params: {} },
      );
      assert.equal(tutorStaffRoster.status, 403, "a Class Tutor session must not leak into an hod-only tool's scope");

      // mark_attendance_nl: granted to BOTH (Group (b) added class_tutor
      // here specifically) — proves that grant actually works end to end
      // over a real HTTP+DB round trip, not just the Policy Gate's own
      // unit-level audit. Asserting notEqual(403), not 200: whether the
      // handler itself succeeds depends on unrelated fixture data (an
      // active timetable session) this test doesn't seed — only the
      // Policy Gate's admission decision is this test's own concern.
      const hodAttendance = await post(
        baseUrl,
        '/api/v1/ai/tools/mark_attendance_nl/invoke',
        { authorization: `Bearer ${hodToken}`, host: hostFor(subdomain) },
        { params: { absent_roll_numbers: [] } },
      );
      assert.notEqual(hodAttendance.status, 403);
      const tutorAttendance = await post(
        baseUrl,
        '/api/v1/ai/tools/mark_attendance_nl/invoke',
        { authorization: `Bearer ${tutorToken}`, host: hostFor(subdomain) },
        { params: { absent_roll_numbers: [] } },
      );
      assert.notEqual(tutorAttendance.status, 403);
    },
  );

  await t.test(
    "Phase 3 Group (d): same office, two auth paths — the same person's Personal login and that same person's own HOD Position Account get identical tool access",
    async () => {
      // Real finding from this pass (recorded in the plan doc): for a
      // person holding exactly one position, this codebase's Personal
      // resolver (identityService.resolveCapabilities — a priority pick
      // across whatever positions the person occupies, not an additive
      // union) and the Institutional resolver for that same position's
      // own Position Account resolve the identical effectiveRole/scope —
      // by design, since AI is meant to be a consumer of whichever
      // context it's handed, never branching on which one produced it.
      // "Provably different" for the SAME office is therefore not a
      // behavioral claim (tool access is correctly identical here) but a
      // structural one about identityContext's own construction —
      // positionAccountId is null for Personal and the real id for
      // Institutional — proven at the unit level in
      // ai-service.test.js's aiActorContext.describeIdentityContext
      // "same office, two auth paths" test (that function deliberately
      // never reads positionAccountId, so the rendered prompt block is
      // identical too). This test is the behavioral-parity half of that
      // same proof, exercised over a real HTTP+DB round trip: neither
      // auth path is treated as a lesser or different kind of session for
      // the same real office.
      const collegeId = await seedCollege('d2same');
      const deptResult = await adminPool.query(
        'INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id',
        [collegeId, 'D2-ECE'],
      );
      const departmentId = deptResult.rows[0].id;
      const userResult = await adminPool.query(
        `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $2 || '@example.test', 'x', 'staff', true) RETURNING id`,
        [collegeId, `d2person${crypto.randomUUID().slice(0, 8)}`],
      );
      const userId = userResult.rows[0].id;
      const { accountId } = await seedHodPosition(adminPool, { collegeId, userId, departmentId });
      const personalTok = await personalToken(collegeId, userId);
      const institutionalTok = security.createPositionAccessToken({ positionAccountId: accountId, collegeId });

      const collegeRow = await adminPool.query('SELECT subdomain FROM colleges WHERE college_id = $1', [collegeId]);
      const subdomain = collegeRow.rows[0].subdomain;

      const personalGranted = await post(
        baseUrl,
        '/api/v1/ai/tools/staff_roster/invoke',
        { authorization: `Bearer ${personalTok}`, host: hostFor(subdomain) },
        { params: {} },
      );
      const institutionalGranted = await post(
        baseUrl,
        '/api/v1/ai/tools/staff_roster/invoke',
        { authorization: `Bearer ${institutionalTok}`, host: hostFor(subdomain) },
        { params: {} },
      );
      assert.equal(personalGranted.status, 200);
      assert.equal(institutionalGranted.status, 200);

      const personalDenied = await post(
        baseUrl,
        '/api/v1/ai/tools/finance_status_summary/invoke',
        { authorization: `Bearer ${personalTok}`, host: hostFor(subdomain) },
        { params: {} },
      );
      const institutionalDenied = await post(
        baseUrl,
        '/api/v1/ai/tools/finance_status_summary/invoke',
        { authorization: `Bearer ${institutionalTok}`, host: hostFor(subdomain) },
        { params: {} },
      );
      assert.equal(personalDenied.status, 403);
      assert.equal(institutionalDenied.status, 403);
    },
  );

  // Phase 4 Group (d) — final HTTP-level verification for AI Downstream
  // Scope Fidelity (Phase4-AI-Downstream-Scope-Fidelity.md).
  //
  // 4-login authorization architecture (2026-08-09) SUPERSEDES this
  // test's original claim: Personal login's SELF_ASSIGNED scope no
  // longer unions in the tutored class (identityService.resolveCapabilities
  // — visibilityResolver.js's own file comment) — Position Occupancy
  // must never widen a personal login's scope, only the L4 Position
  // Account login itself carries tutor scope. The fixture below (one
  // person BOTH a Class Tutor Position Account holder for one class AND
  // independently faculty-allocated to a second, unrelated class) now
  // proves the opposite, corrected claim: the two logins see suitably
  // DIFFERENT and INDIVIDUALLY CORRECT data — Institutional sees only
  // the one class it maps to; Personal sees only the independent
  // faculty allocation, never the tutored class.
  await t.test(
    "Phase 4 Group (d), corrected for the 4-login authorization architecture: a Class Tutor Position Account sees only its own class; the same occupant's Personal login sees only its independent faculty allocation, never the tutored class",
    async () => {
      const collegeId = await seedCollege('p4fid');
      const tutorClassResult = await adminPool.query(
        'INSERT INTO classes (college_id, class_name) VALUES ($1, $2) RETURNING id',
        [collegeId, 'P4-Tutor-Class'],
      );
      const tutorClassId = tutorClassResult.rows[0].id;
      const facultyClassResult = await adminPool.query(
        'INSERT INTO classes (college_id, class_name) VALUES ($1, $2) RETURNING id',
        [collegeId, 'P4-Faculty-Class'],
      );
      const facultyClassId = facultyClassResult.rows[0].id;

      const occupantResult = await adminPool.query(
        `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $2 || '@example.test', 'x', 'staff', true) RETURNING id`,
        [collegeId, `p4occupant${crypto.randomUUID().slice(0, 8)}`],
      );
      const occupantUserId = occupantResult.rows[0].id;

      const { accountId: tutorAccountId } = await seedClassTutorPosition(adminPool, {
        collegeId,
        userId: occupantUserId,
        classId: tutorClassId,
      });

      // Independent of the tutorship above — a real, structured
      // faculty_allocation row, the same "subject teacher, not tutor"
      // link facultyAllocationRepository.findByStaffUserId reads
      // elsewhere in this suite (see attendance.test.js's own fixture).
      const periodResult = await adminPool.query(
        `INSERT INTO timetable_periods (college_id, day_of_week, hour_index, start_time, end_time)
       VALUES ($1, 'Monday', 1, '09:00', '10:00') RETURNING id`,
        [collegeId],
      );
      await adminPool.query(
        `INSERT INTO faculty_allocation (college_id, class_id, period_id, subject, staff_user_id)
       VALUES ($1, $2, $3, 'Mathematics', $4)`,
        [collegeId, facultyClassId, periodResult.rows[0].id, occupantUserId],
      );

      const personalTok = await personalToken(collegeId, occupantUserId);
      const institutionalTok = security.createPositionAccessToken({ positionAccountId: tutorAccountId, collegeId });

      const collegeRow = await adminPool.query('SELECT subdomain FROM colleges WHERE college_id = $1', [collegeId]);
      const subdomain = collegeRow.rows[0].subdomain;

      const institutionalResp = await post(
        baseUrl,
        '/api/v1/ai/tools/academic_class_timetable/invoke',
        { authorization: `Bearer ${institutionalTok}`, host: hostFor(subdomain) },
        { params: {} },
      );
      assert.equal(institutionalResp.status, 200);
      const institutionalData = JSON.parse(institutionalResp.body.entries[0].data);
      assert.deepEqual(
        institutionalData.map((row) => row.classId),
        [tutorClassId],
        "the Class Tutor Position Account's own Institutional scope must be exactly its one mapped class, never re-derived to the occupant's broader Personal scope",
      );

      const personalResp = await post(
        baseUrl,
        '/api/v1/ai/tools/academic_class_timetable/invoke',
        { authorization: `Bearer ${personalTok}`, host: hostFor(subdomain) },
        { params: {} },
      );
      assert.equal(personalResp.status, 200);
      const personalData = JSON.parse(personalResp.body.entries[0].data);
      assert.deepEqual(
        personalData.map((row) => row.classId),
        [facultyClassId],
        "the SAME occupant's Personal login sees only the independent faculty allocation — Position Occupancy of the L4 seat must never widen this login's scope to include the tutored class too",
      );
    },
  );

  await t.test('a plain staff actor (no Level 1 position) cannot invite Level 3', async () => {
    const collegeId = await seedCollege('l3b');
    const deptResult = await adminPool.query(
      'INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id',
      [collegeId, 'ECE'],
    );
    const departmentId = deptResult.rows[0].id;
    const passwordHash = await security.hashPassword(ACCEPT_PASSWORD);
    const userResult = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $2 || '@example.test', $3, 'staff', true) RETURNING id`,
      [collegeId, `plainstaff${crypto.randomUUID().slice(0, 8)}`, passwordHash],
    );
    const collegeRow = await adminPool.query('SELECT subdomain FROM colleges WHERE college_id = $1', [collegeId]);

    const resp = await post(
      baseUrl,
      `/api/v1/departments/${departmentId}/position-accounts/invite`,
      {
        authorization: `Bearer ${await personalToken(collegeId, userResult.rows[0].id)}`,
        host: hostFor(collegeRow.rows[0].subdomain),
      },
      { email: 'hod-ece@example.edu' },
    );
    assert.equal(resp.status, 403);
  });

  await t.test(
    'a Level 3 invite missing an existing department (via bad UUID as departmentId) resolves cleanly, not a crash',
    async () => {
      const collegeId = await seedCollege('l3c');
      const level1UserId = await seedLevel1Occupant(collegeId);
      const collegeRow = await adminPool.query('SELECT subdomain FROM colleges WHERE college_id = $1', [collegeId]);

      const resp = await post(
        baseUrl,
        `/api/v1/departments/${crypto.randomUUID()}/position-accounts/invite`,
        {
          authorization: `Bearer ${await personalToken(collegeId, level1UserId)}`,
          host: hostFor(collegeRow.rows[0].subdomain),
        },
        { email: 'ghost-hod@example.edu' },
      );
      // No department row with that id exists — position_department_assignments'
      // own department_id FK rejects the INSERT (23503), surfaced as a 500
      // today (no bespoke error mapping for this edge case yet); the point
      // of this test is that the route doesn't silently create a
      // dangling position, not that the status code is polished.
      assert.notEqual(resp.status, 201);
    },
  );

  // --- Accept edge cases ---

  await t.test(
    'an unknown/expired/already-accepted accept token is rejected with the same generic message',
    async () => {
      const unknownResp = await acceptPositionInvite('not-a-real-token');
      assert.equal(unknownResp.status, 401);
      assert.equal(unknownResp.body.detail, 'Invalid or expired invitation');

      const collegeId = await seedCollege('acc1');
      const platformAdminToken = await platformToken();
      const inviteResp = await inviteLevel12(platformAdminToken, collegeId, 2, 'reuse@example.edu');
      const first = await acceptPositionInvite(inviteResp.rawToken);
      assert.equal(first.status, 201);

      const second = await acceptPositionInvite(inviteResp.rawToken);
      assert.equal(second.status, 401);
      assert.equal(second.body.detail, 'Invalid or expired invitation');
    },
  );

  await t.test('a weak password at accept is rejected with 400, invitation stays pending', async () => {
    const collegeId = await seedCollege('acc2');
    const platformAdminToken = await platformToken();
    const inviteResp = await inviteLevel12(platformAdminToken, collegeId, 2, 'weakpass@example.edu');

    const weakResp = await acceptPositionInvite(inviteResp.rawToken, 'weak');
    assert.equal(weakResp.status, 400);

    // Still pending — a real accept with a strong password after the
    // rejected attempt still works.
    const realResp = await acceptPositionInvite(inviteResp.rawToken);
    assert.equal(realResp.status, 201);
  });
});
