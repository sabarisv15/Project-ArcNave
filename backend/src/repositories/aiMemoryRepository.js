'use strict';

// Query mechanics for ai_memory_consent + ai_scoped_memory only — see the
// migration's own comment for why these are two separate tables rather
// than folded into the existing user_preferences store. Every function is
// scoped by userId, same "no tenant-only read" reasoning
// userPreferenceRepository already documents — a person's own AI memory is
// private to them, not a tenant-wide list.

async function getConsent(client, userId) {
  const result = await client.query('SELECT * FROM ai_memory_consent WHERE user_id = $1', [userId]);
  return result.rows[0] || null;
}

async function upsertConsent(client, { collegeId, userId, consented }) {
  const result = await client.query(
    `INSERT INTO ai_memory_consent (college_id, user_id, consented, consented_at)
     VALUES ($1, $2, $3, CASE WHEN $3 THEN now() ELSE NULL END)
     ON CONFLICT (user_id)
     DO UPDATE SET consented = EXCLUDED.consented,
                    consented_at = CASE WHEN EXCLUDED.consented THEN now() ELSE NULL END,
                    updated_at = now()
     RETURNING *`,
    [collegeId, userId, consented],
  );
  return result.rows[0];
}

async function upsertMemory(client, { collegeId, userId, memoryType, value }) {
  const result = await client.query(
    `INSERT INTO ai_scoped_memory (college_id, user_id, memory_type, value)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, memory_type)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     RETURNING *`,
    [collegeId, userId, memoryType, JSON.stringify(value)],
  );
  return result.rows[0];
}

async function listMemoryByUser(client, userId) {
  const result = await client.query('SELECT * FROM ai_scoped_memory WHERE user_id = $1 ORDER BY memory_type', [userId]);
  return result.rows;
}

async function removeMemory(client, userId, memoryType) {
  const result = await client.query(
    'DELETE FROM ai_scoped_memory WHERE user_id = $1 AND memory_type = $2 RETURNING id',
    [userId, memoryType],
  );
  return result.rows.length > 0;
}

async function removeAllMemoryForUser(client, userId) {
  await client.query('DELETE FROM ai_scoped_memory WHERE user_id = $1', [userId]);
}

// --- General freeform facts (ai_general_memory) — see the migration's ---
// --- own comment for why this is a separate table, not a reshape of -----
// --- ai_scoped_memory's one-row-per-type shape. -------------------------

async function insertGeneralFact(client, { collegeId, userId, fact }) {
  const result = await client.query(
    'INSERT INTO ai_general_memory (college_id, user_id, fact) VALUES ($1, $2, $3) RETURNING *',
    [collegeId, userId, fact],
  );
  return result.rows[0];
}

async function listGeneralFacts(client, userId) {
  const result = await client.query('SELECT * FROM ai_general_memory WHERE user_id = $1 ORDER BY created_at', [userId]);
  return result.rows;
}

async function countGeneralFacts(client, userId) {
  const result = await client.query('SELECT count(*)::int AS count FROM ai_general_memory WHERE user_id = $1', [
    userId,
  ]);
  return result.rows[0].count;
}

// The `user_id = $1` predicate is the authorization, not a filter: a
// fact belonging to another user simply matches no row and returns
// null, so a guessed id can neither read nor rewrite someone else's
// memory. Same shape as removeGeneralFact below.
async function updateGeneralFact(client, userId, factId, fact) {
  const result = await client.query(
    'UPDATE ai_general_memory SET fact = $3 WHERE user_id = $1 AND id = $2 RETURNING *',
    [userId, factId, fact],
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

async function removeGeneralFact(client, userId, factId) {
  const result = await client.query('DELETE FROM ai_general_memory WHERE user_id = $1 AND id = $2 RETURNING id', [
    userId,
    factId,
  ]);
  return result.rows.length > 0;
}

async function removeAllGeneralFactsForUser(client, userId) {
  await client.query('DELETE FROM ai_general_memory WHERE user_id = $1', [userId]);
}

module.exports = {
  getConsent,
  upsertConsent,
  upsertMemory,
  listMemoryByUser,
  removeMemory,
  removeAllMemoryForUser,
  insertGeneralFact,
  listGeneralFacts,
  countGeneralFacts,
  updateGeneralFact,
  removeGeneralFact,
  removeAllGeneralFactsForUser,
};
