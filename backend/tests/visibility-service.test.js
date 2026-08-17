'use strict';

// Unit tests for VisibilityService's core resolution — no live
// Postgres: identityService.resolveCapabilities (the actor-resolution
// path every legacy-shape {actorUserId, actorRole} call now goes
// through, per Phase 1's Capability Resolver integration) plus
// studentRepository/staffRepository/classRepository (unrelated target-
// lookup calls, unaffected by that change) are stubbed via node:test's
// built-in mock, same technique student-service.test.js already uses.

const test = require('node:test');
const assert = require('node:assert/strict');
const classRepository = require('../src/repositories/classRepository');
const studentRepository = require('../src/repositories/studentRepository');
const staffRepository = require('../src/repositories/staffRepository');
const identityService = require('../src/services/identityService');
const visibilityService = require('../src/services/visibilityService');

const CLASS_A = { id: 'class-a', college_id: 'c1', department_id: 'dept-1' };
const CLASS_B = { id: 'class-b', college_id: 'c1', department_id: 'dept-2' };

// Mocks the ONE thing buildActorContext now calls to resolve a legacy
// {actorUserId, actorRole} input — replaces the old per-lookup mocks
// (classRepository.findByTutorUserId, facultyAllocationRepository.
// findByStaffUserId, staffService.findHodDepartmentId) that
// actorContextService used to call directly before it became a thin
// adapter over this resolver (see actorContextService.js).
function mockResolveCapabilities(t, capabilities) {
  const m = t.mock.method(identityService, 'resolveCapabilities', async () => capabilities);
  t.after(() => m.mock.restore());
  return m;
}

function staffCapabilities({ assignedClassIds = [] } = {}) {
  return {
    effectiveRole: 'staff', scopeLevel: 'self_assigned', departmentIds: [], assignedClassIds,
  };
}

function hodCapabilities({ departmentIds = [] } = {}) {
  return {
    effectiveRole: 'hod', scopeLevel: 'department', departmentIds, assignedClassIds: [],
  };
}

function principalCapabilities() {
  return {
    effectiveRole: 'principal', scopeLevel: 'college', departmentIds: [], assignedClassIds: [],
  };
}

function mockFindClassById(t, byId = { 'class-a': CLASS_A, 'class-b': CLASS_B }) {
  const m = t.mock.method(classRepository, 'findById', async (client, id) => byId[id] || null);
  t.after(() => m.mock.restore());
  return m;
}

test('visibilityService.getVisibleClassIds / assertCanViewClass', async (t) => {
  await t.test('staff sees only their tutored class, not another class they have no allocation for', async () => {
    mockResolveCapabilities(t, staffCapabilities({ assignedClassIds: ['class-a'] }));
    const ids = await visibilityService.getVisibleClassIds({}, { collegeId: 'c1', actorUserId: 'staff-a', actorRole: 'staff' });
    assert.deepEqual(ids, ['class-a']);
  });

  await t.test('staff from class A cannot view class B (not tutor, not allocated)', async () => {
    mockResolveCapabilities(t, staffCapabilities({ assignedClassIds: ['class-a'] }));
    await assert.rejects(
      () => visibilityService.assertCanViewClass({}, 'class-b', { collegeId: 'c1', actorUserId: 'staff-a', actorRole: 'staff' }),
      visibilityService.VisibilityForbiddenError,
    );
  });

  await t.test('staff faculty-allocated to class B (but not its tutor) can view class B', async () => {
    mockResolveCapabilities(t, staffCapabilities({ assignedClassIds: ['class-a', 'class-b'] }));
    await visibilityService.assertCanViewClass({}, 'class-b', { collegeId: 'c1', actorUserId: 'staff-a', actorRole: 'staff' });
  });

  await t.test('hod of department-1 cannot view a class in department-2', async () => {
    mockResolveCapabilities(t, hodCapabilities({ departmentIds: ['dept-1'] }));
    const findByDeptMock = t.mock.method(classRepository, 'findByDepartmentId', async () => [CLASS_A]);
    t.after(() => findByDeptMock.mock.restore());

    await assert.rejects(
      () => visibilityService.assertCanViewClass({}, 'class-b', { collegeId: 'c1', actorUserId: 'hod-1', actorRole: 'hod' }),
      visibilityService.VisibilityForbiddenError,
    );
  });

  await t.test('principal sees every class in the college (unrestricted)', async () => {
    mockResolveCapabilities(t, principalCapabilities());
    const ids = await visibilityService.getVisibleClassIds({}, { collegeId: 'c1', actorUserId: 'principal-1', actorRole: 'principal' });
    assert.equal(ids, null);
    await visibilityService.assertCanViewClass({}, 'class-b', { collegeId: 'c1', actorUserId: 'principal-1', actorRole: 'principal' });
  });

  await t.test('a user with no active position and no class assignments has no class visibility by default', async () => {
    mockResolveCapabilities(t, staffCapabilities());
    const ids = await visibilityService.getVisibleClassIds({}, { collegeId: 'c1', actorUserId: 'someone-1', actorRole: 'unmapped_role' });
    assert.deepEqual(ids, []);
    await assert.rejects(
      () => visibilityService.assertCanViewClass({}, 'class-a', { collegeId: 'c1', actorUserId: 'someone-1', actorRole: 'unmapped_role' }),
      visibilityService.VisibilityForbiddenError,
    );
  });
});

