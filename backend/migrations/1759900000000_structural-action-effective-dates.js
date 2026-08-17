'use strict';

// RS-GOV-005 wizard, option A: the source design gives every one of the
// 5 sections its own "Effective Date" field — previously dropped
// silently because nothing stored it. Real columns now, one per
// section, on whichever table that section's other fields already
// live on (colleges for l2/affiliation/accreditation, college_campuses
// for campus, departments for department). Not a single shared
// "effective_date" column anywhere: a college can have one active
// dated change per section in flight, not one dated change overall.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE colleges
      ADD COLUMN l2_effective_date DATE,
      ADD COLUMN affiliation_effective_date DATE,
      ADD COLUMN accreditation_effective_date DATE
  `);
  pgm.sql('ALTER TABLE college_campuses ADD COLUMN effective_date DATE');
  // No new GRANT needed here — departments already has a table-wide
  // GRANT SELECT, INSERT, UPDATE, DELETE for arcnave_app (1753000000000).
  pgm.sql('ALTER TABLE departments ADD COLUMN structural_effective_date DATE');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE departments DROP COLUMN IF EXISTS structural_effective_date');
  pgm.sql('ALTER TABLE college_campuses DROP COLUMN IF EXISTS effective_date');
  pgm.sql(`
    ALTER TABLE colleges
      DROP COLUMN IF EXISTS l2_effective_date,
      DROP COLUMN IF EXISTS affiliation_effective_date,
      DROP COLUMN IF EXISTS accreditation_effective_date
  `);
};
