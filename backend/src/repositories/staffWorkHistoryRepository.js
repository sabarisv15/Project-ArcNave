'use strict';

// Query mechanics for `staff_work_history` only — no business logic
// (that's staffWorkHistoryService.js's job, not built here — CLAUDE.md
// rule 4, never calls staffRepository or any other repository). Tenant
// scoping for id-keyed lookups relies on the table's RLS policy
// (current_setting('app.current_tenant', true) — see the staff-
// profile-specialization-and-work-history migration), same as
// facultyAllocationRepository.js's findById.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['staffId', 'staff_id'],
  ['institutionName', 'institution_name'],
  ['designationHeld', 'designation_held'],
  ['fromDate', 'from_date'],
  ['toDate', 'to_date'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO staff_work_history (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM staff_work_history WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function listByStaffId(client, staffId) {
  const result = await client.query(
    'SELECT * FROM staff_work_history WHERE staff_id = $1 ORDER BY from_date DESC NULLS LAST, created_at',
    [staffId],
  );
  return result.rows;
}

async function remove(client, id) {
  const result = await client.query('DELETE FROM staff_work_history WHERE id = $1 RETURNING id', [id]);
  return result.rows.length > 0;
}

module.exports = {
  create,
  findById,
  listByStaffId,
  remove,
};
