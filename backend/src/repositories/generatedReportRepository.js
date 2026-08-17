'use strict';

// Query mechanics for `generated_reports` only — no business logic.
// A ledger-style repository, not a domain one: called directly by
// whichever service generates a report, same as auditLogRepository.js
// is called directly by every service today — see ADR-018 for why
// this doesn't need a mediating "ReportService owns this repo"
// relationship the way FinanceRepository/DocumentRepository do.
//
// Append-only, matching the migration's own GRANT (SELECT/INSERT
// only): there is no update/remove function here at all, structurally,
// not just by convention — a row's outcome is fully known at create()
// time (see the migration's file-level comment), so there is nothing
// to transition later.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['requestedByUserId', 'requested_by_user_id'],
  ['reportType', 'report_type'],
  ['format', 'format'],
  ['parameters', 'parameters'],
  ['status', 'status'],
  ['documentId', 'document_id'],
  ['errorMessage', 'error_message'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => (key === 'parameters' ? JSON.stringify(fields[key]) : fields[key]));
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO generated_reports (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query(
    'SELECT * FROM generated_reports WHERE id = $1',
    [id],
  );
  return result.rows[0] || null;
}

async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    `SELECT * FROM generated_reports
     ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows;
}

module.exports = {
  create,
  findById,
  list,
};
