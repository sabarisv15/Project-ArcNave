'use strict';

// students.class_id — the "which class is this student enrolled in"
// link that never existed anywhere in this schema (attendance_sessions
// only ever stored a per-day absent_student_ids array against a
// class_id, never a persistent enrollment table). Added now because
// item 5 of this session's task (Send Alert, tutor -> own class) needs
// a real "students in a class" lookup to resolve recipients against —
// not built speculatively, built because this feature has no other way
// to answer that question.
//
// Nullable, no default: a student can exist unassigned to any class
// (matching how classes.tutor_user_id is also nullable — "no class yet"
// is a valid, expected state, same as "no tutor yet"). No UNIQUE
// constraint: many students share one class_id, the normal case.
//
// ON DELETE SET NULL, not RESTRICT: deleting a class should not block
// on students still pointing at it (there is no soft-delete anywhere in
// this schema yet — see studentRepository.js/classRepository.js's own
// open-question comments), and "student now has no class" is a
// reasonable, recoverable state, unlike faculty_allocation's FK into
// timetable_periods (a real scheduling fact this migration has no
// equivalent of).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE students
        ADD COLUMN class_id UUID REFERENCES classes(id) ON DELETE SET NULL
  `);
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS class_id');
};
