'use strict';

// Unit tests for the audit-log coverage added to authService's login/
// refresh/revoke (task #17 — BusinessRules.md Central audit log names
// "login/logout" explicitly, and this codebase had zero audit_log
// entries for either before this slice). No live Postgres needed:
// authRepository/security/auditLogRepository are stubbed via
// node:test's built-in mock, same technique as auth-service.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const authRepository = require('../src/repositories/authRepository');
const security = require('../src/security');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const configurationService = require('../src/services/configurationService');
const authService = require('../src/services/authService');

test('login audit logging', async (t) => {
  await t.test('audits a failed login for an unknown username, with no userId', async () => {
    const getUserMock = t.mock.method(authRepository, 'getUserByUsername', async () => null);
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      getUserMock.mock.restore();
      auditMock.mock.restore();
    });

    await assert.rejects(
      () => authService.login({}, { collegeId: 'c1', username: 'nobody', password: 'x' }),
      authService.AuthError,
    );
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'user_login');
    assert.equal(auditMock.mock.calls[0].arguments[1].userId, null);
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.result, 'failure');
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.reason, 'unknown_user');
  });

  await t.test('audits a failed login for a wrong password, with the real userId', async () => {
    const getUserMock = t.mock.method(authRepository, 'getUserByUsername', async () => ({ id: 'u1', college_id: 'c1', password_hash: 'hash', is_active: true }));
    const verifyMock = t.mock.method(security, 'verifyPassword', async () => false);
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      getUserMock.mock.restore();
      verifyMock.mock.restore();
      auditMock.mock.restore();
    });

    await assert.rejects(
      () => authService.login({}, { collegeId: 'c1', username: 'realuser', password: 'wrong' }),
      authService.AuthError,
    );
    assert.equal(auditMock.mock.calls[0].arguments[1].userId, 'u1');
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.reason, 'bad_password');
  });

  await t.test('audits a failed login for an inactive account', async () => {
    const getUserMock = t.mock.method(authRepository, 'getUserByUsername', async () => ({ id: 'u1', college_id: 'c1', password_hash: 'hash', is_active: false }));
    const verifyMock = t.mock.method(security, 'verifyPassword', async () => true);
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      getUserMock.mock.restore();
      verifyMock.mock.restore();
      auditMock.mock.restore();
    });

    await assert.rejects(
      () => authService.login({}, { collegeId: 'c1', username: 'inactiveuser', password: 'x' }),
      authService.AuthError,
    );
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.reason, 'inactive_account');
  });

  await t.test('audits a successful login', async () => {
    const getUserMock = t.mock.method(authRepository, 'getUserByUsername', async () => ({
      id: 'u1', college_id: 'c1', role: 'staff', password_hash: 'hash', is_active: true,
    }));
    const verifyMock = t.mock.method(security, 'verifyPassword', async () => true);
    const needsRehashMock = t.mock.method(security, 'needsRehash', async () => false);
    const createRefreshTokenMock = t.mock.method(authRepository, 'createRefreshToken', async () => {});
    // No 'auth' configuration row for this college — task #19's own
    // "unset means disabled, no MFA gate" default (see
    // authService.DEFAULT_AUTH_CONFIG's comment).
    const authConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      getUserMock.mock.restore();
      verifyMock.mock.restore();
      needsRehashMock.mock.restore();
      createRefreshTokenMock.mock.restore();
      authConfigMock.mock.restore();
      auditMock.mock.restore();
    });

    await authService.login({}, { collegeId: 'c1', username: 'realuser', password: 'correct' });
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'user_login');
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.result, 'success');
    assert.equal(auditMock.mock.calls[0].arguments[1].userId, 'u1');
  });
});

test('refresh audit logging', async (t) => {
  await t.test('audits refresh_token_reuse_detected when an already-revoked token is presented', async () => {
    const getTokenMock = t.mock.method(authRepository, 'getRefreshTokenByHash', async () => ({
      id: 'rt-1', college_id: 'c1', user_id: 'u1', revoked_at: '2026-01-01T00:00:00Z',
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      getTokenMock.mock.restore();
      auditMock.mock.restore();
    });

    await assert.rejects(
      () => authService.refresh({}, 'some-token'),
      authService.RefreshTokenReuseError,
    );
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'refresh_token_reuse_detected');
    assert.equal(auditMock.mock.calls[0].arguments[1].userId, 'u1');
  });
});

test('revoke (logout) audit logging', async (t) => {
  await t.test('audits user_logout when an active token is actually revoked', async () => {
    const getTokenMock = t.mock.method(authRepository, 'getRefreshTokenByHash', async () => ({
      id: 'rt-1', college_id: 'c1', user_id: 'u1', revoked_at: null,
    }));
    const revokeMock = t.mock.method(authRepository, 'revokeRefreshToken', async () => {});
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      getTokenMock.mock.restore();
      revokeMock.mock.restore();
      auditMock.mock.restore();
    });

    await authService.revoke({}, 'some-token');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'user_logout');
    assert.equal(auditMock.mock.calls[0].arguments[1].userId, 'u1');
  });

  await t.test('does not audit-log the idempotent no-op for an unknown/already-revoked token', async () => {
    const getTokenMock = t.mock.method(authRepository, 'getRefreshTokenByHash', async () => null);
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      getTokenMock.mock.restore();
      auditMock.mock.restore();
    });

    await authService.revoke({}, 'unknown-token');
    assert.equal(auditMock.mock.callCount(), 0);
  });
});