test('visibilityService.assertCanViewStudent', async (t) => {
  const STUDENT_IN_A = { id: 'student-1', college_id: 'c1', class_id: 'class-a' };

  await t.test('staff tutoring class A can view a student in class A', async () => {
    mockResolveCapabilities(t, staffCapabilities({ assignedClassIds: ['class-a'] }));
    await visibilityService.assertCanViewStudent({}, STUDENT_IN_A, { actorUserId: 'staff-a', actorRole: 'staff' });
  });

  await t.test('staff from class B cannot view a student in class A', async () => {
    mockResolveCapabilities(t, staffCapabilities({ assignedClassIds: ['class-b'] }));
    await assert.rejects(
      () => visibilityService.assertCanViewStudent({}, STUDENT_IN_A, { actorUserId: 'staff-b', actorRole: 'staff' }),
      visibilityService.VisibilityForbiddenError,
    );
  });

  await t.test('accepts a bare student id and resolves it internally', async () => {
    const findMock = t.mock.method(studentRepository, 'findById', async () => STUDENT_IN_A);
    t.after(() => findMock.mock.restore());
    mockResolveCapabilities(t, staffCapabilities({ assignedClassIds: ['class-a'] }));
    await visibilityService.assertCanViewStudent({}, 'student-1', { actorUserId: 'staff-a', actorRole: 'staff' });
    assert.equal(findMock.mock.callCount(), 1);
  });
});

// assertCanViewStudent's hod/principal branches call
// assertIsHodOfDepartment/assertIsPrincipalOfCollege directly
// (staffService.findHodForDepartment/findPrincipal) rather than
// resolveActorContext — untouched by Phase 1, so these mocks are
// unchanged.
test('visibilityService.assertCanViewStaff', async (t) => {
  const STAFF_ROW = {
    id: 'staff-row-1', user_id: 'user-1', college_id: 'c1', department_id: 'dept-1',
  };
  const OTHER_STAFF_ROW = {
    id: 'staff-row-2', user_id: 'user-2', college_id: 'c1', department_id: 'dept-2',
  };

  function mockFindById(t, row = STAFF_ROW) {
    const m = t.mock.method(staffRepository, 'findById', async () => row);
    t.after(() => m.mock.restore());
    return m;
  }

  await t.test('self may always view their own profile', async () => {
    mockFindById(t, STAFF_ROW);
    const result = await visibilityService.assertCanViewStaff({}, { staffId: 'staff-row-1' }, { actorUserId: 'user-1', actorRole: 'staff' });
    assert.equal(result.id, 'staff-row-1');
  });

  await t.test('an ordinary staff member cannot view an unrelated staff member\'s private profile', async () => {
    mockFindById(t, OTHER_STAFF_ROW);
    await assert.rejects(
      () => visibilityService.assertCanViewStaff({}, { staffId: 'staff-row-2' }, { actorUserId: 'user-1', actorRole: 'staff' }),
      visibilityService.VisibilityForbiddenError,
    );
  });

  await t.test('hod of the target\'s own department may view them', async () => {
    mockFindById(t, STAFF_ROW);
    mockResolveCapabilities(t, hodCapabilities({ departmentIds: ['dept-1'] }));
    const result = await visibilityService.assertCanViewStaff({}, { staffId: 'staff-row-1' }, { actorUserId: 'hod-1', actorRole: 'hod' });
    assert.equal(result.id, 'staff-row-1');
  });

  await t.test('hod of a DIFFERENT department cannot view the target', async () => {
    mockFindById(t, STAFF_ROW);
    mockResolveCapabilities(t, hodCapabilities({ departmentIds: ['dept-2'] }));
    await assert.rejects(
      () => visibilityService.assertCanViewStaff({}, { staffId: 'staff-row-1' }, { actorUserId: 'hod-2', actorRole: 'hod' }),
      visibilityService.VisibilityForbiddenError,
    );
  });

  await t.test('principal may view any staff member college-wide', async () => {
    mockFindById(t, STAFF_ROW);
    mockResolveCapabilities(t, principalCapabilities());
    await visibilityService.assertCanViewStaff({}, { staffId: 'staff-row-1' }, { actorUserId: 'principal-1', actorRole: 'principal' });
  });

  await t.test('resolves by userId as well as staffId', async () => {
    const m = t.mock.method(staffRepository, 'findByUserId', async () => STAFF_ROW);
    t.after(() => m.mock.restore());
    const result = await visibilityService.assertCanViewStaff({}, { userId: 'user-1' }, { actorUserId: 'user-1', actorRole: 'staff' });
    assert.equal(result.id, 'staff-row-1');
  });

  await t.test('returns null (not an error) for a nonexistent target', async () => {
    mockFindById(t, null);
    const result = await visibilityService.assertCanViewStaff({}, { staffId: 'missing' }, { actorUserId: 'user-1', actorRole: 'principal' });
    assert.equal(result, null);
  });
});

