'use strict';

// Query mechanics for `academic_years` only — no business logic (that's
// AcademicYearService's job). Every function relies on the table's own
// RLS policy for tenant scoping on id-keyed lookups, same as
// financeRepository.js's findById/classRepository.js's findById.
//
// No soft-delete here: academic_years has no deleted_at column (see the
// migration's file-level comment) — Completed is the terminal lifecycle
// state, not a deletion.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['yearLabel', 'year_label'],
  ['status', 'status'],
  ['startDate', 'start_date'],
  ['endDate', 'end_date'],
  ['createdByUserId', 'created_by_user_id'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO academic_years (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query(
    'SELECT * FROM academic_years WHERE id = $1',
    [id],
  );
  return result.rows[0] || null;
}

// The natural "what's the tenant's current context" lookup AI/other
// services default to — mirrors financeRepository.findByClassAndYear's
// "one natural lookup per real business question" precedent. At most
// one row can ever match (academic_years_one_active_per_college), so a
// single row (or null) is the correct return shape, not a list.
async function findActive(client, collegeId) {
  const result = await client.query(
    `SELECT * FROM academic_years
     WHERE college_id = $1 AND status = 'Active'`,
    [collegeId],
  );
  return result.rows[0] || null;
}

async function findByCollegeAndYearLabel(client, collegeId, yearLabel) {
  const result = await client.query(
    'SELECT * FROM academic_years WHERE college_id = $1 AND year_label = $2',
    [collegeId, yearLabel],
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
    `UPDATE academic_years SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    `SELECT * FROM academic_years
     ORDER BY created_at LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows;
}

module.exports = {
  create,
  findById,
  findActive,
  findByCollegeAndYearLabel,
  update,
  list,
};
