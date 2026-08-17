'use strict';

// Query mechanics for `timetable_revisions` only — no business logic
// (that's AcademicService's job). No update/softDelete/hardDelete
// function exists at all: a revision is permanently retained and
// never changes once created (see the migration's file-level comment,
// and its GRANT, which omits UPDATE/DELETE at the DB permission level
// too).

async function create(client, {
  collegeId, classId, revisionNumber, effectiveFrom, workflowRequestId, createdByUserId,
}) {
  const result = await client.query(
    `INSERT INTO timetable_revisions
       (college_id, class_id, revision_number, effective_from, workflow_request_id, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [collegeId, classId, revisionNumber, effectiveFrom, workflowRequestId, createdByUserId],
  );
  return result.rows[0];
}

async function countForClass(client, classId) {
  const result = await client.query(
    'SELECT COUNT(*)::int AS count FROM timetable_revisions WHERE class_id = $1',
    [classId],
  );
  return result.rows[0].count;
}

async function listForClass(client, classId) {
  const result = await client.query(
    'SELECT * FROM timetable_revisions WHERE class_id = $1 ORDER BY revision_number',
    [classId],
  );
  return result.rows;
}

// The revision effective on a given date: the highest revision_number
// among rows whose effective_from is on or before that date. At most
// one row can be "the" answer in ordinary use (revisions are created in
// increasing effective_from order), but this orders by both columns
// rather than assuming that, in case a future revision was ever
// deliberately backdated relative to a later one.
async function findEffectiveForDate(client, classId, date) {
  const result = await client.query(
    `SELECT * FROM timetable_revisions
     WHERE class_id = $1 AND effective_from <= $2
     ORDER BY effective_from DESC, revision_number DESC
     LIMIT 1`,
    [classId, date],
  );
  return result.rows[0] || null;
}

module.exports = {
  create, countForClass, listForClass, findEffectiveForDate,
};
