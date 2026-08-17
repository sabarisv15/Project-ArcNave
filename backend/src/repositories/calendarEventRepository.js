'use strict';

// Query mechanics for `academic_calendar_events` only — no business
// logic (calendarService.js's job). RLS handles tenant scoping for
// id-keyed lookups, same as every other tenant table.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['title', 'title'],
  ['eventType', 'event_type'],
  ['startDate', 'start_date'],
  ['endDate', 'end_date'],
  ['description', 'description'],
  ['createdBy', 'created_by'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO academic_calendar_events (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM academic_calendar_events WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// update: same sparse-SET-clause shape as every other repository's own
// update() (e.g. studentRepository) — only fields the caller actually
// passed are ever touched.
async function update(client, id, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return findById(client, id);
  }
  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => fields[key]);

  const result = await client.query(
    `UPDATE academic_calendar_events SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

async function remove(client, id) {
  const result = await client.query('DELETE FROM academic_calendar_events WHERE id = $1 RETURNING id', [id]);
  return result.rows.length > 0;
}

// list: optional [fromDate, toDate] range filter (inclusive, matched
// against start_date) — the two real query shapes this table needs:
// "everything" (Institution Settings admin view) and "what's coming up
// in this window" (a dashboard widget or the AI tool below). Ordered
// by start_date — a calendar's natural sort order.
async function list(client, { collegeId, fromDate, toDate } = {}) {
  const conditions = [];
  const values = [];

  if (collegeId !== undefined) {
    values.push(collegeId);
    conditions.push(`college_id = $${values.length}`);
  }
  if (fromDate !== undefined) {
    values.push(fromDate);
    conditions.push(`start_date >= $${values.length}`);
  }
  if (toDate !== undefined) {
    values.push(toDate);
    conditions.push(`start_date <= $${values.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await client.query(
    `SELECT * FROM academic_calendar_events ${whereClause} ORDER BY start_date ASC`,
    values,
  );
  return result.rows;
}

module.exports = {
  create,
  findById,
  update,
  remove,
  list,
};
