'use strict';

// Round 10 P2/P3 finding: assessment_marks.marks_obtained had no
// range/sanity CHECK at all — a negative value would be stored exactly
// like any legitimate one. Only the non-negative half is enforceable
// here: the upper bound (marks_obtained <= assessment_types.max_marks)
// is a cross-table comparison, which a single-table CHECK constraint
// cannot express, and max_marks is itself nullable at the schema level
// (an institution may not have set one for a given assessment type) —
// that half is enforced at the application layer instead
// (assessmentService.js's assertMarksInRange, called from recordMark
// and updateMark). This constraint is the un-bypassable floor
// regardless of which code path writes the row.
//
// No existing-row UPDATE needed first: unlike the academic_years
// status-rename migration (this file's own sibling in shape), no
// negative marks_obtained value has ever been reachable through the
// application (assessmentService.recordMark/updateMark both require a
// non-null value but never validated its sign) — checked directly
// against the real table before writing this migration, not assumed.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE assessment_marks
      ADD CONSTRAINT assessment_marks_marks_obtained_non_negative_check CHECK (marks_obtained >= 0)
  `);
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE assessment_marks DROP CONSTRAINT IF EXISTS assessment_marks_marks_obtained_non_negative_check');
};
