'use strict';

// Query mechanics for `attendance_sessions` only — no business logic
// (that's AttendanceService's job, not built in this slice — see
// .ai/TASK.md). Tenant scoping for id-keyed lookups relies on the
// table's RLS policy (current_setting('app.current_tenant', true) —
// see the Module 4 migration), same as classRepository.js's findById.
//
// Every read here filters deleted_at IS NULL — this table is
// soft-delete only (see the migration's file-level comment), so a
// "row not found" and "row was soft-deleted" look identical to every
// function below, same as a hard-deleted row would in
// classRepository.js's findById.
//
// There is no `remove`: this repository offers no hard-delete
// function at all. BusinessRules.md's AI section requires soft-delete
// only for attendance records, and the table's own GRANT already
// omits DELETE at the DB permission level — softDelete is the only
// removal path, structurally, not just by convention.
//
// findByClassSessionAndHour is the "was this period already marked?"
// lookup StaffDashboard.jsx's real schedule screen needs (its
// `already_marked` flag is exactly "does a row exist for this
// class_id + session_date + hour_index"). findByClassAndDate is the
// natural "today's marked periods for this class" lookup. Both filter
// college_id implicitly via RLS only (no explicit college_id
// parameter) — same reasoning classRepository.js's
// findByTutorUserId gives for tutor_user_id: class_id is already
// globally unique (a real classes.id UUID), so there's no second
// tenant's row an explicit filter would need to exclude that RLS
// doesn't already exclude.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['classId', 'class_id'],
  ['sessionDate', 'session_date'],
  ['hourIndex', 'hour_index'],
  ['markedByUserId', 'marked_by_user_id'],
  ['absentStudentIds', 'absent_student_ids'],
  ['totalStudents', 'total_students'],
  ['lockedAt', 'locked_at'],
];

async function create(client, fields) {
  // Only the columns the caller actually provided go into the INSERT
  // — an omitted key must let Postgres apply its own DEFAULT (e.g.
  // absent_student_ids defaults to '[]'), not receive an explicit
  // NULL. Same entries-filtering approach as update() below and
  // classRepository.create.
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO attendance_sessions (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query(
    'SELECT * FROM attendance_sessions WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  return result.rows[0] || null;
}

async function findByClassSessionAndHour(client, classId, sessionDate, hourIndex) {
  const result = await client.query(
    `SELECT * FROM attendance_sessions
     WHERE class_id = $1 AND session_date = $2 AND hour_index = $3 AND deleted_at IS NULL`,
    [classId, sessionDate, hourIndex],
  );
  return result.rows[0] || null;
}

async function findByClassAndDate(client, classId, sessionDate) {
  const result = await client.query(
    `SELECT * FROM attendance_sessions
     WHERE class_id = $1 AND session_date = $2 AND deleted_at IS NULL
     ORDER BY hour_index`,
    [classId, sessionDate],
  );
  return result.rows;
}

// startDate/endDate are both optional — omitting either (or both)
// means "no lower/upper bound," not "no rows," so a bare classId
// still returns that class's full all-time history, same "no filter
// means all-time" convention analyticsRepository.attendanceRateByClass
// uses for its own optional startDate/endDate.
async function findByClassAndDateRange(client, classId, { startDate, endDate } = {}) {
  const conditions = ['class_id = $1', 'deleted_at IS NULL'];
  const values = [classId];
  if (startDate !== undefined) {
    values.push(startDate);
    conditions.push(`session_date >= $${values.length}`);
  }
  if (endDate !== undefined) {
    values.push(endDate);
    conditions.push(`session_date <= $${values.length}`);
  }

  const result = await client.query(
    `SELECT * FROM attendance_sessions
     WHERE ${conditions.join(' AND ')}
     ORDER BY session_date, hour_index`,
    values,
  );
  return result.rows;
}

async function update(client, id, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return findById(client, id);
  }

  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => fields[key]);

  const result = await client.query(
    `UPDATE attendance_sessions SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

// Sets deleted_at rather than issuing a DELETE — see the file-level
// comment. Idempotent against an already-deleted or missing id: the
// WHERE guard means a second call simply matches no row.
async function softDelete(client, id) {
  const result = await client.query(
    `UPDATE attendance_sessions SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    `SELECT * FROM attendance_sessions
     WHERE deleted_at IS NULL
     ORDER BY session_date DESC, hour_index LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows;
}

module.exports = {
  create,
  findById,
  findByClassSessionAndHour,
  findByClassAndDate,
  findByClassAndDateRange,
  update,
  softDelete,
  list,
};
