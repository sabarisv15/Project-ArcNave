'use strict';

// RS-TTB-001 (Class Tutor AI Timetable Generation) — additive schema
// for the generator's new inputs, none of which existed before this
// slice: a subject can now be Theory or Practical (co-taught by up to
// two faculty), placed as a multi-hour continuous block, and a class
// can cap how many hours a day any one staff member teaches for it.
//
// subject_type/session_block_id live on faculty_allocation (the table
// generateTimetable already writes one row per placed period into) —
// not a new table — same "grow the row that already represents this
// fact" reasoning student_flags' own migration documents for its own
// domain. session_block_id groups the N rows one continuous practical
// block produced (e.g. a 3-hour block generates 3 faculty_allocation
// rows sharing one session_block_id) so a caller can tell "these three
// periods are one block" apart from three independently-scheduled
// single hours of the same subject — nullable, since Theory placements
// (always single-period) never need it.
//
// max_hours_per_day_per_staff lives on classes, not a new
// institution-wide config table: BusinessRules.md's own scope for this
// generator is "one classroom timetable" (see academicService.
// generateTimetable's existing "one class at a time" comment) — the
// cap is this class's own generation constraint, configured by its
// Class Tutor, not an institution-wide setting nothing here builds.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE faculty_allocation
      ADD COLUMN subject_type TEXT NOT NULL DEFAULT 'Theory'
        CONSTRAINT faculty_allocation_subject_type_check CHECK (subject_type IN ('Theory', 'Practical')),
      ADD COLUMN session_block_id UUID NULL
  `);

  pgm.sql(`
    ALTER TABLE classes
      ADD COLUMN max_hours_per_day_per_staff INTEGER NULL
  `);
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE classes DROP COLUMN IF EXISTS max_hours_per_day_per_staff');
  pgm.sql(`
    ALTER TABLE faculty_allocation
      DROP CONSTRAINT IF EXISTS faculty_allocation_subject_type_check,
      DROP COLUMN IF EXISTS subject_type,
      DROP COLUMN IF EXISTS session_block_id
  `);
};
