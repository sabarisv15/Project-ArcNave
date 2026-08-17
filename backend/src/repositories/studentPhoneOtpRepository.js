'use strict';

// Query mechanics for `student_phone_otps` only — no business logic
// (hashing, expiry/attempt checks, which row counts as "active" — all
// phoneVerificationService.js's job, same split every other repository
// in this codebase keeps). Tenant scoping for id-keyed lookups relies
// on the table's RLS policy, same as studentRepository.js.
//
// findLatestActive filters unconsumed AND unexpired rows and orders by
// created_at DESC — "the most recent OTP still worth checking a code
// against" is a query concern (which row), not a business rule (what
// to do once you have it), same split as workflowRepository's own
// findPendingForEntity.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['studentId', 'student_id'],
  ['target', 'target'],
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
    `INSERT INTO student_phone_otps (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM student_phone_otps WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findLatestActive(client, studentId, target) {
  const result = await client.query(
    `SELECT * FROM student_phone_otps
     WHERE student_id = $1 AND target = $2 AND consumed_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [studentId, target],
  );
  return result.rows[0] || null;
}

async function incrementAttempts(client, id) {
  const result = await client.query(
    `UPDATE student_phone_otps SET attempts = attempts + 1, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

async function markConsumed(client, id) {
  const result = await client.query(
    `UPDATE student_phone_otps SET consumed_at = now(), updated_at = now()
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
