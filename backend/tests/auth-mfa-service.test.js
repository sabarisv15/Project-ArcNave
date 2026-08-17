'use strict';

// Unit tests for business rule task #19 (BusinessRules.md Platform
// administration, "Authentication" — MFA configurable per institution,
// Disabled/Optional/Mandatory, may be scoped to roles). No live
// Postgres: authRepository/userMfaOtpRepository/notificationService/
// configurationService/auditLogRepository are stubbed via node:test's
// built-in mock, same technique as auth-service.test.js /
// auth-audit-logging.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const authRepository = require('../src/repositories/authRepository');
const userMfaOtpRepository = require('../src/repositories/userMfaOtpRepository');
const notificationService = require('../src/services/notificationService');
const configurationService = require('../src/services/configurationService');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const security = require('../src/security');
const authService = require('../src/services/authService');

const BASE_USER = {
  id: 'u1', college_id: 'c1', role: 'staff', email: 'jdoe@college.edu', password_hash: 'hash', is_active: true, mfa_enabled: false,
};

function mockLoginPrereqs(t, { user = BASE_USER, authConfig = null } = {}) {
  const getUserMock = t.mock.method(authRepository, 'getUserByUsername', async () => user);
  const verifyMock = t.mock.method(security, 'verifyPassword', async () => true);
  const needsRehashMock = t.mock.method(security, 'needsRehash', async () => false);
  const authConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => (
    authConfig === null ? null : { category: 'auth', configuration: authConfig, version: 1 }
  ));
  const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
  t.after(() => {
    getUserMock.mock.restore();
    verifyMock.mock.restore();
    needsRehashMock.mock.restore();
    authConfigMock.mock.restore();
    auditMock.mock.restore();
  });
  return { auditMock };
}

test('login MFA gating', async (t) => {
  await t.test('mode disabled (or unset) — logs straight in, no challenge', async () => {
    const { auditMock } = mockLoginPrereqs(t, { authConfig: { mfaMode: 'disabled', mfaRoles: null } });
    const createRefreshTokenMock = t.mock.method(authRepository, 'createRefreshToken', async () => {});
    const challengeMock = t.mock.method(userMfaOtpRepository, 'create', async () => { throw new Error('must not be called'); });
    t.after(() => {
      createRefreshTokenMock.mock.restore();
      challengeMock.mock.restore();
    });

    const result = await authService.login({}, { collegeId: 'c1', username: 'jdoe', password: 'correct' });

    assert.equal(result.mfaRequired, undefined);
    assert.equal(typeof result.accessToken, 'string');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'user_login');
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.result, 'success');
  });

  await t.test('mode mandatory — every in-scope user gets a challenge, regardless of mfa_enabled', async () => {
    mockLoginPrereqs(t, { authConfig: { mfaMode: 'mandatory', mfaRoles: null } });
    const createChallengeMock = t.mock.method(userMfaOtpRepository, 'create', async (client, fields) => ({ id: 'otp-1', ...fields }));
    const emailMock = t.mock.method(notificationService, 'sendMfaCodeEmail', async () => ({ status: 'stubbed' }));
    t.after(() => {
      createChallengeMock.mock.restore();
      emailMock.mock.restore();
    });

    const result = await authService.login({}, { collegeId: 'c1', username: 'jdoe', password: 'correct' });

    assert.equal(result.mfaRequired, true);
    assert.equal(result.challengeId, 'otp-1');
    assert.equal(createChallengeMock.mock.callCount(), 1);
    assert.equal(emailMock.mock.calls[0].arguments[1].to, 'jdoe@college.edu');
  });

  await t.test('mode mandatory scoped to roles — a user outside the scoped roles logs straight in', async () => {
    const { auditMock } = mockLoginPrereqs(t, { authConfig: { mfaMode: 'mandatory', mfaRoles: ['hod', 'principal'] } });
    const createRefreshTokenMock = t.mock.method(authRepository, 'createRefreshToken', async () => {});
    t.after(() => createRefreshTokenMock.mock.restore());

    const result = await authService.login({}, { collegeId: 'c1', username: 'jdoe', password: 'correct' });

    assert.equal(result.mfaRequired, undefined);
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.result, 'success');
  });

  await t.test('mode mandatory scoped to roles — a user inside the scoped roles is challenged', async () => {
    mockLoginPrereqs(t, {
      user: { ...BASE_USER, role: 'hod' },
      authConfig: { mfaMode: 'mandatory', mfaRoles: ['hod', 'principal'] },
    });
    const createChallengeMock = t.mock.method(userMfaOtpRepository, 'create', async () => ({ id: 'otp-2' }));
    const emailMock = t.mock.method(notificationService, 'sendMfaCodeEmail', async () => ({ status: 'stubbed' }));
    t.after(() => {
      createChallengeMock.mock.restore();
      emailMock.mock.restore();
    });

    const result = await authService.login({}, { collegeId: 'c1', username: 'jdoe', password: 'correct' });
    assert.equal(result.mfaRequired, true);
  });

  await t.test('mode optional — a user who never opted in logs straight in', async () => {
    const { auditMock } = mockLoginPrereqs(t, {
      user: { ...BASE_USER, mfa_enabled: false },
      authConfig: { mfaMode: 'optional', mfaRoles: null },
    });
    const createRefreshTokenMock = t.mock.method(authRepository, 'createRefreshToken', async () => {});
    t.after(() => createRefreshTokenMock.mock.restore());

    const result = await authService.login({}, { collegeId: 'c1', username: 'jdoe', password: 'correct' });
    assert.equal(result.mfaRequired, undefined);
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.result, 'success');
  });

  await t.test('mode optional — a user who opted in (mfa_enabled) is challenged', async () => {
    mockLoginPrereqs(t, {
      user: { ...BASE_USER, mfa_enabled: true },
      authConfig: { mfaMode: 'optional', mfaRoles: null },
    });
    const createChallengeMock = t.mock.method(userMfaOtpRepository, 'create', async () => ({ id: 'otp-3' }));
    const emailMock = t.mock.method(notificationService, 'sendMfaCodeEmail', async () => ({ status: 'stubbed' }));
    t.after(() => {
      createChallengeMock.mock.restore();
      emailMock.mock.restore();
    });

    const result = await authService.login({}, { collegeId: 'c1', username: 'jdoe', password: 'correct' });
    assert.equal(result.mfaRequired, true);
  });

  await t.test('an unknown mfaMode value in a stored row falls back to disabled', async () => {
    const { auditMock } = mockLoginPrereqs(t, { authConfig: { mfaMode: 'bogus', mfaRoles: null } });
    const createRefreshTokenMock = t.mock.method(authRepository, 'createRefreshToken', async () => {});
    t.after(() => createRefreshTokenMock.mock.restore());

    const result = await authService.login({}, { collegeId: 'c1', username: 'jdoe', password: 'correct' });
    assert.equal(result.mfaRequired, undefined);
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.result, 'success');
  });
});

