'use strict';

// Unit tests for staffService's RS-STF-001/002 (D10) invite-first
// mechanism — no live Postgres needed, same stubbing technique as
// staff-lifecycle-service.test.js/academic-year-service.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const staffRepository = require('../src/repositories/staffRepository');
const staffInvitationRepository = require('../src/repositories/staffInvitationRepository');
const authRepository = require('../src/repositories/authRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const notificationService = require('../src/services/notificationService');
const hodInChargeRepository = require('../src/repositories/hodInChargeRepository');
const workflowService = require('../src/services/workflowService');
const workflowChainService = require('../src/services/workflowChainService');
const staffService = require('../src/services/staffService');

test('inviteStaff', async (t) => {
  await t.test('rejects a missing email', async () => {
    await assert.rejects(
      () => staffService.inviteStaff({}, {}, { actorUserId: 'u1', collegeId: 'c1' }),
      staffService.StaffInvitationValidationError,
    );
  });

  await t.test('rejects an actor who is not a real hod of any department', async () => {
    const findByUserIdMock = t.mock.method(staffRepository, 'findByUserId', async () => null);
    t.after(() => findByUserIdMock.mock.restore());

    await assert.rejects(
      () => staffService.inviteStaff({}, { email: 'new@example.com' }, { actorUserId: 'u1', collegeId: 'c1' }),
      staffService.StaffInvitationNotAuthorizedError,
    );
  });

  await t.test('auto-derives departmentId from the real hod actor, creates the invitation, and sends the email', async () => {
    const findByUserIdMock = t.mock.method(staffRepository, 'findByUserId', async () => ({ id: 'staff-hod', department_id: 'dept-1' }));
    const findHodMock = t.mock.method(staffRepository, 'findByCollegeDepartmentAndRole', async () => ({ id: 'staff-hod', user_id: 'hod-1' }));
    const createInvitationMock = t.mock.method(staffInvitationRepository, 'createInvitation', async (client, fields) => ({
      id: 'inv-1', college_id: fields.collegeId, department_id: fields.departmentId, email: fields.email, expires_at: new Date(),
    }));
    const sendEmailMock = t.mock.method(notificationService, 'sendStaffInvitationEmail', async () => {});
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findByUserIdMock.mock.restore();
      findHodMock.mock.restore();
      createInvitationMock.mock.restore();
      sendEmailMock.mock.restore();
      auditMock.mock.restore();
    });

    const invitation = await staffService.inviteStaff({}, { email: 'new@example.com' }, { actorUserId: 'hod-1', collegeId: 'c1' });
    assert.equal(invitation.department_id, 'dept-1');
    assert.equal(createInvitationMock.mock.calls[0].arguments[1].departmentId, 'dept-1');
    assert.equal(sendEmailMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'staff_invited');
  });
});

test('lookupPendingStaffInvitation', async (t) => {
  await t.test('rejects an unknown token', async () => {
    const findMock = t.mock.method(staffInvitationRepository, 'getInvitationByTokenHash', async () => null);
    t.after(() => findMock.mock.restore());
    await assert.rejects(
      () => staffService.lookupPendingStaffInvitation({}, 'bad-token'),
      staffService.StaffInvitationInvalidError,
    );
  });

  await t.test('rejects an already-accepted invitation', async () => {
    const findMock = t.mock.method(staffInvitationRepository, 'getInvitationByTokenHash', async () => ({
      id: 'inv-1', college_id: 'c1', accepted_at: new Date(), expires_at: new Date(Date.now() + 100000),
    }));
    t.after(() => findMock.mock.restore());
    await assert.rejects(
      () => staffService.lookupPendingStaffInvitation({}, 'token'),
      staffService.StaffInvitationInvalidError,
    );
  });

  await t.test('rejects an expired invitation', async () => {
    const findMock = t.mock.method(staffInvitationRepository, 'getInvitationByTokenHash', async () => ({
      id: 'inv-1', college_id: 'c1', accepted_at: null, expires_at: new Date(Date.now() - 1000),
    }));
    t.after(() => findMock.mock.restore());
    await assert.rejects(
      () => staffService.lookupPendingStaffInvitation({}, 'token'),
      staffService.StaffInvitationInvalidError,
    );
  });

  await t.test('returns a still-pending invitation', async () => {
    const findMock = t.mock.method(staffInvitationRepository, 'getInvitationByTokenHash', async () => ({
      id: 'inv-1', college_id: 'c1', department_id: 'dept-1', email: 'new@example.com', accepted_at: null, expires_at: new Date(Date.now() + 100000),
    }));
    t.after(() => findMock.mock.restore());
    const invitation = await staffService.lookupPendingStaffInvitation({}, 'token');
    assert.equal(invitation.id, 'inv-1');
  });
});

