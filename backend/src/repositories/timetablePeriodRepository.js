'use strict';

// Query mechanics for `timetable_periods` only — no business logic
// (that's a future AcademicService slice's job, not built here — see
// .ai/TASK.md). Tenant scoping for id-keyed lookups relies on the
// table's RLS policy (current_setting('app.current_tenant', true) —
// see the Module 3 timetable-normalization migration), same as
// classRepository.js's findById.
//
// findByCollegeDayAndHour filters on college_id explicitly in
// addition to RLS, same as classRepository.js's
// findByCollegeAndClassName, because a period's uniqueness is scoped
// to (college_id, day_of_week, hour_index), not global.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['dayOfWeek', 'day_of_week'],
  ['hourIndex', 'hour_index'],
  ['startTime', 'start_time'],
  ['endTime', 'end_time'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO timetable_periods (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM timetable_periods WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findByCollegeDayAndHour(client, collegeId, dayOfWeek, hourIndex) {
  const result = await client.query(
    `SELECT * FROM timetable_periods
     WHERE college_id = $1 AND day_of_week = $2 AND hour_index = $3`,
    [collegeId, dayOfWeek, hourIndex],
  );
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
    `UPDATE timetable_periods SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

async function remove(client, id) {
  await client.query('DELETE FROM timetable_periods WHERE id = $1', [id]);
}

async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    'SELECT * FROM timetable_periods ORDER BY day_of_week, hour_index LIMIT $1 OFFSET $2',
    [limit, offset],
  );
  return result.rows;
}

// Every period for a college, unpaginated — the whole shared bell
// schedule, needed by AcademicService's automatic timetable generator
// to know the full weekly grid it's placing allocations into. Ordered
// by hour_index only; day_of_week is free text (not a real calendar
// type), so calendar-order sorting by day happens in JS at the
// service layer, not here (same "no business logic in this file"
// boundary every other function here already draws).
async function findAllByCollege(client, collegeId) {
  const result = await client.query(
    'SELECT * FROM timetable_periods WHERE college_id = $1 ORDER BY hour_index',
    [collegeId],
  );
  return result.rows;
}

// The "what period is happening right now" lookup the AI attendance
// assistant needs (BusinessRules.md AI Attendance Management: "AI
// determines the current class using the approved timetable"). A
// currentTime of exactly a period's end_time is deliberately excluded
// (< not <=) — that period has just finished, the next one (if any)
// owns that instant, matching ordinary half-open interval convention.
async function findCurrentByCollegeAndDay(client, collegeId, dayOfWeek, currentTime) {
  const result = await client.query(
    `SELECT * FROM timetable_periods
     WHERE college_id = $1 AND day_of_week = $2
       AND start_time <= $3::time AND end_time > $3::time`,
    [collegeId, dayOfWeek, currentTime],
  );
  return result.rows[0] || null;
}

module.exports = {
  create,
  findById,
  findByCollegeDayAndHour,
  update,
  remove,
  list,
  findAllByCollege,
  findCurrentByCollegeAndDay,
};
