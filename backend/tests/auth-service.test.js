'use strict';

// Unit tests for AuthService's activateUser (Module 8) — no live
// Postgres: authRepository is stubbed via node:test's built-in mock,
// same technique every other *-service.test.js file uses. Login/
// refresh/revoke are already covered end-to-end at the HTTP level in
// auth.test.js; this file only covers the one function that has no
// route yet.

const test = require('node:test');
const assert = require('node:assert/strict');
const authRepository = require('../src/repositories/authRepository');
const notificationService = require('../src/services/notificationService');
const security = require('../src/security');
const authService = require('../src/services/authService');

test('AuthService.activateUser (no DB)', async (t) => {
  await t.test('generates a fresh password, hashes it, and activates via a single repository call', async () => {
    const activateMock = t.mock.method(authRepository, 'activateUser', async (client, userId, fields) => ({
      id: userId,
      college_id: 'c1',
      username: 'jdoe',
      email: 'jdoe@college.edu',
      role: 'staff',
      is_active: true,
      activated_by: fields.activatedBy,
    }));
    t.after(() => activateMock.mock.restore());

    const result = await authService.activateUser({}, 'user-1', { activatedBy: 'principal-1' });

    assert.equal(result.user.id, 'user-1');
    assert.equal(result.user.is_active, true);
    assert.equal(result.user.activated_by, 'principal-1');
    assert.equal(typeof result.plainPassword, 'string');
    assert.ok(result.plainPassword.length >= 12);

    const passedFields = activateMock.mock.calls[0].arguments[2];
    assert.equal(passedFields.activatedBy, 'principal-1');
    // The plaintext password must never be passed to the repository —
    // only its hash. Verified against the real hash, not just "is a
    // different string," so a caller couldn't accidentally pass the
    // plaintext through some other hashed-looking value.
    assert.notEqual(passedFields.passwordHash, result.plainPassword);
    assert.ok(await security.verifyPassword(result.plainPassword, passedFields.passwordHash));
  });

  await t.test('throws UserNotFoundError for a nonexistent userId', async () => {
    const activateMock = t.mock.method(authRepository, 'activateUser', async () => null);
    t.after(() => activateMock.mock.restore());

    await assert.rejects(
      () => authService.activateUser({}, 'missing-user', { activatedBy: 'principal-1' }),
      authService.UserNotFoundError,
    );
  });

  await t.test('two calls generate two different passwords', async () => {
    const activateMock = t.mock.method(authRepository, 'activateUser', async (client, userId) => ({ id: userId, is_active: true }));
    t.after(() => activateMock.mock.restore());

    const first = await authService.activateUser({}, 'user-1', { activatedBy: 'principal-1' });
    const second = await authService.activateUser({}, 'user-1', { activatedBy: 'principal-1' });

    assert.notEqual(first.plainPassword, second.plainPassword);
  });
});

