'use strict';

// Query mechanics for `personal_notes` only. Every function here takes
// userId as a real filter (not just an insert value) — this table has
// no tenant-only RLS equivalent for per-user privacy, so
// personalNoteService must always pass the acting user's id through to
// scope reads/writes to their own rows; this file does not enforce
// that on its own.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['userId', 'user_id'],
  ['title', 'title'],
  ['body', 'body'],
  ['reminderAt', 'reminder_at'],
  ['isDone', 'is_done'],
  // ADL-030 — calendar-day association, distinct from reminderAt's
  // time-of-day.
  ['noteDate', 'note_date'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO personal_notes (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM personal_notes WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function update(client, id, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return findById(client, id);
  }
  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => fields[key]);

  const result = await client.query(
    `UPDATE personal_notes SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

async function remove(client, id) {
  const result = await client.query('DELETE FROM personal_notes WHERE id = $1 RETURNING id', [id]);
  return result.rows.length > 0;
}

async function listByUser(client, userId) {
  const result = await client.query(
    'SELECT * FROM personal_notes WHERE user_id = $1 ORDER BY reminder_at ASC NULLS LAST, created_at DESC',
    [userId],
  );
  return result.rows;
}

// ADL-030 — the calendar grid's own read: every note whose note_date
// falls within the visible range (a note with no note_date is not a
// calendar-grid note, so it's excluded here, not just unsorted).
async function listByUserAndDateRange(client, userId, fromDate, toDate) {
  const result = await client.query(
    `SELECT * FROM personal_notes
     WHERE user_id = $1 AND note_date IS NOT NULL AND note_date BETWEEN $2 AND $3
     ORDER BY note_date ASC`,
    [userId, fromDate, toDate],
  );
  return result.rows;
}

module.exports = {
  create,
  findById,
  update,
  remove,
  listByUser,
  listByUserAndDateRange,
};
