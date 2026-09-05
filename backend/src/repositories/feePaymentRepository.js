'use strict';

// Query mechanics for `fee_payments` only — no business logic (that's
// FinanceService's job). Tenant scoping for id-keyed lookups relies on
// the table's own RLS policy (current_setting('app.current_tenant',
// true)), same as every other repository in this codebase. Never
// calls another repository (CLAUDE.md rule 4) — every function here
// returns this table's own rows only, no joins.
//
// Every read here filters deleted_at IS NULL — this table is
// soft-delete only (see the migration's file-level comment), same
// treatment attendanceRepository.js gives its own table. There is no
// `remove`: this repository offers no hard-delete function at all —
// BusinessRules.md's AI section names "fees" explicitly for
// soft-delete-only, and the table's own GRANT already omits DELETE at
// the DB permission level; softDelete is the only removal path,
// structurally, not just by convention.
//
// RS-FIN-001/002/003 (D4/D5, Stage 4): fee_structure_id and
// findByStudentAndFeeStructure are gone — a student has at most ONE
// fee_payments row now (fee_payments_student_id_key, a partial unique
// index on student_id alone), not one per fee-line. findByStudentId is
// therefore a find-ONE, not a list — the "does this student already
// have a mark" lookup markFeePayment's create-only guard needs, same
// role findByStudentAndFeeStructure used to play.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['studentId', 'student_id'],
  ['status', 'status'],
  ['markedByUserId', 'marked_by_user_id'],
  ['receiptDocumentId', 'receipt_document_id'],
];

async function create(client, fields) {
  // Only the columns the caller actually provided go into the INSERT
  // — an omitted key must let Postgres apply its own DEFAULT (e.g.
  // status defaults to 'not_paid'), not receive an explicit NULL,
  // which would violate its NOT NULL constraint. Same
  // entries-filtering approach as update() below.
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO fee_payments (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM fee_payments WHERE id = $1 AND deleted_at IS NULL', [id]);
  return result.rows[0] || null;
}

async function findByStudentId(client, studentId) {
  const result = await client.query(
    `SELECT * FROM fee_payments
     WHERE student_id = $1 AND deleted_at IS NULL`,
    [studentId],
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
    `UPDATE fee_payments SET ${setClauses.join(', ')}, updated_at = now()
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
    `UPDATE fee_payments SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    `SELECT * FROM fee_payments
     WHERE deleted_at IS NULL
     ORDER BY created_at LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows;
}

module.exports = {
  create,
  findById,
  findByStudentId,
  update,
  softDelete,
  list,
};
