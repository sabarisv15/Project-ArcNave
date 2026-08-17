'use strict';

// RS-CLS-002: "A class is auto-generated the moment a department is
// created... one class per (year-within-department × section)
// combination." There is no existing notion of "how many sections"
// anywhere in this schema — courseDuration (added in
// 1758600000000_organization-provisioning-and-structural-keys.js)
// supplies the year axis, but nothing supplies the section axis. Per
// product decision (not a platform-wide default): the department's
// own creator specifies its section count at creation time, same
// per-tenant, no-hardcoded-assumption treatment courseDuration/
// approvedIntake already get.
//
// Nullable at the DB level, same treatment approvedIntake/
// courseDuration already have — every EXISTING department in dev/demo
// data predates this column and never had classes auto-generated for
// it (the feature didn't exist yet), so there is nothing to backfill.
// Going forward, collegeProfileService.createDepartment/
// platformService.createDepartmentAtOnboarding both require it
// (service-level validation, not a DB CHECK) before generation can run.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE departments ADD COLUMN default_sections INT');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE departments DROP COLUMN IF EXISTS default_sections');
};
