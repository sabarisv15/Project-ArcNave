'use strict';

// Unit tests for positionAccountAuthService (Phase 2 step 3) — no live
// Postgres: positionRepository/auditLogRepository are stubbed via
// node:test's built-in mock, same technique auth-service.test.js
// already uses for authService. login/refresh/revoke have no route
// wired yet (that's step 7), so this is the only coverage for now.

const test = require('node:test');
const assert = require('node:assert/strict');
const positionRepository = require('../src/repositories/positionRepository');
const positionAccountMfaOtpRepository = require('../src/repositories/positionAccountMfaOtpRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const authService = require('../src/services/authService');
const notificationService = require('../src/services/notificationService');
const security = require('../src/security');
const positionAccountAuthService = require('../src/services/positionAccountAuthService');

function mockAudit(t) {
  const mock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
  t.after(() => mock.mock.restore());
  return mock;
}

// Stage 8e / D17: login() now checks the institution's 'auth' config
// (authService.getAuthConfig) to decide whether to gate into MFA — the
// disabled default (no MFA) is what every pre-existing test here
// expects, same as document-service.test.js's own getConfiguration mock.
function mockAuthConfigDisabled(t) {
  const mock = t.mock.method(authService, 'getAuthConfig', async () => ({ mfaMode: 'disabled', mfaRoles: null }));
  t.after(() => mock.mock.restore());
  return mock;
}

test('positionAccountAuthService.login (no DB)', async (t) => {
  await t.test('unknown official_email fails with the generic PositionAuthError and is audited', async () => {
    const findMock = t.mock.method(positionRepository, 'findPositionAccountByOfficialEmail', async () => null);
    const auditMock = mockAudit(t);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () =>
        positionAccountAuthService.login({}, { collegeId: 'c1', officialEmail: 'nobody@example.edu', password: 'x' }),
      positionAccountAuthService.PositionAuthError,
    );
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.reason, 'unknown_official_email');
  });

  await t.test('wrong password fails with the same generic error', async () => {
    const passwordHash = await security.hashPassword('correct-horse');
    const findMock = t.mock.method(positionRepository, 'findPositionAccountByOfficialEmail', async () => ({
      id: 'acct-1',
      position_id: 'pos-1',
      college_id: 'c1',
      password_hash: passwordHash,
      token_version: 0,
    }));
    const auditMock = mockAudit(t);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () =>
        positionAccountAuthService.login({}, { collegeId: 'c1', officialEmail: 'hod@example.edu', password: 'wrong' }),
      positionAccountAuthService.PositionAuthError,
    );
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.reason, 'bad_password');
  });

  await t.test('a position at a not-yet-login-eligible level/type fails, even with the right password', async () => {
    const passwordHash = await security.hashPassword('correct-horse');
    const findMock = t.mock.method(positionRepository, 'findPositionAccountByOfficialEmail', async () => ({
      id: 'acct-1',
      position_id: 'pos-1',
      college_id: 'c1',
      password_hash: passwordHash,
      token_version: 0,
    }));
    const positionMock = t.mock.method(positionRepository, 'findPositionById', async () => ({
      id: 'pos-1',
      level: 4,
      position_type: null,
    }));
    const auditMock = mockAudit(t);
    t.after(() => {
      findMock.mock.restore();
      positionMock.mock.restore();
    });

    await assert.rejects(
      () =>
        positionAccountAuthService.login(
          {},
          { collegeId: 'c1', officialEmail: 'staff@example.edu', password: 'correct-horse' },
        ),
      positionAccountAuthService.PositionAuthError,
    );
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.reason, 'position_not_login_eligible');
  });

  await t.test('a level 4 position_type=class_tutor position IS login-eligible', async () => {
    const passwordHash = await security.hashPassword('correct-horse');
    const findMock = t.mock.method(positionRepository, 'findPositionAccountByOfficialEmail', async () => ({
      id: 'acct-1',
      position_id: 'pos-1',
      college_id: 'c1',
      password_hash: passwordHash,
      token_version: 0,
    }));
    const positionMock = t.mock.method(positionRepository, 'findPositionById', async () => ({
      id: 'pos-1',
      level: 4,
      position_type: 'class_tutor',
    }));
    const createTokenMock = t.mock.method(positionRepository, 'createPositionAccountRefreshToken', async () => {});
    mockAudit(t);
    mockAuthConfigDisabled(t);
    t.after(() => {
      findMock.mock.restore();
      positionMock.mock.restore();
      createTokenMock.mock.restore();
    });

    const result = await positionAccountAuthService.login(
      {},
      { collegeId: 'c1', officialEmail: 'tutor@example.edu', password: 'correct-horse' },
    );
    assert.equal(typeof result.accessToken, 'string');
    assert.equal(typeof result.refreshToken, 'string');
  });

  await t.test('correct credentials for an eligible position issue a token pair and audit success', async () => {
    const passwordHash = await security.hashPassword('correct-horse');
    const findMock = t.mock.method(positionRepository, 'findPositionAccountByOfficialEmail', async () => ({
      id: 'acct-1',
      position_id: 'pos-1',
      college_id: 'c1',
      password_hash: passwordHash,
      token_version: 3,
    }));
    const positionMock = t.mock.method(positionRepository, 'findPositionById', async () => ({
      id: 'pos-1',
      level: 3,
      position_type: null,
    }));
    const createTokenMock = t.mock.method(positionRepository, 'createPositionAccountRefreshToken', async () => {});
    const auditMock = mockAudit(t);
    mockAuthConfigDisabled(t);
    t.after(() => {
      findMock.mock.restore();
      positionMock.mock.restore();
      createTokenMock.mock.restore();
    });

    const result = await positionAccountAuthService.login(
      {},
      { collegeId: 'c1', officialEmail: 'hod@example.edu', password: 'correct-horse' },
    );

    assert.equal(typeof result.accessToken, 'string');
    assert.equal(typeof result.refreshToken, 'string');
    assert.equal(result.tokenType, 'bearer');
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.result, 'success');

    const claims = security.decodeAccessToken(result.accessToken);
    assert.equal(claims.sub, 'acct-1');
    assert.equal(claims.type, 'position_access');
    assert.equal(claims.token_version, 3);
    assert.equal(claims.role, undefined);
  });

  // Stage 8e / D17 (RS-TEN-008)
  await t.test(
    'mandatory institution MFA gates a Position Account login into a challenge, not a token pair',
    async () => {
      const passwordHash = await security.hashPassword('correct-horse');
      const findMock = t.mock.method(positionRepository, 'findPositionAccountByOfficialEmail', async () => ({
        id: 'acct-1',
        position_id: 'pos-1',
        college_id: 'c1',
        password_hash: passwordHash,
        token_version: 0,
        official_email: 'hod@example.edu',
        mfa_enabled: false,
      }));
      const positionMock = t.mock.method(positionRepository, 'findPositionById', async () => ({
        id: 'pos-1',
        level: 3,
        position_type: null,
      }));
      const authConfigMock = t.mock.method(authService, 'getAuthConfig', async () => ({
        mfaMode: 'mandatory',
        mfaRoles: null,
      }));
      const otpCreateMock = t.mock.method(positionAccountMfaOtpRepository, 'create', async () => ({
        id: 'challenge-1',
      }));
      const emailMock = t.mock.method(notificationService, 'sendMfaCodeEmail', async () => ({ status: 'sent' }));
      const createTokenMock = t.mock.method(positionRepository, 'createPositionAccountRefreshToken', async () => {
        throw new Error('must not issue a token pair while MFA is pending');
      });
      mockAudit(t);
      t.after(() => {
        findMock.mock.restore();
        positionMock.mock.restore();
        authConfigMock.mock.restore();
        otpCreateMock.mock.restore();
        emailMock.mock.restore();
        createTokenMock.mock.restore();
      });

      const result = await positionAccountAuthService.login(
        {},
        { collegeId: 'c1', officialEmail: 'hod@example.edu', password: 'correct-horse' },
      );
      assert.equal(result.mfaRequired, true);
      assert.equal(result.accessToken, undefined);
    },
  );

  await t.test('mfaRoles scoping: a role not in scope skips MFA even under mandatory mode', async () => {
    const passwordHash = await security.hashPassword('correct-horse');
    const findMock = t.mock.method(positionRepository, 'findPositionAccountByOfficialEmail', async () => ({
      id: 'acct-1',
      position_id: 'pos-1',
      college_id: 'c1',
      password_hash: passwordHash,
      token_version: 0,
      official_email: 'hod@example.edu',
      mfa_enabled: false,
    }));
    const positionMock = t.mock.method(positionRepository, 'findPositionById', async () => ({
      id: 'pos-1',
      level: 3,
      position_type: null,
    }));
    const authConfigMock = t.mock.method(authService, 'getAuthConfig', async () => ({
      mfaMode: 'mandatory',
      mfaRoles: ['principal'],
    }));
    const createTokenMock = t.mock.method(positionRepository, 'createPositionAccountRefreshToken', async () => {});
    mockAudit(t);
    t.after(() => {
      findMock.mock.restore();
      positionMock.mock.restore();
      authConfigMock.mock.restore();
      createTokenMock.mock.restore();
    });

    const result = await positionAccountAuthService.login(
      {},
      { collegeId: 'c1', officialEmail: 'hod@example.edu', password: 'correct-horse' },
    );
    assert.equal(typeof result.accessToken, 'string');
  });
});

