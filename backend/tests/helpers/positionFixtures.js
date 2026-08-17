'use strict';

// Phase 1 (Capability Resolver integration): every visibility/
// authorization/workflow check now resolves a user's standing through
// Position/Position Account/Occupant (identityService.resolveCapabilities),
// not users.role directly. Tests across this suite that seed a raw
// 'principal'/'hod' user via direct SQL (bypassing
// authService.acceptInvitation / staffService.provisionHodAccount,
// which provision these rows in the real app) need the equivalent
// Position rows too, or that user resolves as an ordinary,
// no-position staff member. Shared here instead of duplicated per
// file, once the same ~20-line block showed up in enough test files
// to be worth one source of truth.

async function seedPrincipalPosition(adminPool, { collegeId, userId, passwordHash = 'x' }) {
  const position = await adminPool.query(
    `INSERT INTO positions (college_id, level, title, created_by)
     VALUES ($1, 1, 'Principal', $2) RETURNING id`,
    [collegeId, userId],
  );
  const account = await adminPool.query(
    `INSERT INTO position_accounts (college_id, position_id, official_email, password_hash)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [collegeId, position.rows[0].id, `principal-position-${position.rows[0].id}@positions.test`, passwordHash],
  );
  await adminPool.query(
    `INSERT INTO position_occupants (college_id, position_account_id, user_id, assigned_by)
     VALUES ($1, $2, $3, $3)`,
    [collegeId, account.rows[0].id, userId],
  );
  return { positionId: position.rows[0].id, accountId: account.rows[0].id };
}

async function seedHodPosition(adminPool, {
  collegeId, userId, departmentId, passwordHash = 'x',
}) {
  const position = await adminPool.query(
    `INSERT INTO positions (college_id, level, title, created_by)
     VALUES ($1, 3, 'HOD', $2) RETURNING id`,
    [collegeId, userId],
  );
  const account = await adminPool.query(
    `INSERT INTO position_accounts (college_id, position_id, official_email, password_hash)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [collegeId, position.rows[0].id, `hod-position-${position.rows[0].id}@positions.test`, passwordHash],
  );
  await adminPool.query(
    `INSERT INTO position_department_assignments (college_id, position_id, department_id, assigned_by)
     VALUES ($1, $2, $3, $4)`,
    [collegeId, position.rows[0].id, departmentId, userId],
  );
  await adminPool.query(
    `INSERT INTO position_occupants (college_id, position_account_id, user_id, assigned_by)
     VALUES ($1, $2, $3, $3)`,
    [collegeId, account.rows[0].id, userId],
  );
  return { positionId: position.rows[0].id, accountId: account.rows[0].id };
}

// Phase 2 step 19: mirrors seedHodPosition exactly, one level down —
// Level 4 + position_type='class_tutor', keyed by classId instead of
// departmentId. Every test that used to seed classes.tutor_user_id
// directly (bypassing classTutorService.assignClassTutor, which
// provisions this same shape in the real app) needs this instead, or
// the user resolves as an ordinary, no-position staff member and every
// tutor-reading call site (identityService.resolvePositionOccupant/
// resolveActiveClassTutorPosition) sees no tutor at all.
async function seedClassTutorPosition(adminPool, {
  collegeId, userId, classId, passwordHash = 'x',
}) {
  const position = await adminPool.query(
    `INSERT INTO positions (college_id, level, title, created_by, position_type)
     VALUES ($1, 4, 'Class Tutor', $2, 'class_tutor') RETURNING id`,
    [collegeId, userId],
  );
  const officialEmail = `class-tutor-position-${position.rows[0].id}@positions.test`;
  const account = await adminPool.query(
    `INSERT INTO position_accounts (college_id, position_id, official_email, password_hash)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [collegeId, position.rows[0].id, officialEmail, passwordHash],
  );
  await adminPool.query(
    `INSERT INTO position_class_assignments (college_id, position_id, class_id, assigned_by)
     VALUES ($1, $2, $3, $4)`,
    [collegeId, position.rows[0].id, classId, userId],
  );
  await adminPool.query(
    `INSERT INTO position_occupants (college_id, position_account_id, user_id, assigned_by)
     VALUES ($1, $2, $3, $3)`,
    [collegeId, account.rows[0].id, userId],
  );
  // officialEmail/plaintext-password pair exposed so a test can log
  // into this L4 seat directly (POST /position-accounts/login) —
  // needed by the 4-login authorization architecture's own regression
  // coverage (Current Login Identity vs Position Occupancy), not just
  // the DB-row occupancy fixture the rest of this file's callers use.
  return {
    positionId: position.rows[0].id, accountId: account.rows[0].id, officialEmail,
  };
}

// Run before deleting departments/classes/users/staff —
// position_occupants/position_department_assignments/
// position_class_assignments FK into all three.
async function cleanupPositionRows(adminPool, collegeId) {
  await adminPool.query('DELETE FROM position_account_invitations WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM position_account_refresh_tokens WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM position_occupants WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM position_module_assignments WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM position_department_assignments WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM position_class_assignments WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM position_accounts WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM positions WHERE college_id = $1', [collegeId]);
}

module.exports = {
  seedPrincipalPosition, seedHodPosition, seedClassTutorPosition, cleanupPositionRows,
};
