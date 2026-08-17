'use strict';

// Repository-level coverage for positionAccountInvitationService's
// ensureClassTutorPositionForInvite (Phase 2 step 10) — real Postgres
// via MIGRATION_DATABASE_URL, same fixture pattern
// position-account-invitation-repository.test.js already uses. Isolated:
// this function is not yet called from inviteToPosition (plan step 18).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const positionAccountInvitationService = require('../src/services/positionAccountInvitationService');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;

async function seedFixtures(pool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeId = `ctp${suffix}`;
  await pool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $1)', [collegeId]);
  const userResult = await pool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'hod1', 'hod1@example.com', 'x', 'hod', true) RETURNING id`,
    [collegeId],
  );
  const classResult = await pool.query(
    'INSERT INTO classes (college_id, class_name) VALUES ($1, $2) RETURNING id',
    [collegeId, 'ECE 2nd Year CTP'],
  );
  return { collegeId, hodUserId: userResult.rows[0].id, classId: classResult.rows[0].id };
}

async function cleanupFixtures(pool, collegeId) {
  await pool.query('DELETE FROM position_class_assignments WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM position_accounts WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM positions WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM classes WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM users WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM colleges WHERE college_id = $1', [collegeId]);
}

test('positionAccountInvitationService.ensureClassTutorPositionForInvite (Phase 2 step 10)', async (t) => {
  const pool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const fixtures = await seedFixtures(pool);

  t.after(async () => {
    await cleanupFixtures(pool, fixtures.collegeId);
    await pool.end();
  });

  await t.test('provisions a Level 4 position_type=class_tutor position and its class assignment', async () => {
    const position = await positionAccountInvitationService.ensureClassTutorPositionForInvite(pool, {
      collegeId: fixtures.collegeId, classId: fixtures.classId, createdBy: fixtures.hodUserId,
    });
    assert.equal(position.level, 4);
    assert.equal(position.position_type, 'class_tutor');

    const assignment = await pool.query(
      'SELECT * FROM position_class_assignments WHERE class_id = $1 AND revoked_at IS NULL',
      [fixtures.classId],
    );
    assert.equal(assignment.rows.length, 1);
    assert.equal(assignment.rows[0].position_id, position.id);
  });

  await t.test('is idempotent — a second call for the same class returns the SAME position, no duplicate row', async () => {
    const first = await positionAccountInvitationService.ensureClassTutorPositionForInvite(pool, {
      collegeId: fixtures.collegeId, classId: fixtures.classId, createdBy: fixtures.hodUserId,
    });
    const second = await positionAccountInvitationService.ensureClassTutorPositionForInvite(pool, {
      collegeId: fixtures.collegeId, classId: fixtures.classId, createdBy: fixtures.hodUserId,
    });
    assert.equal(second.id, first.id);

    const assignments = await pool.query(
      'SELECT * FROM position_class_assignments WHERE class_id = $1 AND revoked_at IS NULL',
      [fixtures.classId],
    );
    assert.equal(assignments.rows.length, 1);
  });
});
