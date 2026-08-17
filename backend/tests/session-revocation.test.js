'use strict';

// Unit tests for ADR-024 (Session revocation, direct DB check, no
// cache layer yet) — security.createAccessToken's token_version
// claim, and middleware/sessionRevocation.js's unconditional
// enforcement logic. authService/req.dbClient are mocked via
// node:test's built-in mock, same technique as every other
// *-service.test.js file in this suite — no live Postgres needed for
// these; the real-DB end-to-end proof (a password reset actually
// invalidating a previously-issued token) lives in
// tests/session-revocation-e2e.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const security = require('../src/security');
const config = require('../src/config');
const authService = require('../src/services/authService');
const positionAccountAuthService = require('../src/services/positionAccountAuthService');
const { sessionRevocationMiddleware } = require('../src/middleware/sessionRevocation');

test('security.createAccessToken embeds token_version', async (t) => {
  await t.test('defaults to 0 when no tokenVersion is passed', () => {
    const token = security.createAccessToken({ userId: 'u1', collegeId: 'c1', role: 'staff' });
    const claims = jwt.verify(token, config.jwtSecretKey, { algorithms: [config.jwtAlgorithm] });
    assert.equal(claims.token_version, 0);
  });

  await t.test('carries an explicit tokenVersion through', () => {
    const token = security.createAccessToken({
      userId: 'u1', collegeId: 'c1', role: 'staff', tokenVersion: 7,
    });
    const claims = jwt.verify(token, config.jwtSecretKey, { algorithms: [config.jwtAlgorithm] });
    assert.equal(claims.token_version, 7);
  });
});

function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

test('sessionRevocationMiddleware', async (t) => {
  await t.test('lets a request through whose token_version still matches the DB', async () => {
    const getVersionMock = t.mock.method(authService, 'getCurrentTokenVersion', async () => 3);
    t.after(() => getVersionMock.mock.restore());

    const req = { jwtClaims: { sub: 'u1', type: 'access', token_version: 3 }, dbClient: {} };
    const res = fakeRes();
    let nextCalled = false;
    await sessionRevocationMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
  });

  await t.test('rejects a token whose embedded version is stale (e.g. after a password reset)', async () => {
    const getVersionMock = t.mock.method(authService, 'getCurrentTokenVersion', async () => 4);
    t.after(() => getVersionMock.mock.restore());

    const req = { jwtClaims: { sub: 'u1', type: 'access', token_version: 3 }, dbClient: {} };
    const res = fakeRes();
    let nextCalled = false;
    await sessionRevocationMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });

  await t.test('rejects a token naming a user that no longer exists', async () => {
    const getVersionMock = t.mock.method(authService, 'getCurrentTokenVersion', async () => null);
    t.after(() => getVersionMock.mock.restore());

    const req = { jwtClaims: { sub: 'ghost', type: 'access', token_version: 0 }, dbClient: {} };
    const res = fakeRes();
    let nextCalled = false;
    await sessionRevocationMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });

  await t.test('passes through a missing/invalid token unchecked — RBAC downstream still 401s it', async () => {
    const getVersionMock = t.mock.method(authService, 'getCurrentTokenVersion', async () => 0);
    t.after(() => getVersionMock.mock.restore());

    const req = { jwtClaims: null, dbClient: {} };
    const res = fakeRes();
    let nextCalled = false;
    await sessionRevocationMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(getVersionMock.mock.callCount(), 0);
  });

  // Phase 2 step 5: a 'position_access' token checks
  // position_accounts.token_version via positionAccountAuthService,
  // never authService/users.token_version — proven by asserting each
  // mock is called (or not) for the matching claim type.
  await t.test('position_access: lets a request through whose token_version matches position_accounts, never touching authService', async () => {
    const userVersionMock = t.mock.method(authService, 'getCurrentTokenVersion', async () => { throw new Error('must not be called for position_access'); });
    const positionVersionMock = t.mock.method(positionAccountAuthService, 'getCurrentPositionAccountTokenVersion', async () => 2);
    t.after(() => {
      userVersionMock.mock.restore();
      positionVersionMock.mock.restore();
    });

    const req = { jwtClaims: { sub: 'acct-1', type: 'position_access', token_version: 2 }, dbClient: {} };
    const res = fakeRes();
    let nextCalled = false;
    await sessionRevocationMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
    assert.equal(userVersionMock.mock.callCount(), 0);
    assert.equal(positionVersionMock.mock.callCount(), 1);
  });

  await t.test('position_access: rejects a stale token_version independently of the same occupant\'s users.token_version', async () => {
    const positionVersionMock = t.mock.method(positionAccountAuthService, 'getCurrentPositionAccountTokenVersion', async () => 5);
    t.after(() => positionVersionMock.mock.restore());

    const req = { jwtClaims: { sub: 'acct-1', type: 'position_access', token_version: 4 }, dbClient: {} };
    const res = fakeRes();
    let nextCalled = false;
    await sessionRevocationMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });

  await t.test('position_access: rejects a token naming a position account that no longer exists', async () => {
    const positionVersionMock = t.mock.method(positionAccountAuthService, 'getCurrentPositionAccountTokenVersion', async () => null);
    t.after(() => positionVersionMock.mock.restore());

    const req = { jwtClaims: { sub: 'ghost-acct', type: 'position_access', token_version: 0 }, dbClient: {} };
    const res = fakeRes();
    let nextCalled = false;
    await sessionRevocationMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });
});
