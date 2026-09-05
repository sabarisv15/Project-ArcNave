'use strict';

// Query mechanics for `student_flags` only — no business logic
// (studentService's job). "Currently flagged" is derived (newest row
// with cleared_at IS NULL), never a separate boolean anywhere.

async function create(client, { collegeId, studentId, remark, flaggedByUserId }) {
  const result = await client.query(
    `INSERT INTO student_flags (college_id, student_id, remark, flagged_by_user_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [collegeId, studentId, remark, flaggedByUserId],
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM student_flags WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// The one lookup "is this student currently flagged" needs — the
// newest row for the student that has not been cleared. Null means not
// currently flagged (whether never flagged, or every past flag has
// since been cleared).
async function findActiveByStudentId(client, studentId) {
  const result = await client.query(
    `SELECT * FROM student_flags
     WHERE student_id = $1 AND cleared_at IS NULL
     ORDER BY flagged_at DESC
     LIMIT 1`,
    [studentId],
  );
  return result.rows[0] || null;
}

async function clear(client, id, { clearedByUserId }) {
  const result = await client.query(
    `UPDATE student_flags SET cleared_by_user_id = $2, cleared_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, clearedByUserId],
  );
  return result.rows[0] || null;
}

async function listHistoryForStudent(client, studentId) {
  const result = await client.query('SELECT * FROM student_flags WHERE student_id = $1 ORDER BY flagged_at DESC', [
    studentId,
  ]);
  return result.rows;
}

// Batched lookup for a students-table view — one query for "which of
// these students currently have an active flag," not N.
async function findActiveByStudentIds(client, studentIds) {
  if (!Array.isArray(studentIds) || studentIds.length === 0) {
    return [];
  }
  const result = await client.query(
    `SELECT DISTINCT ON (student_id) *
     FROM student_flags
     WHERE student_id = ANY($1::uuid[]) AND cleared_at IS NULL
     ORDER BY student_id, flagged_at DESC`,
    [studentIds],
  );
  return result.rows;
}

module.exports = {
  create,
  findById,
  findActiveByStudentId,
  clear,
  listHistoryForStudent,
  findActiveByStudentIds,
};
