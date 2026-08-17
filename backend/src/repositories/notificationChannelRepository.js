'use strict';

// Query mechanics for `college_notification_channels` only — no
// business logic, no encryption/decryption (that's
// notificationService.js's job — see its own comment on why config
// stays opaque here). Tenant scoping for id-keyed lookups relies on
// the table's RLS policy, same as every other repository in this
// codebase. findByCollegeAndChannel filters on college_id explicitly
// in addition to RLS, same as classRepository.findByCollegeAndClassName,
// because the UNIQUE (college_id, channel) key isn't globally unique.
//
// config is a jsonb column — JSON.stringify before insert/update, same
// convention workflowRepository.js uses for approverChain/actionManifest;
// the pg driver parses it back into a JS object on SELECT with no
// further handling needed here.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['channel', 'channel'],
  ['provider', 'provider'],
  ['enabled', 'enabled'],
  ['config', 'config'],
];

function toRow(fields) {
  const row = { ...fields };
  if (row.config !== undefined) {
    row.config = row.config === null ? null : JSON.stringify(row.config);
  }
  return row;
}

async function create(client, fields) {
  const row = toRow(fields);
  const entries = COLUMNS.filter(([key]) => row[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => row[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO college_notification_channels (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM college_notification_channels WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findByCollegeAndChannel(client, collegeId, channel) {
  const result = await client.query(
    'SELECT * FROM college_notification_channels WHERE college_id = $1 AND channel = $2',
    [collegeId, channel],
  );
  return result.rows[0] || null;
}

async function listByCollege(client, collegeId) {
  const result = await client.query(
    'SELECT * FROM college_notification_channels WHERE college_id = $1 ORDER BY channel',
    [collegeId],
  );
  return result.rows;
}

async function update(client, id, fields) {
  const row = toRow(fields);
  const entries = COLUMNS.filter(([key]) => row[key] !== undefined);
  if (entries.length === 0) {
    return findById(client, id);
  }

  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => row[key]);

  const result = await client.query(
    `UPDATE college_notification_channels SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

async function remove(client, id) {
  await client.query('DELETE FROM college_notification_channels WHERE id = $1', [id]);
}

module.exports = {
  create,
  findById,
  findByCollegeAndChannel,
  listByCollege,
  update,
  remove,
};
