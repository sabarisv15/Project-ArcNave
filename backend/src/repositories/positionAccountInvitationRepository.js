'use strict';

// Query mechanics for `position_account_invitations` only — no
// business logic (see services/positionAccountInvitationService.js for
// the recursive invite-guard and accept flow). Mirrors
// principalInvitationRepository.js's shape closely, with one real
// difference: createInvitation/getInvitationByTokenHash/
// markInvitationAccepted/revokeInvitation here can all run against
// EITHER an arcnave_app or arcnave_platform connection (see the
// migration's own header comment for why) — this file makes no
// assumption about which; that's the caller's concern.

async function createInvitation(
  client,
  { collegeId, positionId, level, positionType, email, tokenHash, createdBy, expiresAt },
) {
  const result = await client.query(
    `INSERT INTO position_account_invitations
       (college_id, position_id, level, position_type, email, token_hash, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, college_id, position_id, level, position_type, email, expires_at, created_at`,
    [collegeId, positionId, level, positionType, email, tokenHash, createdBy, expiresAt],
  );
  return result.rows[0];
}

async function getInvitationByTokenHash(client, tokenHash) {
  const result = await client.query(
    `SELECT id, college_id, position_id, level, position_type, email, expires_at, accepted_at, revoked_at
     FROM position_account_invitations WHERE token_hash = $1`,
    [tokenHash],
  );
  return result.rows[0] || null;
}

async function getInvitationById(client, invitationId) {
  const result = await client.query(
    `SELECT id, college_id, position_id, level, position_type, email, expires_at, accepted_at, revoked_at, created_at
     FROM position_account_invitations WHERE id = $1`,
    [invitationId],
  );
  return result.rows[0] || null;
}

async function markInvitationAccepted(client, invitationId) {
  const result = await client.query(
    'UPDATE position_account_invitations SET accepted_at = now() WHERE id = $1 AND accepted_at IS NULL',
    [invitationId],
  );
  return result.rowCount > 0;
}

// Same WHERE-guard reasoning as principalInvitationRepository.revokeInvitation:
// an already-accepted or already-revoked invitation is simply not
// touched (null returned), never silently re-revoked.
async function revokeInvitation(client, invitationId) {
  const result = await client.query(
    `UPDATE position_account_invitations SET revoked_at = now()
     WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
     RETURNING id, college_id, position_id, email, revoked_at`,
    [invitationId],
  );
  return result.rows[0] || null;
}

// Same "rotate token_hash/expires_at on the same row" reasoning as
// principalInvitationRepository.resendInvitation — repo-layer support
// built now per the plan (cheap); no route/UI exposure yet.
async function resendInvitation(client, invitationId, { tokenHash, expiresAt }) {
  const result = await client.query(
    `UPDATE position_account_invitations SET token_hash = $2, expires_at = $3
     WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
     RETURNING id, college_id, position_id, email, expires_at, created_at`,
    [invitationId, tokenHash, expiresAt],
  );
  return result.rows[0] || null;
}

async function listInvitationsForPosition(client, positionId) {
  const result = await client.query(
    `SELECT id, college_id, position_id, level, position_type, email, expires_at, accepted_at, revoked_at, created_at
     FROM position_account_invitations WHERE position_id = $1
     ORDER BY created_at DESC`,
    [positionId],
  );
  return result.rows;
}

module.exports = {
  createInvitation,
  getInvitationByTokenHash,
  getInvitationById,
  markInvitationAccepted,
  revokeInvitation,
  resendInvitation,
  listInvitationsForPosition,
};
