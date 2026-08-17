'use strict';

// Query mechanics for `user_mfa_otps` only — no business logic
// (hashing, expiry/attempt checks, which row counts as "active" — all
// authService.js's job). Same shape and split as
// studentPhoneOtpRepository.js, just keyed by user_id instead of
// student_id+target (a user has exactly one MFA channel — their own
// email — so there is no target column to disambiguate here).
//
// findLatestActive filters unconsumed AND unexpired rows and orders by
// created_at DESC — "the most recent challenge still worth checking a
// code against" is a query concern, not a business rule, same split as
// studentPhoneOtpRepository's own findLatestActive.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['userId', 'user_id'],
  ['codeHash', 'code_hash'],
  ['expiresAt', 'expires_at'],
  ['consumedAt', 'consumed_at'],
  ['attempts', 'attempts'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO user_mfa_otps (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM user_mfa_otps WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findLatestActive(client, userId) {
  const result = await client.query(
    `SELECT * FROM user_mfa_otps
     WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );
  return result.rows[0] || null;
}

async function incrementAttempts(client, id) {
  const result = await client.query(
    `UPDATE user_mfa_otps SET attempts = attempts + 1, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

async function markConsumed(client, id) {
  const result = await client.query(
    `UPDATE user_mfa_otps SET consumed_at = now(), updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

module.exports = {
  create,
  findById,
  findLatestActive,
  incrementAttempts,
  markConsumed,
};
