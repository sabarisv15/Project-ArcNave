'use strict';

// Query mechanics for `wizard_email_verifications` only — no business
// logic (platformService.js's job). Same shape as
// principalInviteVerificationRepository.js, minus college_id: this
// challenge exists before any college row does, keyed by email alone.

async function create(pool, { email, codeHash, expiresAt }) {
  const result = await pool.query(
    `INSERT INTO wizard_email_verifications (email, code_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [email, codeHash, expiresAt],
  );
  return result.rows[0];
}

async function findLatestActive(pool, { email }) {
  const result = await pool.query(
    `SELECT * FROM wizard_email_verifications
     WHERE email = $1 AND consumed_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [email],
  );
  return result.rows[0] || null;
}

async function incrementAttempts(pool, id) {
  const result = await pool.query(
    'UPDATE wizard_email_verifications SET attempts = attempts + 1 WHERE id = $1 RETURNING *',
    [id],
  );
  return result.rows[0] || null;
}

async function markConsumed(pool, id) {
  const result = await pool.query(
    'UPDATE wizard_email_verifications SET consumed_at = now() WHERE id = $1 RETURNING *',
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
