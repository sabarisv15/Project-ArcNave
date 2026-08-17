'use strict';

// Query mechanics for `artifact_versions` only. Immutable, append-only
// — same shape as messageRepository.js/timetableRevisionRepository.js.
// No update/remove function on purpose; the table's GRANT omits
// UPDATE/DELETE at the DB level too.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['artifactId', 'artifact_id'],
  ['versionNumber', 'version_number'],
  ['content', 'content'],
  ['changeSummary', 'change_summary'],
  ['createdByUserId', 'created_by_user_id'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO artifact_versions (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function listByArtifact(client, artifactId) {
  const result = await client.query(
    'SELECT * FROM artifact_versions WHERE artifact_id = $1 ORDER BY version_number ASC',
    [artifactId],
  );
  return result.rows;
}

module.exports = {
  create,
  listByArtifact,
};
