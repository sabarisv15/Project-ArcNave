'use strict';

// Unit tests for PlatformService's pure business-logic paths — no live
// Postgres: platformRepository/principalInvitationRepository/
// notificationService are stubbed via node:test's built-in mock, same
// technique every other *-service.test.js file in this codebase uses.
//
// What's deliberately NOT here: an actual platform_admins row reaching
// bootstrapPlatformAdmin's real WHERE NOT EXISTS guard, or a real
// principal_invitations row reaching resendInvitation/revokeInvitation's
// own WHERE guards, through a live Postgres constraint. Those are the
// real DB-level backstops this file's mocks stand in for; live
// verification is this session's own end-of-task full-suite/docker run,
// not a committed test here, matching this codebase's other
// first-slice precedent (e.g. staff-service.test.js's own header
// comment).

const test = require('node:test');
const assert = require('node:assert/strict');
const platformRepository = require('../src/repositories/platformRepository');
const principalInvitationRepository = require('../src/repositories/principalInvitationRepository');
const notificationService = require('../src/services/notificationService');
const security = require('../src/security');
const platformService = require('../src/services/platformService');
const departmentRepository = require('../src/repositories/departmentRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const platformAuditService = require('../src/services/platformAuditService');
const academicService = require('../src/services/academicService');

test('PlatformService.bootstrapPlatformAdmin (no DB)', async (t) => {
  await t.test('rejects a missing username/email/password without touching the DB', async () => {
    const bootstrapMock = t.mock.method(platformRepository, 'bootstrapPlatformAdmin');
    t.after(() => bootstrapMock.mock.restore());

    await assert.rejects(
      () => platformService.bootstrapPlatformAdmin({}, { username: 'admin', email: 'a@b.com', password: undefined }),
      platformService.PlatformAdminValidationError,
    );
    assert.equal(bootstrapMock.mock.callCount(), 0);
  });

  await t.test('rejects a password shorter than the minimum length without touching the DB', async () => {
    const bootstrapMock = t.mock.method(platformRepository, 'bootstrapPlatformAdmin');
    t.after(() => bootstrapMock.mock.restore());

    await assert.rejects(
      () => platformService.bootstrapPlatformAdmin({}, { username: 'admin', email: 'a@b.com', password: 'short' }),
      platformService.PlatformAdminValidationError,
    );
    assert.equal(bootstrapMock.mock.callCount(), 0);
  });

  await t.test('hashes the password before storing it — never the raw password', async () => {
    const bootstrapMock = t.mock.method(platformRepository, 'bootstrapPlatformAdmin', async (client, fields) => ({
      id: 'admin-1', username: fields.username, email: fields.email,
    }));
    t.after(() => bootstrapMock.mock.restore());

    const result = await platformService.bootstrapPlatformAdmin({}, {
      username: 'admin', email: 'admin@example.com', password: 'a-real-password-123',
    });

    assert.equal(result.username, 'admin');
    const passedFields = bootstrapMock.mock.calls[0].arguments[1];
    assert.notEqual(passedFields.passwordHash, 'a-real-password-123');
    assert.ok(await security.verifyPassword('a-real-password-123', passedFields.passwordHash));
  });

  await t.test('throws PlatformAlreadyBootstrappedError when the repository reports zero rows (a platform admin already exists)', async () => {
    const bootstrapMock = t.mock.method(platformRepository, 'bootstrapPlatformAdmin', async () => null);
    t.after(() => bootstrapMock.mock.restore());

    await assert.rejects(
      () => platformService.bootstrapPlatformAdmin({}, { username: 'admin2', email: 'b@b.com', password: 'a-real-password-123' }),
      platformService.PlatformAlreadyBootstrappedError,
    );
  });
});

// This session's own task: an invitation token must never be returned
// in an API response, only delivered via the existing notification
// flow.
test('PlatformService.invitePrincipal (no DB)', async (t) => {
  await t.test('never returns a token field, and emails the raw token instead', async () => {
    const createMock = t.mock.method(principalInvitationRepository, 'createInvitation', async (pool, fields) => ({
      id: 'inv-1', college_id: fields.collegeId, email: fields.email, expires_at: new Date('2026-01-01T00:00:00Z'),
    }));
    const emailMock = t.mock.method(notificationService, 'sendPrincipalInvitationEmail', async () => ({ status: 'stubbed' }));
    t.after(() => {
      createMock.mock.restore();
      emailMock.mock.restore();
    });

    const result = await platformService.invitePrincipal({}, { collegeId: 'demo-college', email: 'p@example.com', createdBy: 'admin-1' });

    assert.equal('token' in result, false);
    assert.equal(emailMock.mock.callCount(), 1);
    assert.equal(emailMock.mock.calls[0].arguments[1].to, 'p@example.com');
    assert.equal(typeof emailMock.mock.calls[0].arguments[1].token, 'string');
    assert.ok(emailMock.mock.calls[0].arguments[1].token.length > 0);
  });

  await t.test('maps a foreign_key_violation to CollegeNotFoundError', async () => {
    const createMock = t.mock.method(principalInvitationRepository, 'createInvitation', async () => {
      const err = new Error('insert or update on table "principal_invitations" violates foreign key constraint');
      err.code = '23503';
      throw err;
    });
    const emailMock = t.mock.method(notificationService, 'sendPrincipalInvitationEmail');
    t.after(() => {
      createMock.mock.restore();
      emailMock.mock.restore();
    });

    await assert.rejects(
      () => platformService.invitePrincipal({}, { collegeId: 'missing-college', email: 'p@example.com', createdBy: 'admin-1' }),
      platformService.CollegeNotFoundError,
    );
    assert.equal(emailMock.mock.callCount(), 0);
  });
});

test('PlatformService.resendPrincipalInvitation / revokePrincipalInvitation (no DB)', async (t) => {
  await t.test('resend throws PrincipalInvitationNotFoundError for an unknown id', async () => {
    const getMock = t.mock.method(principalInvitationRepository, 'getInvitationById', async () => null);
    t.after(() => getMock.mock.restore());

    await assert.rejects(
      () => platformService.resendPrincipalInvitation({}, 'missing-id'),
      platformService.PrincipalInvitationNotFoundError,
    );
  });

  await t.test('resend throws PrincipalInvitationNotPendingError for an already-accepted invitation', async () => {
    const getMock = t.mock.method(principalInvitationRepository, 'getInvitationById', async () => ({
      id: 'inv-1', college_id: 'c1', email: 'p@example.com', accepted_at: new Date(), revoked_at: null,
    }));
    t.after(() => getMock.mock.restore());

    await assert.rejects(
      () => platformService.resendPrincipalInvitation({}, 'inv-1'),
      platformService.PrincipalInvitationNotPendingError,
    );
  });

  await t.test('resend on an already-revoked invitation revives it (does NOT throw)', async () => {
    const getMock = t.mock.method(principalInvitationRepository, 'getInvitationById', async () => ({
      id: 'inv-1', college_id: 'c1', email: 'p@example.com', accepted_at: null, revoked_at: new Date(),
    }));
    const resendMock = t.mock.method(principalInvitationRepository, 'resendInvitation', async (pool, id, fields) => ({
      id, college_id: 'c1', email: 'p@example.com', expires_at: new Date('2026-02-01T00:00:00Z'), token_hash: fields.tokenHash,
    }));
    const emailMock = t.mock.method(notificationService, 'sendPrincipalInvitationEmail', async () => ({ status: 'stubbed' }));
    t.after(() => {
      getMock.mock.restore();
      resendMock.mock.restore();
      emailMock.mock.restore();
    });

    const result = await platformService.resendPrincipalInvitation({}, 'inv-1');
    assert.equal(result.invitationId, 'inv-1');
    assert.equal(emailMock.mock.callCount(), 1);
  });

  await t.test('resend on a pending invitation rotates the token and emails it, no token in the return value', async () => {
    const getMock = t.mock.method(principalInvitationRepository, 'getInvitationById', async () => ({
      id: 'inv-1', college_id: 'c1', email: 'p@example.com', accepted_at: null, revoked_at: null,
    }));
    const resendMock = t.mock.method(principalInvitationRepository, 'resendInvitation', async (pool, id, fields) => ({
      id, college_id: 'c1', email: 'p@example.com', expires_at: new Date('2026-02-01T00:00:00Z'), token_hash: fields.tokenHash,
    }));
    const emailMock = t.mock.method(notificationService, 'sendPrincipalInvitationEmail', async () => ({ status: 'stubbed' }));
    t.after(() => {
      getMock.mock.restore();
      resendMock.mock.restore();
      emailMock.mock.restore();
    });

    const result = await platformService.resendPrincipalInvitation({}, 'inv-1');

    assert.equal('token' in result, false);
    assert.equal(emailMock.mock.callCount(), 1);
    assert.equal(emailMock.mock.calls[0].arguments[1].to, 'p@example.com');
    // The freshly rotated raw token emailed must hash to what was
    // persisted — same discipline invitePrincipal already follows.
    const emailedToken = emailMock.mock.calls[0].arguments[1].token;
    const security2 = require('../src/security');
    assert.equal(resendMock.mock.calls[0].arguments[2].tokenHash, security2.hashRefreshToken(emailedToken));
  });

  await t.test('revoke throws PrincipalInvitationNotFoundError for an unknown id', async () => {
    const getMock = t.mock.method(principalInvitationRepository, 'getInvitationById', async () => null);
    t.after(() => getMock.mock.restore());

    await assert.rejects(
      () => platformService.revokePrincipalInvitation({}, 'missing-id'),
      platformService.PrincipalInvitationNotFoundError,
    );
  });

  await t.test('revoke on a pending invitation succeeds and sends no email', async () => {
    const getMock = t.mock.method(principalInvitationRepository, 'getInvitationById', async () => ({
      id: 'inv-1', college_id: 'c1', email: 'p@example.com', accepted_at: null, revoked_at: null,
    }));
    const revokeMock = t.mock.method(principalInvitationRepository, 'revokeInvitation', async (pool, id) => ({
      id, college_id: 'c1', email: 'p@example.com', revoked_at: new Date('2026-02-01T00:00:00Z'),
    }));
    const emailMock = t.mock.method(notificationService, 'sendPrincipalInvitationEmail');
    t.after(() => {
      getMock.mock.restore();
      revokeMock.mock.restore();
      emailMock.mock.restore();
    });

    const result = await platformService.revokePrincipalInvitation({}, 'inv-1');

    assert.ok(result.revokedAt);
    assert.equal(emailMock.mock.callCount(), 0);
  });
});

// RS-CLS-001/RS-CLS-002: onboarding-time department creation must
// require the same courseDuration/defaultSections
// collegeProfileService.createDepartment enforces for L1's own
// post-onboarding path, and must trigger the same class generation —
// see department-class-generation.test.js for the real end-to-end
// (live Postgres) proof; this file stays consistent with its own
// no-live-DB, mocked-repository convention for the validation paths.
test('PlatformService.createDepartmentAtOnboarding (no DB)', async (t) => {
  const PROVISIONING_COLLEGE = { college_id: 'c1', provisioning_status: 'provisioning' };

  await t.test('rejects a missing courseDuration before touching departmentRepository', async () => {
    const findCollegeMock = t.mock.method(platformRepository, 'findCollegeById', async () => PROVISIONING_COLLEGE);
    const createMock = t.mock.method(departmentRepository, 'create', async () => { throw new Error('must not be called'); });
    t.after(() => {
      findCollegeMock.mock.restore();
      createMock.mock.restore();
    });

    await assert.rejects(
      () => platformService.createDepartmentAtOnboarding({}, {}, {
        collegeId: 'c1', name: 'ECE', defaultSections: 2,
      }, { actorAdminId: 'admin-1' }),
      academicService.ClassGenerationValidationError,
    );
  });

  await t.test('rejects a missing defaultSections before touching departmentRepository', async () => {
    const findCollegeMock = t.mock.method(platformRepository, 'findCollegeById', async () => PROVISIONING_COLLEGE);
    const createMock = t.mock.method(departmentRepository, 'create', async () => { throw new Error('must not be called'); });
    t.after(() => {
      findCollegeMock.mock.restore();
      createMock.mock.restore();
    });

    await assert.rejects(
      () => platformService.createDepartmentAtOnboarding({}, {}, {
        collegeId: 'c1', name: 'ECE', courseDuration: 4,
      }, { actorAdminId: 'admin-1' }),
      academicService.ClassGenerationValidationError,
    );
  });

  await t.test('creates the department and generates its classes when both are supplied', async () => {
    const findCollegeMock = t.mock.method(platformRepository, 'findCollegeById', async () => PROVISIONING_COLLEGE);
    const createMock = t.mock.method(
      departmentRepository, 'create',
      async (client, fields) => ({ id: 'dept-1', college_id: fields.collegeId, name: fields.name }),
    );
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    const platformAuditMock = t.mock.method(platformAuditService, 'record', async () => {});
    const generateMock = t.mock.method(
      academicService, 'generateClassesForDepartment',
      async () => [{ id: 'cls-1' }, { id: 'cls-2' }],
    );
    t.after(() => {
      findCollegeMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
      platformAuditMock.mock.restore();
      generateMock.mock.restore();
    });

    const result = await platformService.createDepartmentAtOnboarding({}, {}, {
      collegeId: 'c1', name: 'ECE', courseDuration: 4, defaultSections: 2,
    }, { actorAdminId: 'admin-1', ipAddress: '127.0.0.1' });

    assert.equal(result.id, 'dept-1');
    assert.equal(result.generatedClasses.length, 2);
    assert.equal(generateMock.mock.calls[0].arguments[1].departmentId, 'dept-1');
    assert.equal(generateMock.mock.calls[0].arguments[1].courseDuration, 4);
    assert.equal(generateMock.mock.calls[0].arguments[1].defaultSections, 2);
  });

  await t.test('rejects onboarding department creation once the college has left provisioning', async () => {
    const findCollegeMock = t.mock.method(platformRepository, 'findCollegeById', async () => ({ college_id: 'c1', provisioning_status: 'ready' }));
    t.after(() => findCollegeMock.mock.restore());

    await assert.rejects(
      () => platformService.createDepartmentAtOnboarding({}, {}, {
        collegeId: 'c1', name: 'ECE', courseDuration: 4, defaultSections: 2,
      }, { actorAdminId: 'admin-1' }),
      platformService.OnboardingDepartmentNotAllowedError,
    );
  });
});
