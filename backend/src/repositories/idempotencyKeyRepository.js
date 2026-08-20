'use strict';

// Query mechanics for `idempotency_keys` only — no business logic
// (that's aiService.js's invokeToolIdempotent, CLAUDE.md rule 1). See
// the migration's own file-level comment for why this table has no
// status column and why the UNIQUE constraint alone is what makes
// concurrent duplicate reservations safe.

// 23505 = unique_violation. Callers use this to distinguish "this key
// is genuinely new" from "a request with this key already ran (or is
// running right now, in which case this INSERT blocked until it
// resolved one way or the other)".
const UNIQUE_VIOLATION = '23505';

async function reserve(client, {
  collegeId, userId, idempotencyKey, toolName, paramsHash,
}) {
  const result = await client.query(
    `INSERT INTO idempotency_keys (college_id, user_id, idempotency_key, tool_name, params_hash)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [collegeId, userId, idempotencyKey, toolName, paramsHash],
  );
  return result.rows[0];
}

async function findByKey(client, { collegeId, userId, idempotencyKey }) {
  const result = await client.query(
    `SELECT * FROM idempotency_keys
     WHERE college_id = $1 AND user_id = $2 AND idempotency_key = $3`,
    [collegeId, userId, idempotencyKey],
  );
  return result.rows[0] || null;
}

async function markCompleted(client, id, responseBody) {
  await client.query(
    'UPDATE idempotency_keys SET response_body = $2 WHERE id = $1',
    [id, JSON.stringify(responseBody)],
  );
}

module.exports = { UNIQUE_VIOLATION, reserve, findByKey, markCompleted };
