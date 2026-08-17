'use strict';

// students.deleted_at — soft-delete (this session's own task).
// removeStudent (studentService.js) now sets this instead of a hard
// DELETE; every read/list query in studentRepository.js excludes rows
// where it's set, by default, with no route exposing a way to
// hard-delete a row. Nullable, no default: NULL means "not deleted,"
// the normal state for every existing and newly created row.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE students ADD COLUMN deleted_at TIMESTAMPTZ');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS deleted_at');
};
