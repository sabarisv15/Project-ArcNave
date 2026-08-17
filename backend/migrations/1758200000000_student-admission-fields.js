'use strict';

// Create Student (AI-first admission) — Phase 1 of the admission-wizard
// plan (see the plan doc for full context). These fields exist so a
// Class Tutor admitting a student has somewhere to put data an admission
// document actually carries (DOB, blood group, community/banking/previous-
// education info) that the current create form has no column for at all.
// All nullable, purely additive — every existing student row and every
// existing caller of createStudent/updateStudent is unaffected.
//
// academic_year_id is the one FK here (-> academic_years, ON DELETE SET
// NULL): which academic year a student was admitted under is informational
// once set, so losing the referenced academic_years row should null this
// out, never block or cascade-delete the student.
//
// No new GRANT needed — students already has full
// GRANT SELECT, INSERT, UPDATE, DELETE for arcnave_app (module-1 migration).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE students ADD COLUMN dob DATE');
  pgm.sql('ALTER TABLE students ADD COLUMN blood_group TEXT');
  pgm.sql('ALTER TABLE students ADD COLUMN nationality TEXT');
  pgm.sql('ALTER TABLE students ADD COLUMN section TEXT');
  pgm.sql('ALTER TABLE students ADD COLUMN batch TEXT');
  pgm.sql('ALTER TABLE students ADD COLUMN admission_year INTEGER');
  pgm.sql('ALTER TABLE students ADD COLUMN register_number TEXT');
  pgm.sql('ALTER TABLE students ADD COLUMN academic_year_id UUID REFERENCES academic_years(id) ON DELETE SET NULL');
  pgm.sql('ALTER TABLE students ADD COLUMN school_name TEXT');
  pgm.sql('ALTER TABLE students ADD COLUMN school_type TEXT');
  pgm.sql('ALTER TABLE students ADD COLUMN education_board TEXT');
  pgm.sql('ALTER TABLE students ADD COLUMN previous_qualification TEXT');
  pgm.sql('ALTER TABLE students ADD COLUMN passing_year TEXT');
  pgm.sql('ALTER TABLE students ADD COLUMN community TEXT');
  pgm.sql('ALTER TABLE students ADD COLUMN community_cert_number TEXT');
  pgm.sql('ALTER TABLE students ADD COLUMN bank_account_holder_name TEXT');
  pgm.sql('ALTER TABLE students ADD COLUMN bank_name TEXT');
  pgm.sql('ALTER TABLE students ADD COLUMN bank_branch TEXT');
  pgm.sql('ALTER TABLE students ADD COLUMN bank_account_number TEXT');
  pgm.sql('ALTER TABLE students ADD COLUMN bank_ifsc_code TEXT');
  pgm.sql('ALTER TABLE students ADD COLUMN bank_account_type TEXT');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS bank_account_type');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS bank_ifsc_code');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS bank_account_number');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS bank_branch');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS bank_name');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS bank_account_holder_name');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS community_cert_number');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS community');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS passing_year');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS previous_qualification');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS education_board');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS school_type');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS school_name');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS academic_year_id');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS register_number');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS admission_year');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS batch');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS section');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS nationality');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS blood_group');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS dob');
};