// Every public function above accepts either the legacy
// {actorUserId, actorRole} shape or an already-built ActorContext
// directly. These tests hold the actor+resource fixed and check both
// input shapes reach the exact same allow/deny outcome. The
// ActorContext-shape path never calls resolveCapabilities at all
// (isActorContext short-circuits it) — only the legacy-shape half of
// each pair needs a mock.
test('visibilityService dual-input support (legacy shape vs. pre-built ActorContext)', async (t) => {
  await t.test('getVisibleClassIds: staff legacy shape and ActorContext shape agree', async () => {
    mockResolveCapabilities(t, staffCapabilities({ assignedClassIds: ['class-a', 'class-b'] }));
    const viaLegacy = await visibilityService.getVisibleClassIds(
      {},
      { collegeId: 'c1', actorUserId: 'staff-a', actorRole: 'staff' },
    );

    const actorContext = {
      actorId: 'staff-a',
      tenantId: 'c1',
      role: 'staff',
      scopeLevel: 'self_assigned',
      departmentIds: [],
      assignedClassIds: ['class-a', 'class-b'],
      campusIds: ['c1'],
    };
    const viaActorContext = await visibilityService.getVisibleClassIds({}, actorContext);

    assert.deepEqual([...viaLegacy].sort(), [...viaActorContext].sort());
  });

  await t.test('getVisibleClassIds: hod legacy shape and ActorContext shape agree', async () => {
    mockResolveCapabilities(t, hodCapabilities({ departmentIds: ['dept-1'] }));
    mockFindClassById(t);
    const findByDeptMock = t.mock.method(classRepository, 'findByDepartmentId', async () => [CLASS_A]);
    t.after(() => findByDeptMock.mock.restore());

    const viaLegacy = await visibilityService.getVisibleClassIds(
      {},
      { collegeId: 'c1', actorUserId: 'hod-1', actorRole: 'hod' },
    );

    const actorContext = {
      actorId: 'hod-1',
      tenantId: 'c1',
      role: 'hod',
      scopeLevel: 'department',
      departmentIds: ['dept-1'],
      assignedClassIds: [],
      campusIds: ['c1'],
    };
    const viaActorContext = await visibilityService.getVisibleClassIds({}, actorContext);

    assert.deepEqual(viaLegacy, viaActorContext);
  });

  await t.test('assertCanViewClass: an ActorContext-shaped input is rejected exactly like the equivalent legacy shape', async () => {
    mockResolveCapabilities(t, staffCapabilities({ assignedClassIds: ['class-a'] }));
    const legacyInput = { collegeId: 'c1', actorUserId: 'staff-a', actorRole: 'staff' };
    await assert.rejects(
      () => visibilityService.assertCanViewClass({}, 'class-b', legacyInput),
      visibilityService.VisibilityForbiddenError,
    );

    const actorContext = {
      actorId: 'staff-a',
      tenantId: 'c1',
      role: 'staff',
      scopeLevel: 'self_assigned',
      departmentIds: [],
      assignedClassIds: ['class-a'],
      campusIds: ['c1'],
    };
    await assert.rejects(
      () => visibilityService.assertCanViewClass({}, 'class-b', actorContext),
      visibilityService.VisibilityForbiddenError,
    );
  });

  await t.test('assertCanViewStaff: hod legacy shape and ActorContext shape both grant access to their own department\'s staff', async () => {
    const STAFF_ROW = {
      id: 'staff-row-1', user_id: 'user-1', college_id: 'c1', department_id: 'dept-1',
    };
    const findByIdMock = t.mock.method(staffRepository, 'findById', async () => STAFF_ROW);
    t.after(() => findByIdMock.mock.restore());
    mockResolveCapabilities(t, hodCapabilities({ departmentIds: ['dept-1'] }));

    const viaLegacy = await visibilityService.assertCanViewStaff(
      {},
      { staffId: 'staff-row-1' },
      { actorUserId: 'hod-1', actorRole: 'hod' },
    );

    const actorContext = {
      actorId: 'hod-1',
      tenantId: 'c1',
      role: 'hod',
      scopeLevel: 'department',
      departmentIds: ['dept-1'],
      assignedClassIds: [],
      campusIds: ['c1'],
    };
    const viaActorContext = await visibilityService.assertCanViewStaff({}, { staffId: 'staff-row-1' }, actorContext);

    assert.equal(viaLegacy.id, STAFF_ROW.id);
    assert.equal(viaActorContext.id, STAFF_ROW.id);
  });
});
