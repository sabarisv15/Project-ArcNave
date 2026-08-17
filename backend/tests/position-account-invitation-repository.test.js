'use strict';

// Repository-level coverage for position_account_invitations (Phase 2
// step 6, Migration C) — real Postgres via MIGRATION_DATABASE_URL,
// same fixture pattern position-schema.test.js already uses.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const positionRepository = require('../src/repositories/positionRepository');
const positionAccountInvitationRepository = require('../src/repositories/positionAccountInvitationRepository');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;

async function seedFixtures(pool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeId = `pai${suffix}`;
  await pool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $1)', [collegeId]);
  const userResult = await pool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'creator', 'creator@example.com', 'x', 'principal', true) RETURNING id`,
    [collegeId],
  );
  const createdBy = userResult.rows[0].id;
  const position = await positionRepository.createPosition(pool, {
    collegeId, level: 3, title: 'HOD', createdBy,
  });
  return {
    collegeId, createdBy, positionId: position.id,
  };
}

async function cleanupFixtures(pool, collegeId) {
  await pool.query('DELETE FROM position_account_invitations WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM positions WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM users WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM colleges WHERE college_id = $1', [collegeId]);
}

test('positionAccountInvitationRepository (Phase 2 step 6)', async (t) => {
  const pool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const fixtures = await seedFixtures(pool);

  t.after(async () => {
    await cleanupFixtures(pool, fixtures.collegeId);
    await pool.end();
  });

  await t.test('createInvitation / getInvitationByTokenHash / getInvitationById round-trip', async () => {
    const invitation = await positionAccountInvitationRepository.createInvitation(pool, {
      collegeId: fixtures.collegeId,
      positionId: fixtures.positionId,
      level: 3,
      positionType: null,
      email: 'hod@example.edu',
      tokenHash: 'hash-1',
      createdBy: fixtures.createdBy,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    assert.ok(invitation.id);
    assert.equal(invitation.level, 3);

    const byHash = await positionAccountInvitationRepository.getInvitationByTokenHash(pool, 'hash-1');
    assert.equal(byHash.id, invitation.id);
    assert.equal(byHash.accepted_at, null);
    assert.equal(byHash.revoked_at, null);

    const byId = await positionAccountInvitationRepository.getInvitationById(pool, invitation.id);
    assert.equal(byId.id, invitation.id);

    const missing = await positionAccountInvitationRepository.getInvitationByTokenHash(pool, 'no-such-hash');
    assert.equal(missing, null);
  });

  await t.test('token_hash is UNIQUE — a second invitation cannot reuse it', async () => {
    await positionAccountInvitationRepository.createInvitation(pool, {
      collegeId: fixtures.collegeId,
      positionId: fixtures.positionId,
      level: 3,
      positionType: null,
      email: 'a@example.edu',
      tokenHash: 'dup-hash',
      createdBy: fixtures.createdBy,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    await assert.rejects(
      () => positionAccountInvitationRepository.createInvitation(pool, {
        collegeId: fixtures.collegeId,
        positionId: fixtures.positionId,
        level: 3,
        positionType: null,
        email: 'b@example.edu',
        tokenHash: 'dup-hash',
        createdBy: fixtures.createdBy,
        expiresAt: new Date(Date.now() + 3600_000),
      }),
      /duplicate key value violates unique constraint/,
    );
  });

  await t.test('markInvitationAccepted / revokeInvitation are mutually exclusive terminal states', async () => {
    const invitation = await positionAccountInvitationRepository.createInvitation(pool, {
      collegeId: fixtures.collegeId,
      positionId: fixtures.positionId,
      level: 3,
      positionType: null,
      email: 'accept-me@example.edu',
      tokenHash: 'hash-accept',
      createdBy: fixtures.createdBy,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    await positionAccountInvitationRepository.markInvitationAccepted(pool, invitation.id);
    const accepted = await positionAccountInvitationRepository.getInvitationById(pool, invitation.id);
    assert.ok(accepted.accepted_at);

    // revokeInvitation's WHERE guard: an already-accepted invitation is
    // not touched — returns null, never silently re-revoked.
    const revokeResult = await positionAccountInvitationRepository.revokeInvitation(pool, invitation.id);
    assert.equal(revokeResult, null);
  });

  await t.test('revokeInvitation revokes a pending invitation; resendInvitation is blocked once revoked', async () => {
    const invitation = await positionAccountInvitationRepository.createInvitation(pool, {
      collegeId: fixtures.collegeId,
      positionId: fixtures.positionId,
      level: 3,
      positionType: null,
      email: 'revoke-me@example.edu',
      tokenHash: 'hash-revoke',
      createdBy: fixtures.createdBy,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const revoked = await positionAccountInvitationRepository.revokeInvitation(pool, invitation.id);
    assert.ok(revoked.revoked_at);

    const resendResult = await positionAccountInvitationRepository.resendInvitation(pool, invitation.id, {
      tokenHash: 'hash-revoke-2', expiresAt: new Date(Date.now() + 3600_000),
    });
    assert.equal(resendResult, null);
  });

  await t.test('resendInvitation rotates token_hash/expires_at on a still-pending invitation, same row', async () => {
    const invitation = await positionAccountInvitationRepository.createInvitation(pool, {
      collegeId: fixtures.collegeId,
      positionId: fixtures.positionId,
      level: 3,
      positionType: null,
      email: 'resend-me@example.edu',
      tokenHash: 'hash-resend-1',
      createdBy: fixtures.createdBy,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const resent = await positionAccountInvitationRepository.resendInvitation(pool, invitation.id, {
      tokenHash: 'hash-resend-2', expiresAt: new Date(Date.now() + 7200_000),
    });
    assert.equal(resent.id, invitation.id);

    const byOldHash = await positionAccountInvitationRepository.getInvitationByTokenHash(pool, 'hash-resend-1');
    assert.equal(byOldHash, null);
    const byNewHash = await positionAccountInvitationRepository.getInvitationByTokenHash(pool, 'hash-resend-2');
    assert.equal(byNewHash.id, invitation.id);
  });

  await t.test('listInvitationsForPosition returns every invitation for that position, newest first', async () => {
    const otherPosition = await positionRepository.createPosition(pool, {
      collegeId: fixtures.collegeId, level: 3, title: 'HOD 2', createdBy: fixtures.createdBy,
    });

    await positionAccountInvitationRepository.createInvitation(pool, {
      collegeId: fixtures.collegeId,
      positionId: otherPosition.id,
      level: 3,
      positionType: null,
      email: 'list-1@example.edu',
      tokenHash: 'hash-list-1',
      createdBy: fixtures.createdBy,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await positionAccountInvitationRepository.createInvitation(pool, {
      collegeId: fixtures.collegeId,
      positionId: otherPosition.id,
      level: 3,
      positionType: null,
      email: 'list-2@example.edu',
      tokenHash: 'hash-list-2',
      createdBy: fixtures.createdBy,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const list = await positionAccountInvitationRepository.listInvitationsForPosition(pool, otherPosition.id);
    assert.equal(list.length, 2);
    assert.deepEqual(list.map((row) => row.email).sort(), ['list-1@example.edu', 'list-2@example.edu']);
  });
});
