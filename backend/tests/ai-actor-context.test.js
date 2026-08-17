'use strict';

// Phase 4 Group (a), step 1: unit tests for
// aiActorContext.buildActorContextForIdentity — pure, synchronous, no
// DB call. Proves the mapped ActorContext's scopeLevel/departmentIds/
// assignedClassIds are correct for a Personal-shaped and an
// Institutional-shaped (including a Class Tutor, scopeLevel: 'class')
// identityContext, per Phase4-AI-Downstream-Scope-Fidelity.md decisions
// 1-2.

const test = require('node:test');
const assert = require('node:assert/strict');
const { SCOPE_LEVELS } = require('../src/constants/scopeLevels');
const aiActorContext = require('../src/services/aiActorContext');

test('buildActorContextForIdentity maps a Personal (department-scoped hod) identityContext', () => {
  const identityContext = {
    userId: 'user-1',
    role: 'hod',
    collegeId: 'college-1',
    departmentIds: ['dept-1'],
    departmentId: 'dept-1',
    classIds: [],
    scopeLevel: 'department',
    positionAccountId: null,
  };

  const actorContext = aiActorContext.buildActorContextForIdentity(identityContext);

  assert.deepEqual(actorContext, {
    actorId: 'user-1',
    tenantId: 'college-1',
    role: 'hod',
    scopeLevel: SCOPE_LEVELS.DEPARTMENT,
    departmentIds: ['dept-1'],
    assignedClassIds: [],
    campusIds: ['college-1'],
  });
});

test('buildActorContextForIdentity maps a college-wide (principal) identityContext', () => {
  const identityContext = {
    userId: 'user-2',
    role: 'principal',
    collegeId: 'college-1',
    departmentIds: [],
    departmentId: null,
    classIds: [],
    scopeLevel: 'college',
    positionAccountId: null,
  };

  const actorContext = aiActorContext.buildActorContextForIdentity(identityContext);

  assert.equal(actorContext.scopeLevel, SCOPE_LEVELS.COLLEGE);
  assert.equal(actorContext.actorId, 'user-2');
  assert.equal(actorContext.tenantId, 'college-1');
});

test('buildActorContextForIdentity maps an Institutional Class Tutor identityContext (scopeLevel: class -> SELF_ASSIGNED)', () => {
  const identityContext = {
    userId: 'occupant-9',
    role: 'class_tutor',
    collegeId: 'college-1',
    departmentIds: [],
    departmentId: null,
    classIds: ['class-5', 'class-6'],
    scopeLevel: 'class',
    positionAccountId: 'position-1',
  };

  const actorContext = aiActorContext.buildActorContextForIdentity(identityContext);

  assert.deepEqual(actorContext, {
    actorId: 'occupant-9',
    tenantId: 'college-1',
    role: 'class_tutor',
    scopeLevel: SCOPE_LEVELS.SELF_ASSIGNED,
    departmentIds: [],
    assignedClassIds: ['class-5', 'class-6'],
    campusIds: ['college-1'],
  });
});

test('buildActorContextForIdentity maps an Institutional HOD Position Account identityContext (department scope, independent of occupant\'s own personal scope)', () => {
  const identityContext = {
    userId: 'occupant-42',
    role: 'hod',
    collegeId: 'college-1',
    departmentIds: ['dept-9'],
    departmentId: 'dept-9',
    classIds: [],
    scopeLevel: 'department',
    positionAccountId: 'position-hod-9',
  };

  const actorContext = aiActorContext.buildActorContextForIdentity(identityContext);

  assert.equal(actorContext.scopeLevel, SCOPE_LEVELS.DEPARTMENT);
  assert.deepEqual(actorContext.departmentIds, ['dept-9']);
  assert.equal(actorContext.actorId, 'occupant-42');
});

test('buildActorContextForIdentity defaults departmentIds/assignedClassIds to [] when absent, and campusIds to [] when collegeId is null', () => {
  const identityContext = {
    userId: 'user-3',
    role: 'staff',
    collegeId: null,
    scopeLevel: 'self_assigned',
  };

  const actorContext = aiActorContext.buildActorContextForIdentity(identityContext);

  assert.deepEqual(actorContext.departmentIds, []);
  assert.deepEqual(actorContext.assignedClassIds, []);
  assert.deepEqual(actorContext.campusIds, []);
});