test('verifyMfaLogin', async (t) => {
  await t.test('rejects a missing challengeId or code before touching the DB', async () => {
    const findMock = t.mock.method(userMfaOtpRepository, 'findById');
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => authService.verifyMfaLogin({}, { challengeId: null, code: '123456' }),
      authService.MfaChallengeNotFoundError,
    );
    assert.equal(findMock.mock.callCount(), 0);
  });

  await t.test('rejects an unknown challengeId', async () => {
    const findMock = t.mock.method(userMfaOtpRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => authService.verifyMfaLogin({}, { challengeId: 'missing', code: '123456' }),
      authService.MfaChallengeNotFoundError,
    );
  });

  await t.test('rejects an already-consumed challenge', async () => {
    const findMock = t.mock.method(userMfaOtpRepository, 'findById', async () => ({
      id: 'otp-1', user_id: 'u1', consumed_at: new Date(), expires_at: new Date(Date.now() + 60_000), attempts: 0, code_hash: 'x',
    }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => authService.verifyMfaLogin({}, { challengeId: 'otp-1', code: '123456' }),
      authService.MfaChallengeNotFoundError,
    );
  });

  await t.test('rejects an expired challenge', async () => {
    const findMock = t.mock.method(userMfaOtpRepository, 'findById', async () => ({
      id: 'otp-1', user_id: 'u1', consumed_at: null, expires_at: new Date(Date.now() - 1000), attempts: 0, code_hash: 'x',
    }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => authService.verifyMfaLogin({}, { challengeId: 'otp-1', code: '123456' }),
      authService.MfaChallengeNotFoundError,
    );
  });

  await t.test('rejects a challenge already at the attempt cap', async () => {
    const findMock = t.mock.method(userMfaOtpRepository, 'findById', async () => ({
      id: 'otp-1', user_id: 'u1', consumed_at: null, expires_at: new Date(Date.now() + 60_000), attempts: 5, code_hash: 'x',
    }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => authService.verifyMfaLogin({}, { challengeId: 'otp-1', code: '123456' }),
      authService.MfaMaxAttemptsExceededError,
    );
  });

  await t.test('a mismatched code increments attempts and rejects', async () => {
    const findMock = t.mock.method(userMfaOtpRepository, 'findById', async () => ({
      id: 'otp-1', user_id: 'u1', consumed_at: null, expires_at: new Date(Date.now() + 60_000), attempts: 0, code_hash: 'does-not-match-anything',
    }));
    const incrementMock = t.mock.method(userMfaOtpRepository, 'incrementAttempts', async () => {});
    t.after(() => {
      findMock.mock.restore();
      incrementMock.mock.restore();
    });

    await assert.rejects(
      () => authService.verifyMfaLogin({}, { challengeId: 'otp-1', code: '000000' }),
      authService.MfaCodeMismatchError,
    );
    assert.equal(incrementMock.mock.callCount(), 1);
  });

  await t.test('a matching code consumes the challenge and issues real tokens, auditing user_login success with mfa:true', async () => {
    const crypto = require('node:crypto');
    const codeHash = crypto.createHash('sha256').update('654321').digest('hex');
    const findMock = t.mock.method(userMfaOtpRepository, 'findById', async () => ({
      id: 'otp-1', user_id: 'u1', consumed_at: null, expires_at: new Date(Date.now() + 60_000), attempts: 0, code_hash: codeHash,
    }));
    const markConsumedMock = t.mock.method(userMfaOtpRepository, 'markConsumed', async () => {});
    const getUserMock = t.mock.method(authRepository, 'getUserById', async () => ({ id: 'u1', college_id: 'c1', role: 'staff', is_active: true }));
    const createRefreshTokenMock = t.mock.method(authRepository, 'createRefreshToken', async () => {});
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      markConsumedMock.mock.restore();
      getUserMock.mock.restore();
      createRefreshTokenMock.mock.restore();
      auditMock.mock.restore();
    });

    const tokens = await authService.verifyMfaLogin({}, { challengeId: 'otp-1', code: '654321' });

    assert.equal(typeof tokens.accessToken, 'string');
    assert.equal(markConsumedMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'user_login');
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.result, 'success');
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.mfa, true);
  });

  await t.test('rejects if the user backing the challenge is no longer active', async () => {
    const crypto = require('node:crypto');
    const codeHash = crypto.createHash('sha256').update('111111').digest('hex');
    const findMock = t.mock.method(userMfaOtpRepository, 'findById', async () => ({
      id: 'otp-1', user_id: 'u1', consumed_at: null, expires_at: new Date(Date.now() + 60_000), attempts: 0, code_hash: codeHash,
    }));
    const markConsumedMock = t.mock.method(userMfaOtpRepository, 'markConsumed', async () => {});
    const getUserMock = t.mock.method(authRepository, 'getUserById', async () => ({ id: 'u1', college_id: 'c1', role: 'staff', is_active: false }));
    t.after(() => {
      findMock.mock.restore();
      markConsumedMock.mock.restore();
      getUserMock.mock.restore();
    });

    await assert.rejects(
      () => authService.verifyMfaLogin({}, { challengeId: 'otp-1', code: '111111' }),
      authService.AuthError,
    );
  });
});

