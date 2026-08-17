'use strict';

// Query mechanics for `structural_authorization_keys` only — no
// business logic (see services/platformService.js). Same cross-boundary
// shape as principalInvitationRepository.js: generate/cancel run
// against a tenant-role connection (arcnave_app, L1's own login);
// redeem runs against platformPool (arcnave_platform). Postgres GRANTs
// on the table itself (see the migration), not this file, are what
// actually enforce which side may do what.

async function createKey(client, {
  collegeId, actionType, actionPayload, tokenHash, generatedBy, expiresAt,
}) {
  const result = await client.query(
    `INSERT INTO structural_authorization_keys
       (college_id, action_type, action_payload, token_hash, generated_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, college_id, action_type, action_payload, status, generated_by, generated_at, expires_at`,
    [collegeId, actionType, JSON.stringify(actionPayload), tokenHash, generatedBy, expiresAt],
  );
  return result.rows[0];
}

// generateKey's own "invalidate any prior unused key" step (RS-GOV-006):
// only ever touches this college's own still-`generated` rows, never a
// key already cancelled/expired/redeemed.
async function cancelAllGeneratedForCollege(client, collegeId) {
  await client.query(
    `UPDATE structural_authorization_keys SET status = 'cancelled', cancelled_at = now()
     WHERE college_id = $1 AND status = 'generated'`,
    [collegeId],
  );
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM structural_authorization_keys WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findByTokenHash(pool, tokenHash) {
  const result = await pool.query(
    'SELECT * FROM structural_authorization_keys WHERE token_hash = $1',
    [tokenHash],
  );
  return result.rows[0] || null;
}

// Same "WHERE guard is the real backstop" discipline as
// principalInvitationRepository's revokeInvitation: a concurrent
// redeem racing this call means zero rows come back, never a silent
// re-cancel of an already-redeemed key.
async function cancelKey(client, id) {
  const result = await client.query(
    `UPDATE structural_authorization_keys SET status = 'cancelled', cancelled_at = now()
     WHERE id = $1 AND status = 'generated'
     RETURNING id, college_id, action_type, status, cancelled_at`,
    [id],
  );
  return result.rows[0] || null;
}

// Same WHERE-guard shape, from the platform side: only a still-
// `generated`, unexpired key redeems. Whoever calls this has already
// checked action_type matches what the caller intends to execute.
async function redeemKey(pool, id, { redeemedBy }) {
  const result = await pool.query(
    `UPDATE structural_authorization_keys SET status = 'redeemed', redeemed_by = $2, redeemed_at = now()
     WHERE id = $1 AND status = 'generated' AND expires_at > now()
     RETURNING id, college_id, action_type, action_payload, status, redeemed_at`,
    [id, redeemedBy],
  );
  return result.rows[0] || null;
}

module.exports = {
  createKey,
  cancelAllGeneratedForCollege,
  findById,
  findByTokenHash,
  cancelKey,
  redeemKey,
};
