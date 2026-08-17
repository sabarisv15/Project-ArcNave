'use strict';

// Query mechanics for `classes` only — no business logic (that's
// AcademicService's job, not built in this slice — see .ai/TASK.md).
// Tenant scoping for id-keyed lookups relies on the table's RLS
// policy (current_setting('app.current_tenant', true) — see the
// Module 3 migration), same as studentRepository.js's findById and
// staffRepository.js's findById.
//
// classes.tutor_user_id (and this file's own findByTutorUserId) is
// gone as of Phase 2 step 20 — Class Tutor is a Position/Account/
// Occupant now (position_class_assignments), resolved through
// identityService.resolvePositionOccupant/resolveActiveClassTutorPosition,
// never this repository directly (steps 11-19).
//
// findByCollegeAndClassName filters on college_id explicitly in
// addition to RLS, same as staffRepository.js's findByStaffCode and
// studentRepository.js's findByRollNo, because class_name's
// uniqueness is scoped to (college_id, class_name), not global — RLS
// alone would still return the right row, but the explicit filter
// documents the real key and matches house convention for
// non-globally-unique lookups.
//
// `remove` is a hard DELETE, not a soft-delete: no soft-delete column
// (no deleted_at/is_active) for classes yet — same open question
// flagged for students/staff, not decided here either.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['className', 'class_name'],
  ['department', 'department'],
  ['departmentId', 'department_id'],
  ['semester', 'semester'],
  ['timetableStatus', 'timetable_status'],
  ['timetableData', 'timetable_data'],
  ['timetableRemarks', 'timetable_remarks'],
  ['maxHoursPerDayPerStaff', 'max_hours_per_day_per_staff'],
];

async function create(client, fields) {
  // Only the columns the caller actually provided go into the INSERT
  // — an omitted key must let Postgres apply its own DEFAULT (e.g.
  // timetable_status defaults to 'No Tutor'), not receive an explicit
  // NULL, which would violate its NOT NULL constraint. Same
  // entries-filtering approach as update() below and
  // studentRepository.create/staffRepository.create.
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO classes (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM classes WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findByCollegeAndClassName(client, collegeId, className) {
  const result = await client.query(
    'SELECT * FROM classes WHERE college_id = $1 AND class_name = $2',
    [collegeId, className],
  );
  return result.rows[0] || null;
}

// The "every class in a department" lookup visibilityService.
// getVisibleClassIds needs to scope an hod's own read access — no
// pagination, same "return everything, let the caller slice/filter"
// choice studentRepository.findByDepartmentId already makes for the
// structurally identical lookup.
async function findByDepartmentId(client, departmentId) {
  const result = await client.query(
    'SELECT * FROM classes WHERE department_id = $1 ORDER BY created_at',
    [departmentId],
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
    `UPDATE classes SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

async function remove(client, id) {
  await client.query('DELETE FROM classes WHERE id = $1', [id]);
}

async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    'SELECT * FROM classes ORDER BY created_at LIMIT $1 OFFSET $2',
    [limit, offset],
  );
  return result.rows;
}

module.exports = {
  create,
  findById,
  findByCollegeAndClassName,
  findByDepartmentId,
  update,
  remove,
  list,
};