test('acceptStaffInvitation', async (t) => {
  const validInvitation = {
    id: 'inv-1', college_id: 'c1', department_id: 'dept-1', email: 'new@example.com', invited_by: 'hod-1',
  };

  await t.test('rejects a weak password', async () => {
    await assert.rejects(
      () => staffService.acceptStaffInvitation({}, validInvitation, { username: 'newstaff', password: 'weak', fullName: 'New Staff' }),
      staffService.StaffInvitationValidationError,
    );
  });

  await t.test('rejects a missing fullName', async () => {
    await assert.rejects(
      () => staffService.acceptStaffInvitation({}, validInvitation, { username: 'newstaff', password: 'Str0ng!Pass' }),
      staffService.StaffInvitationValidationError,
    );
  });

  await t.test('maps a duplicate username to StaffInvitationUsernameConflictError', async () => {
    const err = Object.assign(new Error('dup'), { code: '23505' });
    const createUserMock = t.mock.method(authRepository, 'createUser', async () => { throw err; });
    t.after(() => createUserMock.mock.restore());

    await assert.rejects(
      () => staffService.acceptStaffInvitation({}, validInvitation, { username: 'taken', password: 'Str0ng!Pass', fullName: 'New Staff' }),
      staffService.StaffInvitationUsernameConflictError,
    );
  });

  await t.test('creates the users+staff rows (inactive, department from the invitation) and auto-submits into the hod->principal chain', async () => {
    const createUserMock = t.mock.method(authRepository, 'createUser', async (client, fields) => ({ id: 'user-1', ...fields }));
    const createStaffMock = t.mock.method(staffRepository, 'create', async (client, fields) => ({ id: 'staff-1', college_id: fields.collegeId, department_id: fields.departmentId, ...fields }));
    const findByIdMock = t.mock.method(staffRepository, 'findById', async () => ({ id: 'staff-1', college_id: 'c1', department_id: 'dept-1' }));
    const resolveChainMock = t.mock.method(workflowChainService, 'resolveApproverChain', async () => (
      [{ step: 1, role: 'hod', user_id: 'hod-1' }, { step: 2, role: 'principal', user_id: 'principal-1' }]
    ));
    const submitMock = t.mock.method(workflowService, 'submitRequest', async (client, fields) => ({ id: 'wf-1', ...fields }));
    const markAcceptedMock = t.mock.method(staffInvitationRepository, 'markInvitationAccepted', async () => true);
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createUserMock.mock.restore();
      createStaffMock.mock.restore();
      findByIdMock.mock.restore();
      resolveChainMock.mock.restore();
      submitMock.mock.restore();
      markAcceptedMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await staffService.acceptStaffInvitation({}, validInvitation, {
      username: 'newstaff', password: 'Str0ng!Pass', fullName: 'New Staff',
    });

    assert.equal(createUserMock.mock.calls[0].arguments[1].role, 'staff');
    assert.equal(createUserMock.mock.calls[0].arguments[1].isActive, false);
    assert.equal(createStaffMock.mock.calls[0].arguments[1].departmentId, 'dept-1');
    assert.equal(markAcceptedMock.mock.calls[0].arguments[1], 'inv-1');
    assert.equal(submitMock.mock.calls[0].arguments[1].requestedByUserId, 'user-1');
    assert.equal(submitMock.mock.calls[0].arguments[1].approverChain[0].user_id, 'hod-1');
    assert.equal(submitMock.mock.calls[0].arguments[1].approverChain[1].user_id, 'principal-1');
    assert.equal(result.workflowRequest.id, 'wf-1');
  });
});

// hodInChargeRepository is imported so findHodForDepartment's own
// in-charge fallback path is stubbed to "none" for the acceptStaffInvitation
// test above, which mocks findByCollegeDepartmentAndRole directly and
// never wants the fallback to even query anything real.
test('findHodForDepartment never queries hod_in_charge when a permanent hod exists (acceptStaffInvitation dependency)', async (t) => {
  const findHodMock = t.mock.method(staffRepository, 'findByCollegeDepartmentAndRole', async () => ({ id: 'staff-hod', user_id: 'hod-1' }));
  const findInChargeMock = t.mock.method(hodInChargeRepository, 'findActiveForDepartment');
  t.after(() => {
    findHodMock.mock.restore();
    findInChargeMock.mock.restore();
  });
  const hod = await staffService.findHodForDepartment({}, 'c1', 'dept-1');
  assert.equal(hod.user_id, 'hod-1');
  assert.equal(findInChargeMock.mock.callCount(), 0);
});
