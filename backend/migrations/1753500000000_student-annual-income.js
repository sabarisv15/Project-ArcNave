'use strict';

// Adds the one column financeService.checkScholarshipEligibility needs
// (BusinessRules.md Finance: "Students below a configured income
// threshold become scholarship eligible"). Nullable — every existing
// row predates this migration and has nothing to backfill, same
// treatment collegeProfileService's three new colleges columns got.
// No new GRANT: students already has a full arcnave_app UPDATE grant
// from its first migration.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE students ADD COLUMN annual_income NUMERIC');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS annual_income');
};
