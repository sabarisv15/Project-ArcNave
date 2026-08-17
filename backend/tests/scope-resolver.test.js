'use strict';

// Unit tests for scopeResolver's pure functions — no DB, no mocks:
// every check here is a plain function of an already-built
// ActorContext object literal.

const test = require('node:test');
const assert = require('node:assert/strict');
const scopeResolver = require('../src/services/scopeResolver');
const { SCOPE_LEVELS } = require('../src/constants/scopeLevels');

function actorContext(overrides = {}) {
  return {
    actorId: 'actor-1',
    tenantId: 'college-1',
    role: 'staff',
    scopeLevel: null,
    departmentIds: [],
    assignedClassIds: [],
    campusIds: ['college-1'],
    ...overrides,
  };
}

test('scopeResolver.isAuthorizedForCollege', async (t) => {
  await t.test('college scope is authorized for the college', () => {
    assert.equal(scopeResolver.isAuthorizedForCollege(actorContext({ scopeLevel: SCOPE_LEVELS.COLLEGE })), true);
  });

  await t.test('department scope is not authorized for the college', () => {
    assert.equal(scopeResolver.isAuthorizedForCollege(actorContext({ scopeLevel: SCOPE_LEVELS.DEPARTMENT })), false);
  });

  await t.test('self_assigned scope is not authorized for the college', () => {
    assert.equal(scopeResolver.isAuthorizedForCollege(actorContext({ scopeLevel: SCOPE_LEVELS.SELF_ASSIGNED })), false);
  });

  await t.test('no scope level (unmapped role) is not authorized for the college', () => {
    assert.equal(scopeResolver.isAuthorizedForCollege(actorContext({ scopeLevel: null })), false);
  });
});

test('scopeResolver.isAuthorizedForDepartment', async (t) => {
  await t.test('college scope is authorized for any department', () => {
    const ctx = actorContext({ scopeLevel: SCOPE_LEVELS.COLLEGE });
    assert.equal(scopeResolver.isAuthorizedForDepartment(ctx, 'dept-1'), true);
    assert.equal(scopeResolver.isAuthorizedForDepartment(ctx, 'dept-anything'), true);
  });

  await t.test('department scope is authorized for its own department only', () => {
    const ctx = actorContext({ scopeLevel: SCOPE_LEVELS.DEPARTMENT, departmentIds: ['dept-1'] });
    assert.equal(scopeResolver.isAuthorizedForDepartment(ctx, 'dept-1'), true);
    assert.equal(scopeResolver.isAuthorizedForDepartment(ctx, 'dept-2'), false);
  });

  await t.test('department scope with no resolved department is authorized for nothing', () => {
    const ctx = actorContext({ scopeLevel: SCOPE_LEVELS.DEPARTMENT, departmentIds: [] });
    assert.equal(scopeResolver.isAuthorizedForDepartment(ctx, 'dept-1'), false);
  });

  await t.test('self_assigned scope is never authorized for a department', () => {
    const ctx = actorContext({ scopeLevel: SCOPE_LEVELS.SELF_ASSIGNED, assignedClassIds: ['class-1'] });
    assert.equal(scopeResolver.isAuthorizedForDepartment(ctx, 'dept-1'), false);
  });
});

test('scopeResolver.isAuthorizedForClass', async (t) => {
  await t.test('college scope is authorized for any class', () => {
    const ctx = actorContext({ scopeLevel: SCOPE_LEVELS.COLLEGE });
    assert.equal(scopeResolver.isAuthorizedForClass(ctx, 'class-1'), true);
  });

  await t.test('self_assigned scope is authorized for its own assigned classes only', () => {
    const ctx = actorContext({ scopeLevel: SCOPE_LEVELS.SELF_ASSIGNED, assignedClassIds: ['class-1', 'class-2'] });
    assert.equal(scopeResolver.isAuthorizedForClass(ctx, 'class-1'), true);
    assert.equal(scopeResolver.isAuthorizedForClass(ctx, 'class-3'), false);
  });

  await t.test('department scope is not authorized for an individual class through this check', () => {
    const ctx = actorContext({ scopeLevel: SCOPE_LEVELS.DEPARTMENT, departmentIds: ['dept-1'] });
    assert.equal(scopeResolver.isAuthorizedForClass(ctx, 'class-1'), false);
  });

  await t.test('no scope level is authorized for nothing', () => {
    const ctx = actorContext({ scopeLevel: null });
    assert.equal(scopeResolver.isAuthorizedForClass(ctx, 'class-1'), false);
  });
});