test('positionAccountAuthService.verifyPositionMfaLogin (no DB)', async (t) => {
  function mockLiveChallenge(t, overrides = {}) {
    const challenge = {
      id: 'challenge-1',
      position_account_id: 'acct-1',
      code_hash: hashCode('123456'),
      attempts: 0,
      consumed_at: null,
      expires_at: new Date(Date.now() + 60000),
      ...overrides,
    };
    const findMock = t.mock.method(positionAccountMfaOtpRepository, 'findById', async () => challenge);
    const consumeMock = t.mock.method(positionAccountMfaOtpRepository, 'markConsumed', async () => {});
    t.after(() => {
      findMock.mock.restore();
      consumeMock.mock.restore();
    });
  }

  function hashCode(code) {
    return require('crypto').createHash('sha256').update(code).digest('hex');
  }

  await t.test('re-checks position eligibility at verify time, not just at challenge-issue time', async () => {
    mockLiveChallenge(t);
    const findAccountMock = t.mock.method(positionRepository, 'findPositionAccountById', async () => ({
      id: 'acct-1',
      college_id: 'c1',
      position_id: 'pos-1',
      token_version: 0,
    }));
    // The position was reassigned/demoted to a non-eligible shape between
    // challenge-issue and this call — must be rejected, not silently
    // trusted from whatever eligibility check ran at issue time.
    const findPositionMock = t.mock.method(positionRepository, 'findPositionById', async () => ({
      id: 'pos-1',
      level: 4,
      position_type: null,
    }));
    mockAudit(t);
    t.after(() => {
      findAccountMock.mock.restore();
      findPositionMock.mock.restore();
    });

    await assert.rejects(
      () => positionAccountAuthService.verifyPositionMfaLogin({}, { challengeId: 'challenge-1', code: '123456' }),
      positionAccountAuthService.PositionAuthError,
    );
  });

  await t.test('issues a token pair when the position is still eligible', async () => {
    mockLiveChallenge(t);
    const findAccountMock = t.mock.method(positionRepository, 'findPositionAccountById', async () => ({
      id: 'acct-1',
      college_id: 'c1',
      position_id: 'pos-1',
      token_version: 0,
    }));
    const findPositionMock = t.mock.method(positionRepository, 'findPositionById', async () => ({
      id: 'pos-1',
      level: 3,
      position_type: null,
    }));
    const createTokenMock = t.mock.method(positionRepository, 'createPositionAccountRefreshToken', async () => {});
    mockAudit(t);
    t.after(() => {
      findAccountMock.mock.restore();
      findPositionMock.mock.restore();
      createTokenMock.mock.restore();
    });

    const result = await positionAccountAuthService.verifyPositionMfaLogin(
      {},
      { challengeId: 'challenge-1', code: '123456' },
    );
    assert.equal(typeof result.accessToken, 'string');
  });
});

