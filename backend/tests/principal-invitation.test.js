'use strict';

// Integration tests for principal invitation — Option B (invite-
// record-now, create-user-later), ported from the deleted Python
// test_principal_invitation.py (git history).
//
// Five things this suite has to prove, not assume:
// 1. Only a platform admin can create an invitation.
// 2. Accepting a valid invitation creates a *correctly tenant-scoped*
//    user — verified via RLS itself, same discipline as
//    test_rls_tenant_isolation.py, not just trusted from the response
//    body looking right.
// 3. Expired and already-accepted tokens are rejected with the same
//    generic message; reuse of an already-accepted token is logged.
// 4. A duplicate username within a tenant is rejected with 409.
// 5. One college's invitation can never result in a user appearing
//    under a different college_id — exercised with two colleges
//    sharing the same requested username, which would collide if
//    invitation A's college_id ever leaked into invitation B's accept
//    flow.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const notificationService = require('../src/services/notificationService');

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
    const server = app.listen(0, () => resolve(server));
  });
}

function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function userVisibleUnderTenant(collegeIdForContext, username) {
  const engine = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const client = await engine.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeIdForContext]);
      const result = await client.query('SELECT college_id FROM users WHERE username = $1', [username]);
      await client.query('COMMIT');
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  } finally {
    await engine.end();
  }
}

