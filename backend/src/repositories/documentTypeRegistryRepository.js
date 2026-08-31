'use strict';

// Query mechanics for `document_type_registry` only — read-only (the
// migration seeds every row; nothing in the application writes to this
// table today, same "admin/migration-managed, not app-writable" shape
// the arcnave_app role's SELECT-only GRANT already enforces at the DB
// level). Global/platform table, no college_id, no RLS — see the
// migration's own comment.

async function findByModule(client, moduleName) {
  const result = await client.query('SELECT * FROM document_type_registry WHERE module = $1 ORDER BY sort_order', [
    moduleName,
  ]);
  return result.rows;
}

async function findByKey(client, key) {
  const result = await client.query('SELECT * FROM document_type_registry WHERE key = $1', [key]);
  return result.rows[0] || null;
}

module.exports = {
  findByModule,
  findByKey,
};