test('positionAccountAuthService MFA enrollment (no DB)', async (t) => {
  await t.test('enablePositionMfa/disablePositionMfa flip the flag and audit the action', async () => {
    const setMock = t.mock.method(positionRepository, 'setPositionAccountMfaEnabled', async (client, id, enabled) => ({
      id,
      college_id: 'c1',
      position_id: 'pos-1',
      mfa_enabled: enabled,
    }));
    const auditMock = mockAudit(t);
    t.after(() => setMock.mock.restore());

    const enabled = await positionAccountAuthService.enablePositionMfa({}, 'acct-1');
    assert.equal(enabled.mfa_enabled, true);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'position_account_mfa_enabled');

    const disabled = await positionAccountAuthService.disablePositionMfa({}, 'acct-1');
    assert.equal(disabled.mfa_enabled, false);
    assert.equal(auditMock.mock.calls[1].arguments[1].action, 'position_account_mfa_disabled');
  });

  await t.test('enablePositionMfa on an unknown positionAccountId throws PositionAuthError', async () => {
    const setMock = t.mock.method(positionRepository, 'setPositionAccountMfaEnabled', async () => null);
    t.after(() => setMock.mock.restore());

    await assert.rejects(
      () => positionAccountAuthService.enablePositionMfa({}, 'missing'),
      positionAccountAuthService.PositionAuthError,
    );
  });
});