test('enableMfa / disableMfa', async (t) => {
  await t.test('enableMfa flips the flag and audits mfa_enabled', async () => {
    const setMock = t.mock.method(authRepository, 'setMfaEnabled', async (client, userId, enabled) => ({
      id: userId, college_id: 'c1', mfa_enabled: enabled,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      setMock.mock.restore();
      auditMock.mock.restore();
    });

    const user = await authService.enableMfa({}, 'u1');
    assert.equal(user.mfa_enabled, true);
    assert.equal(setMock.mock.calls[0].arguments[2], true);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'mfa_enabled');
  });

  await t.test('disableMfa flips the flag and audits mfa_disabled', async () => {
    const setMock = t.mock.method(authRepository, 'setMfaEnabled', async (client, userId, enabled) => ({
      id: userId, college_id: 'c1', mfa_enabled: enabled,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      setMock.mock.restore();
      auditMock.mock.restore();
    });

    const user = await authService.disableMfa({}, 'u1');
    assert.equal(user.mfa_enabled, false);
    assert.equal(setMock.mock.calls[0].arguments[2], false);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'mfa_disabled');
  });

  await t.test('enableMfa throws UserNotFoundError for a nonexistent userId', async () => {
    const setMock = t.mock.method(authRepository, 'setMfaEnabled', async () => null);
    t.after(() => setMock.mock.restore());

    await assert.rejects(
      () => authService.enableMfa({}, 'missing-user'),
      authService.UserNotFoundError,
    );
  });
});
