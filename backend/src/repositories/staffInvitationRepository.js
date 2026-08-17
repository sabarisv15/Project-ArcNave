'use strict';

// Query mechanics for `staff_invitations` only — no business logic
// (staffService.js owns invite creation and acceptance). Same minimal
// shape as principalInvitationRepository.js/positionAccountInvitationRepository.js:
// create, look up by token, mark accepted. No resend/revoke/list —
// RS-STF-001/002 don't call for them, and this codebase adds those only
// once a real caller needs them (same restraint DEFAULT_CHAINS' own
// header comment applies to retrofits).

async function createInvitation(client, {
  collegeId, departmentId, email, tokenHash, invitedBy, expiresAt,
}) {
  const result = await client.query(
    `INSERT INTO staff_invitations (college_id, department_id, email, token_hash, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, college_id, department_id, email, expires_at, created_at`,
    [collegeId, departmentId, email, tokenHash, invitedBy, expiresAt],
  );
  return result.rows[0];
}

async function getInvitationByTokenHash(client, tokenHash) {
  const result = await client.query(
    `SELECT id, college_id, department_id, email, expires_at, accepted_at
     FROM staff_invitations WHERE token_hash = $1`,
    [tokenHash],
  );
  return result.rows[0] || null;
}

async function markInvitationAccepted(client, invitationId) {
  const result = await client.query(
    'UPDATE staff_invitations SET accepted_at = now() WHERE id = $1 AND accepted_at IS NULL',
    [invitationId],
  );
  return result.rowCount > 0;
}

module.exports = {
  createInvitation,
  getInvitationByTokenHash,
  markInvitationAccepted,
};
