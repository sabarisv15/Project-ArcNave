'use strict';

// Query mechanics for `user_preferences` only — a generic per-user
// key/value store (see the migration's own comment for why one table
// serves Saved Filters, Dashboard Layout, and Notification
// Preferences). Every function is scoped by userId; there is no
// tenant-only read here for the same reason personalNoteRepository has
// none — a preference is private to the user who set it.

async function upsert(client, { collegeId, userId, preferenceKey, value }) {
  const result = await client.query(
    `INSERT INTO user_preferences (college_id, user_id, preference_key, value)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, preference_key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     RETURNING *`,
    [collegeId, userId, preferenceKey, JSON.stringify(value)],
  );
  return result.rows[0];
}

async function findByUserAndKey(client, userId, preferenceKey) {
  const result = await client.query(
    'SELECT * FROM user_preferences WHERE user_id = $1 AND preference_key = $2',
    [userId, preferenceKey],
  );
  return result.rows[0] || null;
}

async function listByUser(client, userId) {
  const result = await client.query(
    'SELECT * FROM user_preferences WHERE user_id = $1 ORDER BY preference_key',
    [userId],
  );
  return result.rows;
}

async function remove(client, userId, preferenceKey) {
  const result = await client.query(
    'DELETE FROM user_preferences WHERE user_id = $1 AND preference_key = $2 RETURNING id',
    [userId, preferenceKey],
  );
  return result.rows.length > 0;
}

module.exports = {
  upsert, findByUserAndKey, listByUser, remove,
};
