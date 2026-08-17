'use strict';

// Staff's own private documents (Academic > Resources > Documents'
// "My Documents" section) have no home in the existing schema —
// `documents` rows are always either student-scoped or institutional
// (student_id IS NULL, browsed by everyone via the institutional
// index). folder_name is a plain free-text grouping label, only ever
// set on doc_type='personal' rows (student_id/class_id both null,
// uploaded_by_user_id = the owner) — no new table needed, same
// "DocumentService is the sole storage owner" boundary, just a new
// nullable column on the existing one.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE documents ADD COLUMN folder_name TEXT');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE documents DROP COLUMN IF EXISTS folder_name');
};
