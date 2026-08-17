'use strict';

// Unit tests for StaffService's deactivation + HOD In-Charge functions
// — no live Postgres needed: staffRepository/authService/
// facultyAllocationRepository/hodInChargeRepository/auditLogRepository
// are stubbed via node:test's built-in mock, same technique as every
// other *-service.test.js file in this suite. deactivateStaff's tutor
// check moved off classRepository.findByTutorUserId onto
// identityService.resolveActiveClassTutorPosition in Phase 2 step 17 —
// mocked here rather than classRepository directly.

const test = require('node:test');
const assert = require('node:assert/strict');
const staffRepository = require('../src/repositories/staffRepository');
const authService = require('../src/services/authService');
const facultyAllocationRepository = require('../src/repositories/facultyAllocationRepository');
const hodInChargeRepository = require('../src/repositories/hodInChargeRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const positionRepository = require('../src/repositories/positionRepository');
const collegeProfileRepository = require('../src/repositories/collegeProfileRepository');
const identityService = require('../src/services/identityService');
const staffService = require('../src/services/staffService');

// Phase 1 (Capability Resolver integration): appointHodInCharge now
// also calls ensureHodPosition/swapHodOccupant (staffService.js) —
// every test exercising that path needs the Level 3 Position/Account/
// Occupant plumbing stubbed too, same as every other repository call
// in this file. getLevel3PositionTitleMock added for Create/Edit
// College customization — ensureHodPosition now reads
// colleges.level3_position_title before falling back to the 'HOD'
// default; null here exercises that default, same as every college
// that never sets a custom title.
function mockEnsureHodPositionCalls(t, { existingAssignment = null, existingOccupant = null } = {}) {
  const getLevel3PositionTitleMock = t.mock.method(collegeProfileRepository, 'getLevel3PositionTitle', async () => null);
  const findAssignmentMock = t.mock.method(positionRepository, 'findActiveDepartmentAssignment', async () => existingAssignment);
  const createPositionMock = t.mock.method(positionRepository, 'createPosition', async () => ({ id: 'pos-1', level: 3 }));
  const createAccountMock = t.mock.method(positionRepository, 'createPositionAccount', async () => ({ id: 'acct-1' }));
  const createDeptAssignmentMock = t.mock.method(positionRepository, 'createPositionDepartmentAssignment', async () => ({ id: 'deptassign-1' }));
  const findOccupantMock = t.mock.method(positionRepository, 'findActiveOccupant', async () => existingOccupant);
  const revokeOccupantMock = t.mock.method(positionRepository, 'revokePositionOccupant', async () => ({ id: 'occ-old', revoked_at: new Date() }));
  const createOccupantMock = t.mock.method(positionRepository, 'createPositionOccupant', async (client, fields) => ({ id: 'occ-1', ...fields }));
  t.after(() => {
    getLevel3PositionTitleMock.mock.restore();
    findAssignmentMock.mock.restore();
    createPositionMock.mock.restore();
    createAccountMock.mock.restore();
    createDeptAssignmentMock.mock.restore();
    findOccupantMock.mock.restore();
    revokeOccupantMock.mock.restore();
    createOccupantMock.mock.restore();
  });
  return {
    getLevel3PositionTitleMock, findAssignmentMock, createPositionMock, createAccountMock, createDeptAssignmentMock, findOccupantMock, revokeOccupantMock, createOccupantMock,
  };
}

test('deactivateStaff', async (t) => {
  await t.test('rejects an unknown staff id', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());
    await assert.rejects(
      () => staffService.deactivateStaff({}, 'missing'),
      staffService.StaffDeactivationNotFoundError,
    );
  });

  await t.test('rejects a target with no departmentId set, before checking anything else', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async () => ({ id: 'staff-1', college_id: 'c1', user_id: 'u1', department_id: null }));
    const findHodMock = t.mock.method(staffRepository, 'findByCollegeDepartmentAndRole');
    t.after(() => {
      findMock.mock.restore();
      findHodMock.mock.restore();
    });
    await assert.rejects(
      () => staffService.deactivateStaff({}, 'staff-1', { actorUserId: 'hod-1' }),
      staffService.StaffDeactivationNotAuthorizedError,
    );
    assert.equal(findHodMock.mock.callCount(), 0);
  });

  await t.test('rejects an actor who is hod of a DIFFERENT department', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async () => ({ id: 'staff-1', college_id: 'c1', user_id: 'u1', department_id: 'dept-1' }));
    const findHodMock = t.mock.method(staffRepository, 'findByCollegeDepartmentAndRole', async () => ({ id: 'staff-hod', user_id: 'hod-of-other-dept' }));
    const findInChargeMock = t.mock.method(hodInChargeRepository, 'findActiveForDepartment');
    const deactivateMock = t.mock.method(authService, 'deactivateUser');
    t.after(() => {
      findMock.mock.restore();
      findHodMock.mock.restore();
      findInChargeMock.mock.restore();
      deactivateMock.mock.restore();
    });
    await assert.rejects(
      () => staffService.deactivateStaff({}, 'staff-1', { actorUserId: 'hod-1' }),
      staffService.StaffDeactivationNotAuthorizedError,
    );
    assert.equal(deactivateMock.mock.callCount(), 0);
  });

  await t.test('rejects a department with no active hod to authorize against', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async () => ({ id: 'staff-1', college_id: 'c1', user_id: 'u1', department_id: 'dept-1' }));
    const findHodMock = t.mock.method(staffRepository, 'findByCollegeDepartmentAndRole', async () => null);
    const findInChargeMock = t.mock.method(hodInChargeRepository, 'findActiveForDepartment', async () => null);
    t.after(() => {
      findMock.mock.restore();
      findHodMock.mock.restore();
      findInChargeMock.mock.restore();
    });
    await assert.rejects(
      () => staffService.deactivateStaff({}, 'staff-1', { actorUserId: 'hod-1' }),
      staffService.StaffDeactivationNotAuthorizedError,
    );
  });

  await t.test('refuses while the staff member still has active faculty allocations', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async () => ({ id: 'staff-1', college_id: 'c1', user_id: 'u1', department_id: 'dept-1' }));
    const findHodMock = t.mock.method(staffRepository, 'findByCollegeDepartmentAndRole', async () => ({ id: 'staff-hod', user_id: 'hod-1' }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByStaffUserId', async () => [{ id: 'alloc-1' }]);
    const deactivateMock = t.mock.method(authService, 'deactivateUser');
    t.after(() => {
      findMock.mock.restore();
      findHodMock.mock.restore();
      findAllocMock.mock.restore();
      deactivateMock.mock.restore();
    });
    await assert.rejects(
      () => staffService.deactivateStaff({}, 'staff-1', { actorUserId: 'hod-1' }),
      staffService.StaffDeactivationHasActiveDutiesError,
    );
    assert.equal(deactivateMock.mock.callCount(), 0);
  });

  await t.test('refuses while the staff member is still a class tutor', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async () => ({ id: 'staff-1', college_id: 'c1', user_id: 'u1', department_id: 'dept-1' }));
    const findHodMock = t.mock.method(staffRepository, 'findByCollegeDepartmentAndRole', async () => ({ id: 'staff-hod', user_id: 'hod-1' }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByStaffUserId', async () => []);
    const findTutorClassMock = t.mock.method(identityService, 'resolveActiveClassTutorPosition', async () => 'class-1');
    const deactivateMock = t.mock.method(authService, 'deactivateUser');
    t.after(() => {
      findMock.mock.restore();
      findHodMock.mock.restore();
      findAllocMock.mock.restore();
      findTutorClassMock.mock.restore();
      deactivateMock.mock.restore();
    });
    await assert.rejects(
      () => staffService.deactivateStaff({}, 'staff-1', { actorUserId: 'hod-1' }),
      staffService.StaffDeactivationHasActiveDutiesError,
    );
    assert.equal(deactivateMock.mock.callCount(), 0);
  });

  await t.test('deactivates a staff member with no active duties, without deleting the staff row', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async () => ({ id: 'staff-1', college_id: 'c1', user_id: 'u1', department_id: 'dept-1' }));
    const findHodMock = t.mock.method(staffRepository, 'findByCollegeDepartmentAndRole', async () => ({ id: 'staff-hod', user_id: 'hod-1' }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByStaffUserId', async () => []);
    const findTutorClassMock = t.mock.method(identityService, 'resolveActiveClassTutorPosition', async () => null);
    const removeMock = t.mock.method(staffRepository, 'remove');
    const deactivateMock = t.mock.method(authService, 'deactivateUser', async (client, userId) => ({ id: userId, is_active: false }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      findHodMock.mock.restore();
      findAllocMock.mock.restore();
      findTutorClassMock.mock.restore();
      removeMock.mock.restore();
      deactivateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await staffService.deactivateStaff({}, 'staff-1', { actorUserId: 'hod-1' });
    assert.equal(result.user.is_active, false);
    assert.equal(removeMock.mock.callCount(), 0);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'staff_deactivated');
  });
});