test('principal invitation', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });

  const suffix = crypto.randomUUID().slice(0, 8);
  const adminUsername = `invplatadmin${suffix}`;
  const adminResult = await adminPool.query(
    `INSERT INTO platform_admins (username, email, password_hash)
     VALUES ($1, $2, $3) RETURNING id`,
    [adminUsername, `${adminUsername}@example.com`, await security.hashPassword(PLATFORM_PASSWORD)],
  );
  const adminId = adminResult.rows[0].id;

  const createdColleges = [];
  async function seedCollege(label) {
    const cid = `inv${label}${crypto.randomUUID().slice(0, 8)}`;
    await adminPool.query(
      'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $1)',
      [cid],
    );
    createdColleges.push(cid);
    return cid;
  }

  const collegeA = await seedCollege('a');
  const collegeB = await seedCollege('b');

  t.after(async () => {
    await stopServer(server);
    for (const cid of createdColleges) {
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM principal_invitations WHERE college_id = $1', [cid]);
      // Every accept now also seeds the 7 default document_categories
      // (document_categories.college_id FKs colleges) — must go before
      // the colleges delete below.
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM document_categories WHERE college_id = $1', [cid]);
      // Every accept now also provisions a Level 1 position/account/
      // occupant (ADR-021, unconditional) — position_occupants /
      // position_accounts / positions all FK to users(id)
      // (created_by/assigned_by), so they must go before the users
      // delete below, same reasoning as audit_log.user_id.
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM position_occupants WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM position_accounts WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM positions WHERE college_id = $1', [cid]);
      // audit_log.user_id FKs users(id) — must go before the users
      // delete below (task #17's login audit logging).
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM users WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [cid]);
    }
    // platform_audit_log.actor_admin_id FKs platform_admins(id) — same
    // "clean up the dependent audit row before the actor" discipline
    // as audit_log/users above, just for the platform-side table
    // (Platform Admin module build, Phase C).
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

  // This session's own task: an invitation token is delivered only via
  // email (sendPrincipalInvitationEmail), never in the API response —
  // mocked for the whole suite so every call below can still recover
  // the raw token it needs to drive /invitations/accept, the same way
  // a real recipient would read it out of their inbox.
  let lastInvitationToken = null;
  const emailMock = t.mock.method(notificationService, 'sendPrincipalInvitationEmail', async (client, { to, token }) => {
    lastInvitationToken = token;
    return { status: 'stubbed', to };
  });
  t.after(() => emailMock.mock.restore());

  async function invite(token, collegeId, email) {
    lastInvitationToken = null;
    const resp = await post(
      baseUrl,
      `/api/v1/platform/colleges/${collegeId}/invite-principal`,
      { authorization: `Bearer ${token}` },
      { email },
    );
    return { ...resp, rawToken: lastInvitationToken };
  }

  function accept(rawToken, username, password = ACCEPT_PASSWORD) {
    return post(baseUrl, '/api/v1/invitations/accept', {}, { token: rawToken, username, password });
  }

  // --- Invitation creation (platform side) ---

  await t.test('invite-principal requires a platform admin token', async () => {
    const resp = await invite('not-a-real-token', collegeA, 'principal@example.com');
    assert.equal(resp.status, 401);
  });

  await t.test('invite-principal succeeds, emails the token, and never returns it', async () => {
    const token = await platformToken();
    const resp = await invite(token, collegeA, 'principal@example.com');
    assert.equal(resp.status, 200);
    assert.equal(resp.body.college_id, collegeA);
    assert.equal(resp.body.email, 'principal@example.com');
    assert.equal('token' in resp.body, false);
    assert.ok(resp.rawToken, 'expected sendPrincipalInvitationEmail to have been called with a real token');
  });

  await t.test('invite-principal rejects an unknown college', async () => {
    const token = await platformToken();
    const resp = await invite(token, 'no-such-college', 'principal@example.com');
    assert.equal(resp.status, 404);
  });

  // --- Accepting an invitation (tenant side) ---

  await t.test('accept creates a correctly tenant-scoped user', async () => {
    const token = await platformToken();
    const inviteResp = await invite(token, collegeA, 'principal@example.com');
    const rawToken = inviteResp.rawToken;

    const username = `accepted${crypto.randomUUID().slice(0, 8)}`;
    const resp = await accept(rawToken, username);
    assert.equal(resp.status, 201);
    assert.equal(resp.body.college_id, collegeA);
    assert.equal(resp.body.username, username);
    assert.equal(resp.body.role, 'principal');

    // The real check: not the response body, RLS itself, exactly as
    // arcnave_app (the runtime role) would see it on any other
    // request.
    const seenUnderA = await userVisibleUnderTenant(collegeA, username);
    assert.ok(seenUnderA);
    const seenUnderB = await userVisibleUnderTenant(collegeB, username);
    assert.equal(seenUnderB, null);

    // And the created account actually works through the ordinary
    // tenant login path.
    const collegeRow = await adminPool.query('SELECT subdomain FROM colleges WHERE college_id = $1', [collegeA]);
    const subdomain = collegeRow.rows[0].subdomain;
    const loginResp = await post(
      baseUrl,
      '/api/v1/auth/login',
      { host: `${subdomain}.arcnave.test` },
      { username, password: ACCEPT_PASSWORD },
    );
    assert.equal(loginResp.status, 200);
  });

  await t.test('an expired token is rejected', async () => {
    const rawToken = `expired-${crypto.randomUUID()}`;
    await adminPool.query(
      `INSERT INTO principal_invitations (college_id, email, token_hash, expires_at)
       VALUES ($1, 'expired@example.com', $2, $3)`,
      [collegeA, security.hashRefreshToken(rawToken), new Date(Date.now() - 60 * 60 * 1000)],
    );

    const resp = await accept(rawToken, `shouldnotexist${crypto.randomUUID().slice(0, 8)}`);
    assert.equal(resp.status, 401);
    assert.equal(resp.body.detail, 'Invalid or expired invitation');
  });

  await t.test('reuse of an already-accepted token is rejected and logged, same message as expired', async () => {
    // A fresh college, not collegeA — collegeA already has an active
    // principal from the 'accept creates a correctly tenant-scoped
    // user' test above, and this session's own task (at most one
    // active Principal per college) now enforces that for real; a
    // second successful accept against collegeA would 409 for an
    // unrelated reason before this test ever reaches what it's
    // actually testing (reuse rejection).
    const collegeC = await seedCollege('c');
    const token = await platformToken();
    const inviteResp = await invite(token, collegeC, 'principal@example.com');
    const rawToken = inviteResp.rawToken;
    const username = `accepted${crypto.randomUUID().slice(0, 8)}`;

    const first = await accept(rawToken, username);
    assert.equal(first.status, 201);

    const originalWarn = console.warn;
    const lines = [];
    console.warn = (text) => {
      lines.push(text);
    };
    let second;
    try {
      second = await accept(rawToken, `different${crypto.randomUUID().slice(0, 8)}`);
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(second.status, 401);
    assert.equal(second.body.detail, 'Invalid or expired invitation');
    assert.ok(
      lines.some((text) => JSON.parse(text).message === 'principal_invitation_reuse_detected'),
      'expected console.warn to be called with a principal_invitation_reuse_detected log line',
    );
  });

  await t.test('an unknown token is rejected with the same message', async () => {
    const resp = await accept('not-a-real-invitation-token', `nouser${crypto.randomUUID().slice(0, 8)}`);
    assert.equal(resp.status, 401);
    assert.equal(resp.body.detail, 'Invalid or expired invitation');
  });

  await t.test('a duplicate username within the same tenant is rejected with 409', async () => {
    // A pre-seeded non-principal user with the target username,
    // inserted directly (bypassing invite/accept) — isolates the
    // username conflict from this session's own new "one active
    // Principal per college" constraint, which a SECOND real accept
    // into the same college would also trip regardless of username
    // (every accept always creates role: 'principal').
    const collegeD = await seedCollege('d');
    const username = `dupuser${crypto.randomUUID().slice(0, 8)}`;
    await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, 'staff', true)`,
      [collegeD, username, `${username}@example.com`, await security.hashPassword(ACCEPT_PASSWORD)],
    );

    const token = await platformToken();
    const invite1 = await invite(token, collegeD, 'first@example.com');
    const accept1 = await accept(invite1.rawToken, username);
    assert.equal(accept1.status, 409);
  });

  // --- Resend / revoke (this session's own task) ---

  await t.test('resend rotates the token, emails the new one, and never returns it; the old token stops working', async () => {
    // A fresh college — see the 'reuse' test above for why: this test
    // completes a real accept, and collegeA's one active-principal
    // slot is already taken.
    const collegeE = await seedCollege('e');
    const token = await platformToken();
    const inviteResp = await invite(token, collegeE, 'resend@example.com');
    const oldToken = inviteResp.rawToken;

    lastInvitationToken = null;
    const resendResp = await post(
      baseUrl,
      `/api/v1/platform/invitations/${inviteResp.body.invitation_id}/resend`,
      { authorization: `Bearer ${token}` },
    );
    assert.equal(resendResp.status, 200);
    assert.equal('token' in resendResp.body, false);
    const newToken = lastInvitationToken;
    assert.ok(newToken);
    assert.notEqual(newToken, oldToken);

    const oldAccept = await accept(oldToken, `shouldnotwork${crypto.randomUUID().slice(0, 8)}`);
    assert.equal(oldAccept.status, 401);

    const newAccept = await accept(newToken, `resendaccepted${crypto.randomUUID().slice(0, 8)}`);
    assert.equal(newAccept.status, 201);
  });

  await t.test('resend on an already-accepted invitation is a real 409', async () => {
    const collegeF = await seedCollege('f');
    const token = await platformToken();
    const inviteResp = await invite(token, collegeF, 'resend2@example.com');
    const accepted = await accept(inviteResp.rawToken, `resend2accepted${crypto.randomUUID().slice(0, 8)}`);
    assert.equal(accepted.status, 201);

    const resendResp = await post(
      baseUrl,
      `/api/v1/platform/invitations/${inviteResp.body.invitation_id}/resend`,
      { authorization: `Bearer ${token}` },
    );
    assert.equal(resendResp.status, 409);
  });

  await t.test('revoke invalidates the invitation; accepting a revoked token is rejected with the same generic message', async () => {
    const token = await platformToken();
    const inviteResp = await invite(token, collegeA, 'revoke@example.com');

    const revokeResp = await post(
      baseUrl,
      `/api/v1/platform/invitations/${inviteResp.body.invitation_id}/revoke`,
      { authorization: `Bearer ${token}` },
    );
    assert.equal(revokeResp.status, 200);
    assert.ok(revokeResp.body.revoked_at);

    const acceptResp = await accept(inviteResp.rawToken, `revokeattempt${crypto.randomUUID().slice(0, 8)}`);
    assert.equal(acceptResp.status, 401);
    assert.equal(acceptResp.body.detail, 'Invalid or expired invitation');
  });

  await t.test('resend revives a revoked invitation — new token accepts, old one still does not', async () => {
    const collegeG = await seedCollege('g');
    const token = await platformToken();
    const inviteResp = await invite(token, collegeG, 'revive@example.com');
    const oldToken = inviteResp.rawToken;

    const revokeResp = await post(
      baseUrl,
      `/api/v1/platform/invitations/${inviteResp.body.invitation_id}/revoke`,
      { authorization: `Bearer ${token}` },
    );
    assert.equal(revokeResp.status, 200);

    lastInvitationToken = null;
    const resendResp = await post(
      baseUrl,
      `/api/v1/platform/invitations/${inviteResp.body.invitation_id}/resend`,
      { authorization: `Bearer ${token}` },
    );
    assert.equal(resendResp.status, 200);
    const newToken = lastInvitationToken;
    assert.ok(newToken);

    const oldAccept = await accept(oldToken, `revivedold${crypto.randomUUID().slice(0, 8)}`);
    assert.equal(oldAccept.status, 401);

    const newAccept = await accept(newToken, `revivednew${crypto.randomUUID().slice(0, 8)}`);
    assert.equal(newAccept.status, 201);
  });

  await t.test('revoke and resend both 404 for an unknown invitation id', async () => {
    const token = await platformToken();
    const missingId = crypto.randomUUID();

    const revokeResp = await post(
      baseUrl,
      `/api/v1/platform/invitations/${missingId}/revoke`,
      { authorization: `Bearer ${token}` },
    );
    assert.equal(revokeResp.status, 404);

    const resendResp = await post(
      baseUrl,
      `/api/v1/platform/invitations/${missingId}/resend`,
      { authorization: `Bearer ${token}` },
    );
    assert.equal(resendResp.status, 404);
  });

  // --- Cross-tenant isolation ---

  await t.test(
    'one college\'s invitation can never create a user under a different college_id',
    async () => {
      // Fresh colleges, not collegeA/collegeB — both already-used
      // colleges elsewhere in this file may already have their one
      // active principal; this test only needs two colleges that have
      // never had a successful accept yet, not specifically A/B.
      const collegeG = await seedCollege('g');
      const collegeH = await seedCollege('h');
      const token = await platformToken();
      const inviteA = await invite(token, collegeG, 'principal-a@example.com');
      const inviteB = await invite(token, collegeH, 'principal-b@example.com');

      const sharedUsername = `sharedprincipal${crypto.randomUUID().slice(0, 8)}`;

      const respA = await accept(inviteA.rawToken, sharedUsername);
      const respB = await accept(inviteB.rawToken, sharedUsername);
      assert.equal(respA.status, 201);
      assert.equal(respB.status, 201);
      assert.equal(respA.body.college_id, collegeG);
      assert.equal(respB.body.college_id, collegeH);

      // RLS-scoped proof each row landed under its own college, not
      // the other one.
      const rowUnderA = await userVisibleUnderTenant(collegeG, sharedUsername);
      assert.ok(rowUnderA);
      assert.equal(rowUnderA.college_id, collegeG);

      const rowUnderB = await userVisibleUnderTenant(collegeH, sharedUsername);
      assert.ok(rowUnderB);
      assert.equal(rowUnderB.college_id, collegeH);
    },
  );
});

// CLAUDE.md rule 1 ("every route calls a Business Service, never a
// repository") for POST /invitations/accept specifically: this file's
// own HTTP tests above prove the route still behaves correctly after
// the authService.lookupPendingInvitation/acceptInvitation refactor,
// but not that the bypass itself is actually gone — a source check on
// the route file itself is the one thing that proves it.
test('routes/invitations.js calls authService only, no repository imports', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/invitations.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"]\.\.\/repositories\//);
  assert.match(source, /require\(['"]\.\.\/services\/authService['"]\)/);
});
