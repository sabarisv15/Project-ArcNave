'use strict';

// Follow-up fix, schema-only: mark_10th/mark_12th/mark_iti were
// NUMERIC (Module 1's first migration), but StudentEditorModal.jsx's
// own placeholder text invites two input conventions — "92%" (a
// percentage) and "460/500" (a raw fraction) — neither of which
// NUMERIC can store. A "%" value 500s at the DB layer instead of a
// clean 400 (found during the UI slice).
//
// TEXT, not parsing/validation: there is no existing, decided business
// rule for which canonical numeric meaning either input convention
// should collapse to (92 vs 0.92 vs "store the fraction as two
// numbers" are all defensible, none documented anywhere). TEXT stores
// exactly what a user enters, in either convention, losslessly. A
// future module that needs to compute on these values is the point to
// make that real parsing decision, not this follow-up fix.
//
// Schema-only: studentRepository.js's COLUMNS list and
// studentService.js's ALLOWED_FIELDS already pass mark_10th/mark_12th/
// mark_iti through generically with no NUMERIC-specific handling
// (confirmed by reading both files, not assumed) — nothing else
// changes.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE students ALTER COLUMN mark_10th TYPE TEXT');
  pgm.sql('ALTER TABLE students ALTER COLUMN mark_12th TYPE TEXT');
  pgm.sql('ALTER TABLE students ALTER COLUMN mark_iti TYPE TEXT');
};

exports.down = (pgm) => {
  // Not guaranteed lossless: this fails outright if any row by then
  // contains a non-numeric string (e.g. "92%" or "460/500") — the
  // exact real-world data TEXT was introduced to allow. Acceptable for
  // a down migration (an escape hatch for a bad deploy, not a promise
  // that reversing is always possible once genuine free-text data
  // exists), but stated explicitly rather than left a silent trap.
  pgm.sql('ALTER TABLE students ALTER COLUMN mark_10th TYPE NUMERIC USING mark_10th::NUMERIC');
  pgm.sql('ALTER TABLE students ALTER COLUMN mark_12th TYPE NUMERIC USING mark_12th::NUMERIC');
  pgm.sql('ALTER TABLE students ALTER COLUMN mark_iti TYPE NUMERIC USING mark_iti::NUMERIC');
};