test('appointHodInCharge / revokeHodInCharge / findHodForDepartment fallback', async (t) => {
  await t.test('rejects missing departmentId/facultyUserId', async () => {
    await assert.rejects(
      () => staffService.appointHodInCharge({}, null, null),
      staffService.HodInChargeValidationError,
    );
  });

  await t.test('creates an appointment, swaps the position occupant, and audit-logs it', async () => {
    const createMock = t.mock.method(hodInChargeRepository, 'create', async (client, fields) => ({ id: 'appt-1', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    const positionMocks = mockEnsureHodPositionCalls(t);
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });
    const result = await staffService.appointHodInCharge({}, 'dept-1', 'faculty-1', { reason: 'HOD on leave' }, { actorUserId: 'principal-1', collegeId: 'c1' });
    assert.equal(result.id, 'appt-1');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'hod_in_charge_appointed');
    assert.equal(positionMocks.createOccupantMock.mock.calls[0].arguments[1].userId, 'faculty-1');
    assert.equal(positionMocks.findOccupantMock.mock.callCount(), 1);
  });

  await t.test('maps a duplicate active-appointment constraint violation', async () => {
    const err = Object.assign(new Error('dup'), { code: '23505', constraint: 'hod_in_charge_one_active_per_department' });
    const createMock = t.mock.method(hodInChargeRepository, 'create', async () => { throw err; });
    t.after(() => createMock.mock.restore());
    await assert.rejects(
      () => staffService.appointHodInCharge({}, 'dept-1', 'faculty-1', {}, { actorUserId: 'principal-1', collegeId: 'c1' }),
      staffService.HodInChargeAlreadyActiveError,
    );
  });

  await t.test('revokeHodInCharge falls back to the permanent HOD occupant when one exists', async () => {
    const revokeMock = t.mock.method(hodInChargeRepository, 'revoke', async () => ({
      id: 'appt-1', college_id: 'c1', department_id: 'dept-1', faculty_user_id: 'faculty-1',
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    const findHodMock = t.mock.method(staffRepository, 'findByCollegeDepartmentAndRole', async () => ({ id: 'staff-hod', user_id: 'permanent-hod-1' }));
    const positionMocks = mockEnsureHodPositionCalls(t, { existingOccupant: { id: 'occ-inCharge', user_id: 'faculty-1' } });
    t.after(() => {
      revokeMock.mock.restore();
      auditMock.mock.restore();
      findHodMock.mock.restore();
    });

    const result = await staffService.revokeHodInCharge({}, 'appt-1', { actorUserId: 'principal-1' });
    assert.equal(result.id, 'appt-1');
    assert.equal(positionMocks.revokeOccupantMock.mock.calls[0].arguments[1], 'occ-inCharge');
    assert.equal(positionMocks.createOccupantMock.mock.calls[0].arguments[1].userId, 'permanent-hod-1');
  });

  await t.test('revokeHodInCharge leaves the position vacant when no permanent HOD exists', async () => {
    const revokeMock = t.mock.method(hodInChargeRepository, 'revoke', async () => ({
      id: 'appt-1', college_id: 'c1', department_id: 'dept-1', faculty_user_id: 'faculty-1',
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    const findHodMock = t.mock.method(staffRepository, 'findByCollegeDepartmentAndRole', async () => null);
    const positionMocks = mockEnsureHodPositionCalls(t, { existingOccupant: { id: 'occ-inCharge', user_id: 'faculty-1' } });
    t.after(() => {
      revokeMock.mock.restore();
      auditMock.mock.restore();
      findHodMock.mock.restore();
    });

    await staffService.revokeHodInCharge({}, 'appt-1', { actorUserId: 'principal-1' });
    assert.equal(positionMocks.revokeOccupantMock.mock.calls[0].arguments[1], 'occ-inCharge');
    assert.equal(positionMocks.createOccupantMock.mock.callCount(), 0);
  });

  await t.test('revokeHodInCharge on a nonexistent/already-revoked appointment throws', async () => {
    const revokeMock = t.mock.method(hodInChargeRepository, 'revoke', async () => null);
    t.after(() => revokeMock.mock.restore());
    await assert.rejects(
      () => staffService.revokeHodInCharge({}, 'appt-1'),
      staffService.StaffDeactivationNotFoundError,
    );
  });

  await t.test('findHodForDepartment returns the real HOD when one is active, never checking in-charge', async () => {
    const findHodMock = t.mock.method(staffRepository, 'findByCollegeDepartmentAndRole', async () => ({ id: 'staff-hod', user_id: 'hod-1' }));
    const findInChargeMock = t.mock.method(hodInChargeRepository, 'findActiveForDepartment');
    t.after(() => {
      findHodMock.mock.restore();
      findInChargeMock.mock.restore();
    });
    const result = await staffService.findHodForDepartment({}, 'c1', 'dept-1');
    assert.equal(result.user_id, 'hod-1');
    assert.equal(findInChargeMock.mock.callCount(), 0);
  });

  await t.test('findHodForDepartment falls back to an active HOD In-Charge appointee when no real HOD exists', async () => {
    const findHodMock = t.mock.method(staffRepository, 'findByCollegeDepartmentAndRole', async () => null);
    const findInChargeMock = t.mock.method(hodInChargeRepository, 'findActiveForDepartment', async () => ({ faculty_user_id: 'faculty-1' }));
    const findByUserIdMock = t.mock.method(staffRepository, 'findByUserId', async () => ({ id: 'staff-faculty', user_id: 'faculty-1' }));
    t.after(() => {
      findHodMock.mock.restore();
      findInChargeMock.mock.restore();
      findByUserIdMock.mock.restore();
    });
    const result = await staffService.findHodForDepartment({}, 'c1', 'dept-1');
    assert.equal(result.user_id, 'faculty-1');
  });

  await t.test('findHodForDepartment throws when neither a real HOD nor an in-charge appointee exists', async () => {
    const findHodMock = t.mock.method(staffRepository, 'findByCollegeDepartmentAndRole', async () => null);
    const findInChargeMock = t.mock.method(hodInChargeRepository, 'findActiveForDepartment', async () => null);
    t.after(() => {
      findHodMock.mock.restore();
      findInChargeMock.mock.restore();
    });
    await assert.rejects(
      () => staffService.findHodForDepartment({}, 'c1', 'dept-1'),
      staffService.StaffHodNotFoundError,
    );
  });
});