// This session's own task: password reset must go out through the
// existing notification flow, never in an API response, and must be
// enumeration-safe (an unknown email and a real one look identical to
// the caller).
test('AuthService.requestPasswordReset / resetPassword (no DB)', async (t) => {
  await t.test('requestPasswordReset does nothing for an unknown email — no token created, no email sent', async () => {
    const lookupMock = t.mock.method(authRepository, 'getUserByEmail', async () => null);
    const createTokenMock = t.mock.method(authRepository, 'createPasswordResetToken', async () => {});
    const emailMock = t.mock.method(notificationService, 'sendPasswordResetEmail', async () => ({ status: 'stubbed' }));
    t.after(() => {
      lookupMock.mock.restore();
      createTokenMock.mock.restore();
      emailMock.mock.restore();
    });

    await authService.requestPasswordReset({}, { collegeId: 'c1', email: 'nobody@example.com' });

    assert.equal(createTokenMock.mock.callCount(), 0);
    assert.equal(emailMock.mock.callCount(), 0);
  });

  await t.test('requestPasswordReset does nothing for an inactive account — same as unknown', async () => {
    const lookupMock = t.mock.method(authRepository, 'getUserByEmail', async () => ({
      id: 'user-1', email: 'pending@example.com', is_active: false,
    }));
    const createTokenMock = t.mock.method(authRepository, 'createPasswordResetToken', async () => {});
    const emailMock = t.mock.method(notificationService, 'sendPasswordResetEmail', async () => ({ status: 'stubbed' }));
    t.after(() => {
      lookupMock.mock.restore();
      createTokenMock.mock.restore();
      emailMock.mock.restore();
    });

    await authService.requestPasswordReset({}, { collegeId: 'c1', email: 'pending@example.com' });

    assert.equal(createTokenMock.mock.callCount(), 0);
    assert.equal(emailMock.mock.callCount(), 0);
  });

  await t.test('requestPasswordReset for a real, active account creates a hashed token and emails it — never the raw token', async () => {
    const lookupMock = t.mock.method(authRepository, 'getUserByEmail', async () => ({
      id: 'user-1', email: 'jdoe@college.edu', is_active: true,
    }));
    const createTokenMock = t.mock.method(authRepository, 'createPasswordResetToken', async () => {});
    const emailMock = t.mock.method(notificationService, 'sendPasswordResetEmail', async () => ({ status: 'stubbed' }));
    t.after(() => {
      lookupMock.mock.restore();
      createTokenMock.mock.restore();
      emailMock.mock.restore();
    });

    await authService.requestPasswordReset({}, { collegeId: 'c1', email: 'jdoe@college.edu' });

    assert.equal(createTokenMock.mock.callCount(), 1);
    const stored = createTokenMock.mock.calls[0].arguments[1];
    assert.equal(stored.userId, 'user-1');
    assert.equal(stored.collegeId, 'c1');

    assert.equal(emailMock.mock.callCount(), 1);
    const emailArgs = emailMock.mock.calls[0].arguments[1];
    assert.equal(emailArgs.to, 'jdoe@college.edu');
    // The token stored (hashed) must never equal the raw token emailed
    // — same discipline refresh tokens already follow.
    assert.notEqual(stored.tokenHash, emailArgs.token);
    assert.equal(stored.tokenHash, security.hashRefreshToken(emailArgs.token));
  });

  await t.test('resetPassword rejects a missing newPassword before touching the DB', async () => {
    const lookupMock = t.mock.method(authRepository, 'getPasswordResetTokenByHash');
    t.after(() => lookupMock.mock.restore());

    await assert.rejects(
      () => authService.resetPassword({}, { token: 'sometoken', newPassword: undefined }),
      authService.PasswordResetValidationError,
    );
    assert.equal(lookupMock.mock.callCount(), 0);
  });

  await t.test('resetPassword rejects an unknown token', async () => {
    const lookupMock = t.mock.method(authRepository, 'getPasswordResetTokenByHash', async () => null);
    t.after(() => lookupMock.mock.restore());

    await assert.rejects(
      () => authService.resetPassword({}, { token: 'unknown', newPassword: 'NewPassword-123' }),
      authService.PasswordResetTokenError,
    );
  });

  await t.test('resetPassword rejects an already-used token', async () => {
    const lookupMock = t.mock.method(authRepository, 'getPasswordResetTokenByHash', async () => ({
      id: 'prt-1', user_id: 'user-1', used_at: new Date(), expires_at: new Date(Date.now() + 3600_000),
    }));
    t.after(() => lookupMock.mock.restore());

    await assert.rejects(
      () => authService.resetPassword({}, { token: 'used-token', newPassword: 'NewPassword-123' }),
      authService.PasswordResetTokenError,
    );
  });

  await t.test('resetPassword rejects an expired token', async () => {
    const lookupMock = t.mock.method(authRepository, 'getPasswordResetTokenByHash', async () => ({
      id: 'prt-1', user_id: 'user-1', used_at: null, expires_at: new Date(Date.now() - 1000),
    }));
    t.after(() => lookupMock.mock.restore());

    await assert.rejects(
      () => authService.resetPassword({}, { token: 'expired-token', newPassword: 'NewPassword-123' }),
      authService.PasswordResetTokenError,
    );
  });

  await t.test('resetPassword on a valid token updates the password hash and marks the token used', async () => {
    const lookupMock = t.mock.method(authRepository, 'getPasswordResetTokenByHash', async () => ({
      id: 'prt-1', user_id: 'user-1', used_at: null, expires_at: new Date(Date.now() + 3600_000),
    }));
    const updateMock = t.mock.method(authRepository, 'updatePasswordHash', async () => {});
    const markUsedMock = t.mock.method(authRepository, 'markPasswordResetTokenUsed', async () => {});
    const incrementVersionMock = t.mock.method(authRepository, 'incrementTokenVersion', async () => 1);
    const revokeRefreshMock = t.mock.method(authRepository, 'revokeAllRefreshTokensForUser', async () => {});
    t.after(() => {
      lookupMock.mock.restore();
      updateMock.mock.restore();
      markUsedMock.mock.restore();
      incrementVersionMock.mock.restore();
      revokeRefreshMock.mock.restore();
    });

    await authService.resetPassword({}, { token: 'valid-token', newPassword: 'NewPassword-123' });

    assert.equal(updateMock.mock.calls[0].arguments[1], 'user-1');
    assert.ok(await security.verifyPassword('NewPassword-123', updateMock.mock.calls[0].arguments[2]));
    assert.equal(markUsedMock.mock.calls[0].arguments[1], 'prt-1');
    // ADR-024: a reset must also revoke every already-issued session
    // for this account, not just change the hash a future login
    // compares against — see authService.resetPassword's own comment.
    assert.equal(incrementVersionMock.mock.calls[0].arguments[1], 'user-1');
    assert.equal(revokeRefreshMock.mock.calls[0].arguments[1], 'user-1');
  });
});
