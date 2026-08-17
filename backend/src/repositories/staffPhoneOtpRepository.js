'use strict';

// Query mechanics for `staff_phone_otps` only — mirrors
// studentPhoneOtpRepository.js exactly, minus the `target` column
// (staff has exactly one phone field to verify, no parent-phone
// equivalent).

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['staffId', 'staff_id'],
  ['phone', 'phone'],
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
    `INSERT INTO staff_phone_otps (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM staff_phone_otps WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findLatestActive(client, staffId) {
  const result = await client.query(
    `SELECT * FROM staff_phone_otps
     WHERE staff_id = $1 AND consumed_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [staffId],
  );
  return result.rows[0] || null;
}

async function incrementAttempts(client, id) {
  const result = await client.query(
    `UPDATE staff_phone_otps SET attempts = attempts + 1, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

async function markConsumed(client, id) {
  const result = await client.query(
    `UPDATE staff_phone_otps SET consumed_at = now(), updated_at = now()
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
