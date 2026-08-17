'use strict';

// Query mechanics for `position_account_mfa_otps` only — no business
// logic (hashing, expiry/attempt checks — positionAccountAuthService.js's
// job). Mirrors userMfaOtpRepository.js exactly, keyed by
// position_account_id instead of user_id.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['positionAccountId', 'position_account_id'],
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
    `INSERT INTO position_account_mfa_otps (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM position_account_mfa_otps WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function incrementAttempts(client, id) {
  const result = await client.query(
    `UPDATE position_account_mfa_otps SET attempts = attempts + 1, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

async function markConsumed(client, id) {
  const result = await client.query(
    `UPDATE position_account_mfa_otps SET consumed_at = now(), updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

module.exports = {
  create,
  findById,
  incrementAttempts,
  markConsumed,
};
