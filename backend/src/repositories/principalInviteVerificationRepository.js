'use strict';

// Query mechanics for `principal_invite_verifications` only — no
// business logic (code generation/hashing, expiry/attempt checks —
// platformService.js's job). Same shape/split as userMfaOtpRepository.js,
// just keyed by (college_id, email) instead of user_id since there is
// no user row yet at this point in the flow.

async function create(pool, { collegeId, email, codeHash, expiresAt }) {
  const result = await pool.query(
    `INSERT INTO principal_invite_verifications (college_id, email, code_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [collegeId, email, codeHash, expiresAt],
  );
  return result.rows[0];
}

async function findLatestActive(pool, { collegeId, email }) {
  const result = await pool.query(
    `SELECT * FROM principal_invite_verifications
     WHERE college_id = $1 AND email = $2 AND consumed_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [collegeId, email],
  );
  return result.rows[0] || null;
}

async function incrementAttempts(pool, id) {
  const result = await pool.query(
    'UPDATE principal_invite_verifications SET attempts = attempts + 1 WHERE id = $1 RETURNING *',
    [id],
  );
  return result.rows[0] || null;
}

async function markConsumed(pool, id) {
  const result = await pool.query(
    'UPDATE principal_invite_verifications SET consumed_at = now() WHERE id = $1 RETURNING *',
    [id],
  );
  return result.rows[0] || null;
}

module.exports = {
  create,
  findLatestActive,
  incrementAttempts,
  markConsumed,
};
