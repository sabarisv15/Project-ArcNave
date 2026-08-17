'use strict';

// RS-ACA-002 / ADL-003 (D8): Academic Year lifecycle is
// `Draft -> Active -> Completed`, Completed terminal. `Closed` is
// renamed to `Completed`; `Archived` is retired as a lifecycle state —
// record archival is a record-keeping mechanism on top
// (RS-DAT-003), not a further state the year itself passes through.
//
// Real data migration (existing rows carry `Closed`/`Archived`, no
// CHECK constraint currently narrows them) — not a code-only relabel.
// Down migration folds `Completed` back to `Closed`; the Archived/Closed
// distinction on pre-existing rows cannot be recovered (both mapped
// forward to `Completed`), which is intentional per the same reasoning
// removing the state entirely.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    UPDATE academic_years SET status = 'Completed' WHERE status IN ('Closed', 'Archived')
  `);

  pgm.sql(`
    ALTER TABLE academic_years
      ADD CONSTRAINT academic_years_status_check CHECK (status IN ('Draft', 'Active', 'Completed'))
  `);
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE academic_years DROP CONSTRAINT IF EXISTS academic_years_status_check');
  pgm.sql(`
    UPDATE academic_years SET status = 'Closed' WHERE status = 'Completed'
  `);
};
