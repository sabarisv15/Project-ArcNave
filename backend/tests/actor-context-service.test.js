'use strict';

// Unit tests for actorContextService.buildActorContext — no live
// Postgres: identityService.resolveCapabilities is stubbed via
// node:test's built-in mock, same technique visibility-service.test.js
// already uses. Phase 1 (Capability Resolver integration): this used
// to independently derive scope from classRepository/
// facultyAllocationRepository/staffService — now it's a thin adapter
// over identityService.resolveCapabilities, so these tests assert the
// adapter's field mapping, not a second copy of the resolution logic
// (that logic's own coverage lives in identity-resolvers.test.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const identityService = require('../src/services/identityService');
const { buildActorContext } = require('../src/services/actorContextService');
const { SCOPE_LEVELS } = require('../src/constants/scopeLevels');

function mockResolveCapabilities(t, capabilities) {
  const mock = t.mock.method(identityService, 'resolveCapabilities', async () => capabilities);
  t.after(() => mock.mock.restore());
  return mock;
}

test('actorContextService.buildActorContext', async (t) => {
  await t.test('maps a staff (self_assigned) capabilities result onto ActorContext', async () => {
    mockResolveCapabilities(t, {
      userId: 'staff-1',
      collegeId: 'college-1',
      positions: [],
      effectiveRole: 'staff',
      scopeLevel: SCOPE_LEVELS.SELF_ASSIGNED,
      departmentIds: [],
      assignedClassIds: ['class-a', 'class-b'],
    });

    const ctx = await buildActorContext({}, { actorId: 'staff-1', tenantId: 'college-1' });

    assert.equal(ctx.actorId, 'staff-1');
    assert.equal(ctx.tenantId, 'college-1');
    assert.equal(ctx.role, 'staff');
    assert.equal(ctx.scopeLevel, SCOPE_LEVELS.SELF_ASSIGNED);
    assert.deepEqual(ctx.departmentIds, []);
    assert.deepEqual(ctx.assignedClassIds, ['class-a', 'class-b']);
    assert.deepEqual(ctx.campusIds, ['college-1']);
  });

  await t.test('maps an hod (department) capabilities result onto ActorContext', async () => {
    mockResolveCapabilities(t, {
      userId: 'hod-1',
      collegeId: 'college-1',
      positions: [{ positionId: 'pos-1', level: 3 }],
      effectiveRole: 'hod',
      scopeLevel: SCOPE_LEVELS.DEPARTMENT,
      departmentIds: ['dept-1'],
      assignedClassIds: [],
    });

    const ctx = await buildActorContext({}, { actorId: 'hod-1', tenantId: 'college-1' });

    assert.equal(ctx.role, 'hod');
    assert.equal(ctx.scopeLevel, SCOPE_LEVELS.DEPARTMENT);
    assert.deepEqual(ctx.departmentIds, ['dept-1']);
    assert.deepEqual(ctx.assignedClassIds, []);
  });

  await t.test('maps a principal (college) capabilities result onto ActorContext', async () => {
    mockResolveCapabilities(t, {
      userId: 'principal-1',
      collegeId: 'college-1',
      positions: [{ positionId: 'pos-2', level: 1 }],
      effectiveRole: 'principal',
      scopeLevel: SCOPE_LEVELS.COLLEGE,
      departmentIds: [],
      assignedClassIds: [],
    });

    const ctx = await buildActorContext({}, { actorId: 'principal-1', tenantId: 'college-1' });

    assert.equal(ctx.role, 'principal');
    assert.equal(ctx.scopeLevel, SCOPE_LEVELS.COLLEGE);
    assert.deepEqual(ctx.departmentIds, []);
    assert.deepEqual(ctx.assignedClassIds, []);
    assert.deepEqual(ctx.campusIds, ['college-1']);
  });

  await t.test('a caller-passed role is ignored — the resolved effectiveRole always wins', async () => {
    mockResolveCapabilities(t, {
      userId: 'principal-1',
      collegeId: 'college-1',
      positions: [{ positionId: 'pos-2', level: 1 }],
      effectiveRole: 'principal',
      scopeLevel: SCOPE_LEVELS.COLLEGE,
      departmentIds: [],
      assignedClassIds: [],
    });

    // A stale/incorrect role string passed in must not leak through —
    // resolveCapabilities' own answer is the single source of truth.
    const ctx = await buildActorContext({}, { actorId: 'principal-1', tenantId: 'college-1', role: 'staff' });
    assert.equal(ctx.role, 'principal');
  });

  await t.test('a null/undefined tenantId resolves an empty campusIds', async () => {
    mockResolveCapabilities(t, {
      userId: 'admin-1',
      collegeId: null,
      positions: [],
      effectiveRole: 'staff',
      scopeLevel: SCOPE_LEVELS.SELF_ASSIGNED,
      departmentIds: [],
      assignedClassIds: [],
    });

    const ctx = await buildActorContext({}, { actorId: 'admin-1', tenantId: null });
    assert.deepEqual(ctx.campusIds, []);
  });
});
