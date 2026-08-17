'use strict';

// Query mechanics for `exam_timetable_versions` only — no business
// logic (that's ExaminationService's job). No delete — a published
// version is a permanent fact (see the migration's file-level
// comment); update() here exists only to flip is_current_official,
// never to edit a version's own document_id/version_number.

async function create(client, {
  collegeId, classId, documentId, versionNumber, publishedByUserId,
}) {
  const result = await client.query(
    `INSERT INTO exam_timetable_versions
       (college_id, class_id, document_id, version_number, is_current_official, published_by_user_id)
     VALUES ($1, $2, $3, $4, true, $5)
     RETURNING *`,
    [collegeId, classId, documentId, versionNumber, publishedByUserId],
  );
  return result.rows[0];
}

async function findCurrentOfficialForClass(client, classId) {
  const result = await client.query(
    'SELECT * FROM exam_timetable_versions WHERE class_id = $1 AND is_current_official = true',
    [classId],
  );
  return result.rows[0] || null;
}

async function listForClass(client, classId) {
  const result = await client.query(
    'SELECT * FROM exam_timetable_versions WHERE class_id = $1 ORDER BY version_number DESC',
    [classId],
  );
  return result.rows;
}

async function countForClass(client, classId) {
  const result = await client.query(
    'SELECT COUNT(*)::int AS count FROM exam_timetable_versions WHERE class_id = $1',
    [classId],
  );
  return result.rows[0].count;
}

// Demotes the class's current official version (if any) — always
// called immediately before create() inserts the new one, so the
// class never has zero OR two current-official rows at once from this
// repository's own callers' point of view, even though each is a
// separate statement (ExaminationService.publishExamTimetableVersion
// runs both inside one transaction).
async function clearCurrentOfficialForClass(client, classId) {
  await client.query(
    'UPDATE exam_timetable_versions SET is_current_official = false WHERE class_id = $1 AND is_current_official = true',
    [classId],
  );
}

module.exports = {
  create, findCurrentOfficialForClass, listForClass, countForClass, clearCurrentOfficialForClass,
};