test('positionAccountAuthService.refresh (no DB)', async (t) => {
  await t.test('unknown refresh token fails', async () => {
    const findMock = t.mock.method(positionRepository, 'getPositionAccountRefreshTokenByHash', async () => null);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => positionAccountAuthService.refresh({}, 'bogus-token'),
      positionAccountAuthService.PositionAuthError,
    );
  });

  await t.test('a revoked refresh token raises PositionRefreshTokenReuseError, not the generic error', async () => {
    const findMock = t.mock.method(positionRepository, 'getPositionAccountRefreshTokenByHash', async () => ({
      id: 'rt-1',
      college_id: 'c1',
      position_account_id: 'acct-1',
      revoked_at: new Date(),
      expires_at: new Date(Date.now() + 10000),
    }));
    mockAudit(t);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => positionAccountAuthService.refresh({}, 'reused-token'),
      positionAccountAuthService.PositionRefreshTokenReuseError,
    );
  });

  await t.test('an expired refresh token fails with the generic error', async () => {
    const findMock = t.mock.method(positionRepository, 'getPositionAccountRefreshTokenByHash', async () => ({
      id: 'rt-1',
      college_id: 'c1',
      position_account_id: 'acct-1',
      revoked_at: null,
      expires_at: new Date(Date.now() - 1000),
    }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => positionAccountAuthService.refresh({}, 'expired-token'),
      positionAccountAuthService.PositionAuthError,
    );
  });

  await t.test('a live token rotates: old one revoked, a fresh pair issued', async () => {
    const findMock = t.mock.method(positionRepository, 'getPositionAccountRefreshTokenByHash', async () => ({
      id: 'rt-1',
      college_id: 'c1',
      position_account_id: 'acct-1',
      revoked_at: null,
      expires_at: new Date(Date.now() + 10000),
    }));
    const accountMock = t.mock.method(positionRepository, 'findPositionAccountById', async () => ({
      id: 'acct-1',
      college_id: 'c1',
      token_version: 1,
    }));
    const revokeMock = t.mock.method(positionRepository, 'revokePositionAccountRefreshToken', async () => {});
    const createTokenMock = t.mock.method(positionRepository, 'createPositionAccountRefreshToken', async () => {});
    t.after(() => {
      findMock.mock.restore();
      accountMock.mock.restore();
      revokeMock.mock.restore();
      createTokenMock.mock.restore();
    });

    const result = await positionAccountAuthService.refresh({}, 'live-token');

    assert.equal(revokeMock.mock.calls[0].arguments[1], 'rt-1');
    assert.equal(typeof result.accessToken, 'string');
    assert.equal(typeof result.refreshToken, 'string');
  });
});

test('positionAccountAuthService.revoke (no DB)', async (t) => {
  await t.test('an unknown token is a silent no-op', async () => {
    const findMock = t.mock.method(positionRepository, 'getPositionAccountRefreshTokenByHash', async () => null);
    const revokeMock = t.mock.method(positionRepository, 'revokePositionAccountRefreshToken', async () => {});
    t.after(() => {
      findMock.mock.restore();
      revokeMock.mock.restore();
    });

    await positionAccountAuthService.revoke({}, 'bogus-token');
    assert.equal(revokeMock.mock.callCount(), 0);
  });

  await t.test('an active token is revoked and audited', async () => {
    const findMock = t.mock.method(positionRepository, 'getPositionAccountRefreshTokenByHash', async () => ({
      id: 'rt-1',
      college_id: 'c1',
      position_account_id: 'acct-1',
      revoked_at: null,
    }));
    const revokeMock = t.mock.method(positionRepository, 'revokePositionAccountRefreshToken', async () => {});
    const auditMock = mockAudit(t);
    t.after(() => {
      findMock.mock.restore();
      revokeMock.mock.restore();
    });

    await positionAccountAuthService.revoke({}, 'live-token');
    assert.equal(revokeMock.mock.calls[0].arguments[1], 'rt-1');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'position_account_logout');
  });
});
