'use strict';

// Coverage for the internal resolver modules (services/identity/*Resolver.js)
// and the identityService façade that composes them — against real seeded
// position data, same MIGRATION_DATABASE_URL (bypasses RLS) fixture pattern
// position-schema.test.js already uses for this exact reason (this suite is
// inherently cross-tenant/cross-role: it seeds positions/accounts/occupants
// directly rather than going through any tenant-scoped route).
//
// Deliberately tests the resolvers both individually (positionResolver
// alone, moduleResolver alone, ...) and the façade's composed output
// (identityService.resolveCapabilities), since the façade's contract
// (ADR-022) is what Phase 5/6 actually depend on — the individual
// resolver tests exist to make failures easy to localize, not because
// anything outside identityService is meant to be called directly by a
// route or AI tool.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const positionRepository = require('../src/repositories/positionRepository');
const positionResolver = require('../src/services/identity/positionResolver');
const moduleResolver = require('../src/services/identity/moduleResolver');
const departmentResolver = require('../src/services/identity/departmentResolver');
const classResolver = require('../src/services/identity/classResolver');
const assignmentResolver = require('../src/services/identity/assignmentResolver');
const visibilityResolver = require('../src/services/identity/visibilityResolver');
const identityService = require('../src/services/identityService');
const { SCOPE_LEVELS } = require('../src/constants/scopeLevels');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;

async function insertCollege(pool, collegeId) {
  await pool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $1)', [collegeId]);
}

