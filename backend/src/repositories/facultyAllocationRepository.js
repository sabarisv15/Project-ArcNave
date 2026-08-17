'use strict';

// Query mechanics for `faculty_allocation` only — no business logic
// (that's a future AcademicService slice's job, not built here — see
// .ai/TASK.md). Tenant scoping for id-keyed lookups relies on the
// table's RLS policy (current_setting('app.current_tenant', true) —
// see the Module 3 timetable-normalization migration), same as
// classRepository.js's findById. Never calls timetablePeriodRepository,
// classRepository, or any other repository (CLAUDE.md rule 4) — every
// function here returns this table's own rows only, no joins.
//
// findByClassAndPeriod is the natural "who teaches this class during
// this period" lookup — UNIQUE (class_id, period_id) makes it a
// single-row result, same shape as classRepository.js's
// findByTutorUserId. findByStaffUserId is the natural "this staff
// member's full teaching schedule" lookup — the real, structured link
// AttendanceService's own "scheduled staff member" gap (see
// attendanceService.js, 82f8479) needs once a future slice wires it
// up; not consumed by anything yet, only enabled. Neither has an
// explicit college_id filter beyond RLS: class_id and staff_user_id
// are both real FKs into globally-unique-id tables, so there's no
// second tenant's row an explicit filter would need to exclude that
// RLS doesn't already exclude — same reasoning classRepository.js's
// findByTutorUserId documents for its own UNIQUE(tutor_user_id)
// column.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['classId', 'class_id'],
  ['periodId', 'period_id'],
  ['subject', 'subject'],
  ['staffUserId', 'staff_user_id'],
  ['subjectType', 'subject_type'],
  ['sessionBlockId', 'session_block_id'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO faculty_allocation (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM faculty_allocation WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findByClassAndPeriod(client, classId, periodId) {
  const result = await client.query(
    'SELECT * FROM faculty_allocation WHERE class_id = $1 AND period_id = $2',
    [classId, periodId],
  );
  return result.rows[0] || null;
}

async function findByClassId(client, classId) {
  const result = await client.query(
    'SELECT * FROM faculty_allocation WHERE class_id = $1',
    [classId],
  );
  return result.rows;
}

async function findByStaffUserId(client, staffUserId) {
  const result = await client.query(
    'SELECT * FROM faculty_allocation WHERE staff_user_id = $1',
    [staffUserId],
  );
  return result.rows;
}

// RS-TTB-001 revision flow's "affected sessions" lookup — every row
// this class currently has for one subject, the exact set a revision
// (e.g. a faculty replacement) needs to remove and replace, leaving
// every other subject's rows (the unaffected sessions) untouched.
async function findByClassAndSubject(client, classId, subject) {
  const result = await client.query(
    'SELECT * FROM faculty_allocation WHERE class_id = $1 AND subject = $2',
    [classId, subject],
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
    `UPDATE faculty_allocation SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

async function remove(client, id) {
  await client.query('DELETE FROM faculty_allocation WHERE id = $1', [id]);
}

async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    'SELECT * FROM faculty_allocation ORDER BY created_at LIMIT $1 OFFSET $2',
    [limit, offset],
  );
  return result.rows;
}

module.exports = {
  create,
  findById,
  findByClassAndPeriod,
  findByClassId,
  findByStaffUserId,
  findByClassAndSubject,
  update,
  remove,
  list,
};
