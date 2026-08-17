'use strict';

// Query mechanics for `scholarship_decisions` only — no business logic
// (that's FinanceService's job). No update/delete — a recorded
// decision is a permanent fact (see the migration's file-level
// comment).

async function create(client, {
  collegeId, studentId, schemeName, eligible, reason, supportingDocumentId, decidedByUserId,
}) {
  const result = await client.query(
    `INSERT INTO scholarship_decisions
       (college_id, student_id, scheme_name, eligible, reason, supporting_document_id, decided_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [collegeId, studentId, schemeName, eligible, reason || null, supportingDocumentId || null, decidedByUserId],
  );
  return result.rows[0];
}

async function listForStudent(client, studentId) {
  const result = await client.query(
    'SELECT * FROM scholarship_decisions WHERE student_id = $1 ORDER BY created_at DESC',
    [studentId],
  );
  return result.rows;
}

module.exports = { create, listForStudent };