async function insertUser(pool, collegeId, username, role = 'staff') {
  const result = await pool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, $2, $2 || '@example.test', 'x', $3, true) RETURNING id`,
    [collegeId, username, role],
  );
  return result.rows[0].id;
}

async function insertDepartment(pool, collegeId, name) {
  const result = await pool.query('INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id', [collegeId, name]);
  return result.rows[0].id;
}

async function insertClass(pool, collegeId, className) {
  const result = await pool.query('INSERT INTO classes (college_id, class_name) VALUES ($1, $2) RETURNING id', [collegeId, className]);
  return result.rows[0].id;
}

async function makePosition(pool, { collegeId, level, title, createdBy }) {
  const position = await positionRepository.createPosition(pool, {
    collegeId, level, title, createdBy,
  });
  const account = await positionRepository.createPositionAccount(pool, {
    collegeId, positionId: position.id, officialEmail: `${title}@example.edu`, passwordHash: 'x',
  });
  return { position, account };
}

async function occupy(pool, { collegeId, accountId, userId }) {
  return positionRepository.createPositionOccupant(pool, {
    collegeId, positionAccountId: accountId, userId, assignedBy: userId,
  });
}

async function cleanup(pool, collegeId) {
  await pool.query('DELETE FROM position_class_assignments WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM position_department_assignments WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM position_module_assignments WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM position_occupants WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM position_accounts WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM positions WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM staff WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM classes WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM departments WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM users WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM colleges WHERE college_id = $1', [collegeId]);
}

test('identity resolvers (Phase 3)', async (t) => {
  const pool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeIds = [];

  t.after(async () => {
    for (const collegeId of collegeIds) {
      // eslint-disable-next-line no-await-in-loop -- test teardown, small fixed set
      await cleanup(pool, collegeId);
    }
    await pool.end();
  });

  await t.test('positionResolver: a user with no positions resolves to an empty list', async () => {
    const collegeId = `idr${suffix}a`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const userId = await insertUser(pool, collegeId, 'nobody');

    const positions = await positionResolver.resolveActivePositions(pool, { collegeId, userId });
    assert.deepEqual(positions, []);
  });

  await t.test('positionResolver: resolves the position a user actively occupies, and stops after revocation', async () => {
    const collegeId = `idr${suffix}b`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const principalUserId = await insertUser(pool, collegeId, 'principal1', 'principal');
    const { position, account } = await makePosition(pool, {
      collegeId, level: 1, title: 'Principal', createdBy: principalUserId,
    });
    const occupant = await occupy(pool, { collegeId, accountId: account.id, userId: principalUserId });

    const positions = await positionResolver.resolveActivePositions(pool, { collegeId, userId: principalUserId });
    assert.equal(positions.length, 1);
    assert.equal(positions[0].positionId, position.id);
    assert.equal(positions[0].level, 1);
    assert.equal(positions[0].positionAccountId, account.id);

    await positionRepository.revokePositionOccupant(pool, occupant.id, { revokedBy: principalUserId });
    const afterRevoke = await positionResolver.resolveActivePositions(pool, { collegeId, userId: principalUserId });
    assert.deepEqual(afterRevoke, []);
  });

  await t.test('moduleResolver / departmentResolver: resolve only active assignments for a position', async () => {
    const collegeId = `idr${suffix}c`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const hodUserId = await insertUser(pool, collegeId, 'hod1', 'hod');
    const deptId = await insertDepartment(pool, collegeId, 'CSE');
    const { position } = await makePosition(pool, {
      collegeId, level: 3, title: 'HOD CSE', createdBy: hodUserId,
    });

    assert.deepEqual(await moduleResolver.resolveOwnedModules(pool, position.id), []);
    assert.deepEqual(await departmentResolver.resolveMappedDepartments(pool, position.id), []);

    const moduleAssignment = await positionRepository.createPositionModuleAssignment(pool, {
      collegeId, positionId: position.id, moduleKey: 'attendance', assignedBy: hodUserId,
    });
    const deptAssignment = await positionRepository.createPositionDepartmentAssignment(pool, {
      collegeId, positionId: position.id, departmentId: deptId, assignedBy: hodUserId,
    });

    assert.deepEqual(await moduleResolver.resolveOwnedModules(pool, position.id), ['attendance']);
    assert.deepEqual(await departmentResolver.resolveMappedDepartments(pool, position.id), [deptId]);

    await positionRepository.revokePositionModuleAssignment(pool, moduleAssignment.id, { revokedBy: hodUserId });
    await positionRepository.revokePositionDepartmentAssignment(pool, deptAssignment.id, { revokedBy: hodUserId });

    assert.deepEqual(await moduleResolver.resolveOwnedModules(pool, position.id), []);
    assert.deepEqual(await departmentResolver.resolveMappedDepartments(pool, position.id), []);
  });

  // Phase 2 step 8 — classResolver mirrors moduleResolver/
  // departmentResolver exactly, same active-only assignment lifecycle.
  await t.test('classResolver: resolves only active class assignments for a position', async () => {
    const collegeId = `idr${suffix}c2`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const tutorUserId = await insertUser(pool, collegeId, 'tutor1', 'staff');
    const classId = await insertClass(pool, collegeId, 'ECE 2nd Year');
    const { position } = await makePosition(pool, {
      collegeId, level: 4, title: 'Class Tutor', createdBy: tutorUserId,
    });

    assert.deepEqual(await classResolver.resolveMappedClasses(pool, position.id), []);

    const classAssignment = await positionRepository.createPositionClassAssignment(pool, {
      collegeId, positionId: position.id, classId, assignedBy: tutorUserId,
    });
    assert.deepEqual(await classResolver.resolveMappedClasses(pool, position.id), [classId]);

    await positionRepository.revokePositionClassAssignment(pool, classAssignment.id, { revokedBy: tutorUserId });
    assert.deepEqual(await classResolver.resolveMappedClasses(pool, position.id), []);
  });

  await t.test('assignmentResolver: resolves the current occupant, null once revoked', async () => {
    const collegeId = `idr${suffix}d`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const userId = await insertUser(pool, collegeId, 'occ1', 'hod');
    const { account } = await makePosition(pool, {
      collegeId, level: 3, title: 'HOD ECE', createdBy: userId,
    });

    assert.equal(await assignmentResolver.resolveCurrentOccupantUserId(pool, account.id), null);

    const occupant = await occupy(pool, { collegeId, accountId: account.id, userId });
    assert.equal(await assignmentResolver.resolveCurrentOccupantUserId(pool, account.id), userId);

    await positionRepository.revokePositionOccupant(pool, occupant.id, { revokedBy: userId });
    assert.equal(await assignmentResolver.resolveCurrentOccupantUserId(pool, account.id), null);
  });

  await t.test('visibilityResolver: Level 1 -> college scope, Level 3 -> department scope, no position -> self_assigned', async () => {
    const collegeId = `idr${suffix}e`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);

    const principalUserId = await insertUser(pool, collegeId, 'principal2', 'principal');
    const principalPosition = await makePosition(pool, {
      collegeId, level: 1, title: 'Principal', createdBy: principalUserId,
    });
    await occupy(pool, { collegeId, accountId: principalPosition.account.id, userId: principalUserId });
    const principalPositions = await positionResolver.resolveActivePositions(pool, { collegeId, userId: principalUserId });

    const principalScope = await visibilityResolver.resolveVisibilityScope(pool, {
      userId: principalUserId,
      positions: principalPositions,
      resolveDepartmentIds: (positionId) => departmentResolver.resolveMappedDepartments(pool, positionId),
    });
    assert.equal(principalScope.scopeLevel, SCOPE_LEVELS.COLLEGE);
    assert.deepEqual(principalScope.departmentIds, []);

    const hodUserId = await insertUser(pool, collegeId, 'hod2', 'hod');
    const deptId = await insertDepartment(pool, collegeId, 'ECE');
    const hodPosition = await makePosition(pool, {
      collegeId, level: 3, title: 'HOD ECE', createdBy: hodUserId,
    });
    await occupy(pool, { collegeId, accountId: hodPosition.account.id, userId: hodUserId });
    await positionRepository.createPositionDepartmentAssignment(pool, {
      collegeId, positionId: hodPosition.position.id, departmentId: deptId, assignedBy: hodUserId,
    });
    const hodPositions = await positionResolver.resolveActivePositions(pool, { collegeId, userId: hodUserId });

    const hodScope = await visibilityResolver.resolveVisibilityScope(pool, {
      userId: hodUserId,
      positions: hodPositions,
      resolveDepartmentIds: (positionId) => departmentResolver.resolveMappedDepartments(pool, positionId),
    });
    assert.equal(hodScope.scopeLevel, SCOPE_LEVELS.DEPARTMENT);
    assert.deepEqual(hodScope.departmentIds, [deptId]);

    const staffUserId = await insertUser(pool, collegeId, 'staff1', 'staff');
    const staffScope = await visibilityResolver.resolveVisibilityScope(pool, {
      userId: staffUserId,
      positions: [],
      resolveDepartmentIds: async () => [],
      resolveActiveClassTutorClassId: async () => null,
    });
    assert.equal(staffScope.scopeLevel, SCOPE_LEVELS.SELF_ASSIGNED);
    assert.deepEqual(staffScope.assignedClassIds, []);
  });

  await t.test('visibilityResolver: Level 2 falls back to self_assigned with no configured policy, department scope once Level 1 assigns one', async () => {
    const collegeId = `idr${suffix}e2`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);

    const level2UserId = await insertUser(pool, collegeId, 'level2user', 'staff');
    const level2Position = await makePosition(pool, {
      collegeId, level: 2, title: 'Vice Principal', createdBy: level2UserId,
    });
    await occupy(pool, { collegeId, accountId: level2Position.account.id, userId: level2UserId });
    const level2Positions = await positionResolver.resolveActivePositions(pool, { collegeId, userId: level2UserId });

    const unconfiguredScope = await visibilityResolver.resolveVisibilityScope(pool, {
      userId: level2UserId,
      positions: level2Positions,
      resolveDepartmentIds: (positionId) => departmentResolver.resolveMappedDepartments(pool, positionId),
      resolveActiveClassTutorClassId: async () => null,
    });
    assert.equal(unconfiguredScope.scopeLevel, SCOPE_LEVELS.SELF_ASSIGNED);

    const deptId = await insertDepartment(pool, collegeId, 'Dean Office');
    await positionRepository.createPositionDepartmentAssignment(pool, {
      collegeId, positionId: level2Position.position.id, departmentId: deptId, assignedBy: level2UserId,
    });
    const configuredScope = await visibilityResolver.resolveVisibilityScope(pool, {
      userId: level2UserId,
      positions: level2Positions,
      resolveDepartmentIds: (positionId) => departmentResolver.resolveMappedDepartments(pool, positionId),
    });
    assert.equal(configuredScope.scopeLevel, SCOPE_LEVELS.DEPARTMENT);
    assert.deepEqual(configuredScope.departmentIds, [deptId]);
  });

  await t.test('identityService.resolveCapabilities: composes all five resolvers into one comparable structure', async () => {
    const collegeId = `idr${suffix}f`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const principalUserId = await insertUser(pool, collegeId, 'principal3', 'principal');
    const { position, account } = await makePosition(pool, {
      collegeId, level: 1, title: 'Principal', createdBy: principalUserId,
    });
    await occupy(pool, { collegeId, accountId: account.id, userId: principalUserId });
    await positionRepository.createPositionModuleAssignment(pool, {
      collegeId, positionId: position.id, moduleKey: 'finance', assignedBy: principalUserId,
    });

    const capabilities = await identityService.resolveCapabilities(pool, { userId: principalUserId, collegeId });

    assert.equal(capabilities.effectiveRole, 'principal');
    assert.equal(capabilities.scopeLevel, SCOPE_LEVELS.COLLEGE);
    assert.equal(capabilities.positions.length, 1);
    assert.equal(capabilities.positions[0].positionId, position.id);
    assert.deepEqual(capabilities.positions[0].moduleKeys, ['finance']);
    assert.equal(capabilities.positions[0].currentOccupantUserId, principalUserId);
  });

  await t.test('identityService.resolveCapabilities: a user with no active position resolves as staff/self_assigned, not an error', async () => {
    const collegeId = `idr${suffix}g`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const userId = await insertUser(pool, collegeId, 'staff2', 'staff');

    const capabilities = await identityService.resolveCapabilities(pool, { userId, collegeId });
    assert.equal(capabilities.effectiveRole, 'staff');
    assert.equal(capabilities.scopeLevel, SCOPE_LEVELS.SELF_ASSIGNED);
    assert.deepEqual(capabilities.positions, []);
  });

  await t.test('identityService.resolvePositionOccupant: resolves a college-level slot and a department slot to their real occupants', async () => {
    const collegeId = `idr${suffix}h`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);

    const principalUserId = await insertUser(pool, collegeId, 'principal4', 'principal');
    const principalPosition = await makePosition(pool, {
      collegeId, level: 1, title: 'Principal', createdBy: principalUserId,
    });
    await occupy(pool, { collegeId, accountId: principalPosition.account.id, userId: principalUserId });

    const hodUserId = await insertUser(pool, collegeId, 'hod3', 'hod');
    const deptId = await insertDepartment(pool, collegeId, 'Mechanical');
    const hodPosition = await makePosition(pool, {
      collegeId, level: 3, title: 'HOD Mechanical', createdBy: hodUserId,
    });
    await occupy(pool, { collegeId, accountId: hodPosition.account.id, userId: hodUserId });
    await positionRepository.createPositionDepartmentAssignment(pool, {
      collegeId, positionId: hodPosition.position.id, departmentId: deptId, assignedBy: hodUserId,
    });

    const principalOccupant = await identityService.resolvePositionOccupant(pool, { collegeId, level: 1 });
    assert.equal(principalOccupant, principalUserId);

    const hodOccupant = await identityService.resolvePositionOccupant(pool, { collegeId, departmentId: deptId });
    assert.equal(hodOccupant, hodUserId);
  });

  await t.test('identityService.resolvePositionOccupant: returns null for a vacant/unprovisioned slot, never throws', async () => {
    const collegeId = `idr${suffix}i`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const deptId = await insertDepartment(pool, collegeId, 'Vacant Dept');

    const noPrincipal = await identityService.resolvePositionOccupant(pool, { collegeId, level: 1 });
    assert.equal(noPrincipal, null);

    const noHod = await identityService.resolvePositionOccupant(pool, { collegeId, departmentId: deptId });
    assert.equal(noHod, null);
  });

  // Phase 2 step 4 — the Institutional Identity Context's
  // resolveCapabilitiesForPosition, not wired to any middleware/route
  // yet. Proves decision 4: capabilities resolve for exactly the
  // queried Position Account, never unioned with any other position
  // the same occupant also holds.
  await t.test('identityService.resolveCapabilitiesForPosition: Level 1 -> principal/college, own moduleKeys only', async () => {
    const collegeId = `idr${suffix}j`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const principalUserId = await insertUser(pool, collegeId, 'principal5', 'principal');
    const { position, account } = await makePosition(pool, {
      collegeId, level: 1, title: 'Principal', createdBy: principalUserId,
    });
    await occupy(pool, { collegeId, accountId: account.id, userId: principalUserId });
    await positionRepository.createPositionModuleAssignment(pool, {
      collegeId, positionId: position.id, moduleKey: 'finance', assignedBy: principalUserId,
    });

    const capabilities = await identityService.resolveCapabilitiesForPosition(pool, { positionAccountId: account.id });

    assert.equal(capabilities.positionAccountId, account.id);
    assert.equal(capabilities.positionId, position.id);
    assert.equal(capabilities.level, 1);
    assert.equal(capabilities.positionType, null);
    assert.equal(capabilities.collegeId, collegeId);
    assert.equal(capabilities.currentOccupantUserId, principalUserId);
    assert.deepEqual(capabilities.moduleKeys, ['finance']);
    assert.deepEqual(capabilities.departmentIds, []);
    assert.deepEqual(capabilities.classIds, []);
    assert.equal(capabilities.effectiveRole, 'principal');
    assert.equal(capabilities.scopeLevel, 'college');
  });

  await t.test('identityService.resolveCapabilitiesForPosition: Level 2 -> level2/department', async () => {
    const collegeId = `idr${suffix}k`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const level2UserId = await insertUser(pool, collegeId, 'level2user2', 'staff');
    const deptId = await insertDepartment(pool, collegeId, 'Dean Office 2');
    const { position, account } = await makePosition(pool, {
      collegeId, level: 2, title: 'Vice Principal', createdBy: level2UserId,
    });
    await occupy(pool, { collegeId, accountId: account.id, userId: level2UserId });
    await positionRepository.createPositionDepartmentAssignment(pool, {
      collegeId, positionId: position.id, departmentId: deptId, assignedBy: level2UserId,
    });

    const capabilities = await identityService.resolveCapabilitiesForPosition(pool, { positionAccountId: account.id });
    assert.equal(capabilities.effectiveRole, 'level2');
    assert.equal(capabilities.scopeLevel, 'department');
    assert.deepEqual(capabilities.departmentIds, [deptId]);
  });

  await t.test('identityService.resolveCapabilitiesForPosition: Level 4 + position_type=class_tutor -> class_tutor/class, classIds now real (classResolver, Phase 2 step 8)', async () => {
    const collegeId = `idr${suffix}l`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const tutorUserId = await insertUser(pool, collegeId, 'tutor1', 'staff');
    const classId = await insertClass(pool, collegeId, 'ECE 2nd Year L');
    const { position, account } = await makePosition(pool, {
      collegeId, level: 4, title: 'Class Tutor', createdBy: tutorUserId,
    });
    await pool.query("UPDATE positions SET position_type = 'class_tutor' WHERE id = $1", [position.id]);
    await occupy(pool, { collegeId, accountId: account.id, userId: tutorUserId });
    await positionRepository.createPositionClassAssignment(pool, {
      collegeId, positionId: position.id, classId, assignedBy: tutorUserId,
    });

    const capabilities = await identityService.resolveCapabilitiesForPosition(pool, { positionAccountId: account.id });
    assert.equal(capabilities.positionType, 'class_tutor');
    assert.equal(capabilities.effectiveRole, 'class_tutor');
    assert.equal(capabilities.scopeLevel, 'class');
    assert.deepEqual(capabilities.classIds, [classId]);
  });

  await t.test('identityService.resolveCapabilitiesForPosition: throws PositionAccountNotFoundError for an unknown positionAccountId', async () => {
    await assert.rejects(
      () => identityService.resolveCapabilitiesForPosition(pool, { positionAccountId: crypto.randomUUID() }),
      identityService.PositionAccountNotFoundError,
    );
  });

  await t.test('identityService.resolveCapabilitiesForPosition: one occupant holding TWO positions gets each position\'s OWN scope, never unioned', async () => {
    const collegeId = `idr${suffix}m`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const deptId = await insertDepartment(pool, collegeId, 'Physics');
    const occupantUserId = await insertUser(pool, collegeId, 'dual1', 'staff');

    const principal = await makePosition(pool, {
      collegeId, level: 1, title: 'Principal', createdBy: occupantUserId,
    });
    await occupy(pool, { collegeId, accountId: principal.account.id, userId: occupantUserId });
    await positionRepository.createPositionModuleAssignment(pool, {
      collegeId, positionId: principal.position.id, moduleKey: 'academics', assignedBy: occupantUserId,
    });

    const hod = await makePosition(pool, {
      collegeId, level: 3, title: 'HOD Physics', createdBy: occupantUserId,
    });
    await occupy(pool, { collegeId, accountId: hod.account.id, userId: occupantUserId });
    await positionRepository.createPositionDepartmentAssignment(pool, {
      collegeId, positionId: hod.position.id, departmentId: deptId, assignedBy: occupantUserId,
    });

    const principalCapabilities = await identityService.resolveCapabilitiesForPosition(pool, {
      positionAccountId: principal.account.id,
    });
    assert.equal(principalCapabilities.effectiveRole, 'principal');
    assert.equal(principalCapabilities.scopeLevel, 'college');
    assert.deepEqual(principalCapabilities.moduleKeys, ['academics']);
    assert.deepEqual(principalCapabilities.departmentIds, []);

    const hodCapabilities = await identityService.resolveCapabilitiesForPosition(pool, {
      positionAccountId: hod.account.id,
    });
    assert.equal(hodCapabilities.effectiveRole, 'hod');
    assert.equal(hodCapabilities.scopeLevel, 'department');
    assert.deepEqual(hodCapabilities.departmentIds, [deptId]);
    assert.deepEqual(hodCapabilities.moduleKeys, []);
  });

  // Phase 2 step 9 — the {classId} overload on resolvePositionOccupant/
  // positionSlotResolver, and resolveActiveClassTutorPosition's reverse
  // (user -> their class) direction. Isolated: not consumed by any real
  // call site yet (that's group (c)).
  await t.test('identityService.resolvePositionOccupant: resolves a class slot to its active Class Tutor, null once vacant', async () => {
    const collegeId = `idr${suffix}n`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const tutorUserId = await insertUser(pool, collegeId, 'tutor2', 'staff');
    const classId = await insertClass(pool, collegeId, 'ECE 3rd Year');
    const { position, account } = await makePosition(pool, {
      collegeId, level: 4, title: 'Class Tutor', createdBy: tutorUserId,
    });
    await pool.query("UPDATE positions SET position_type = 'class_tutor' WHERE id = $1", [position.id]);
    await occupy(pool, { collegeId, accountId: account.id, userId: tutorUserId });

    const vacantSlot = await identityService.resolvePositionOccupant(pool, { collegeId, classId });
    assert.equal(vacantSlot, null);

    const classAssignment = await positionRepository.createPositionClassAssignment(pool, {
      collegeId, positionId: position.id, classId, assignedBy: tutorUserId,
    });
    const tutorOccupant = await identityService.resolvePositionOccupant(pool, { collegeId, classId });
    assert.equal(tutorOccupant, tutorUserId);

    await positionRepository.revokePositionClassAssignment(pool, classAssignment.id, { revokedBy: tutorUserId });
    const afterRevoke = await identityService.resolvePositionOccupant(pool, { collegeId, classId });
    assert.equal(afterRevoke, null);
  });

  await t.test('identityService.resolveActiveClassTutorPosition: resolves a user\'s active Class Tutor seat to its mapped class, null otherwise', async () => {
    const collegeId = `idr${suffix}o`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const tutorUserId = await insertUser(pool, collegeId, 'tutor3', 'staff');
    const plainStaffUserId = await insertUser(pool, collegeId, 'plainstaff1', 'staff');
    const classId = await insertClass(pool, collegeId, 'ECE 4th Year');
    const { position, account } = await makePosition(pool, {
      collegeId, level: 4, title: 'Class Tutor', createdBy: tutorUserId,
    });
    await pool.query("UPDATE positions SET position_type = 'class_tutor' WHERE id = $1", [position.id]);
    await occupy(pool, { collegeId, accountId: account.id, userId: tutorUserId });

    const beforeAssignment = await identityService.resolveActiveClassTutorPosition(pool, { userId: tutorUserId, collegeId });
    assert.equal(beforeAssignment, null);

    await positionRepository.createPositionClassAssignment(pool, {
      collegeId, positionId: position.id, classId, assignedBy: tutorUserId,
    });
    const afterAssignment = await identityService.resolveActiveClassTutorPosition(pool, { userId: tutorUserId, collegeId });
    assert.equal(afterAssignment, classId);

    const plainStaffResult = await identityService.resolveActiveClassTutorPosition(pool, { userId: plainStaffUserId, collegeId });
    assert.equal(plainStaffResult, null);
  });

  // 4-login authorization architecture (2026-08-09): superseded the
  // Phase 2 step 12 version of this test, which asserted the OPPOSITE
  // — that a personal login's assignedClassIds included the tutor-of-
  // record class. That merge is exactly what this architecture
  // removes: Position Occupancy ("A" — this person currently occupies
  // the L4 seat) must never widen a personal Staff login's
  // (resolveCapabilities') scope, only the L4 Position Account login
  // itself (resolveCapabilitiesForPosition, covered above) may carry
  // class_tutor scope. resolveActiveClassTutorPosition remains correct
  // and unchanged — it's the function's use inside resolveCapabilities
  // that was removed, not the function itself (see identityService.
  // getOwnProfile's own is_class_tutor display use, elsewhere).
  await t.test('identityService.resolveCapabilities: assignedClassIds does NOT include an active Class Tutor position (personal login stays Staff-scoped only)', async () => {
    const collegeId = `idr${suffix}p`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const tutorUserId = await insertUser(pool, collegeId, 'tutor4', 'staff');
    const classId = await insertClass(pool, collegeId, 'ECE 5th Year');
    const { position, account } = await makePosition(pool, {
      collegeId, level: 4, title: 'Class Tutor', createdBy: tutorUserId,
    });
    await pool.query("UPDATE positions SET position_type = 'class_tutor' WHERE id = $1", [position.id]);
    await occupy(pool, { collegeId, accountId: account.id, userId: tutorUserId });
    await positionRepository.createPositionClassAssignment(pool, {
      collegeId, positionId: position.id, classId, assignedBy: tutorUserId,
    });

    // Position Occupancy is still correctly resolvable (informational)...
    const tutorClassId = await identityService.resolveActiveClassTutorPosition(pool, { userId: tutorUserId, collegeId });
    assert.equal(tutorClassId, classId);

    // ...but this same person's PERSONAL login gets none of it.
    const capabilities = await identityService.resolveCapabilities(pool, { userId: tutorUserId, collegeId });
    assert.equal(capabilities.scopeLevel, SCOPE_LEVELS.SELF_ASSIGNED);
    assert.deepEqual(capabilities.assignedClassIds, []);
  });
});
