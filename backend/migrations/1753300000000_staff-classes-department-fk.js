'use strict';

// Resolves BusinessRules.md's own flagged gap (College Admin profile
// kickoff resolution): "staff.department and the Academic module's
// own department TEXT column are NOT migrated to a departments FK in
// this slice ... normalizing them ... is a real, separate future
// gap." This is that gap, closed additively — `department` (TEXT)
// stays exactly as it is (existing writers, e.g. the current Add
// Staff/Add Class UI, keep working unchanged); `department_id` is a
// new, nullable FK to `departments(id)` that new/updated callers can
// populate going forward, and that this migration backfills for
// EXISTING rows so nothing already in the table is left unlinked.
//
// Safe migration approach for old records: a plain UPDATE...FROM
// backfill can't run against a `departments` row that doesn't exist
// yet, so this migration first auto-creates one departments row per
// distinct (college_id, department) text value already present in
// staff/classes (ON CONFLICT DO NOTHING — a name may already exist
// from the College Admin department CRUD slice), then links
// department_id to it by exact (college_id, name) match. No row is
// ever deleted or overwritten destructively; a department text value
// that doesn't yet have a matching departments row gets one created
// FOR it, never the reverse.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE staff ADD COLUMN department_id UUID REFERENCES departments(id)');
  pgm.sql('ALTER TABLE classes ADD COLUMN department_id UUID REFERENCES departments(id)');

  // Auto-create any missing departments rows from existing free-text
  // values — the backfill below depends on every referenced name
  // already existing as a real departments row.
  pgm.sql(`
    INSERT INTO departments (college_id, name)
    SELECT DISTINCT college_id, department FROM staff
    WHERE department IS NOT NULL AND department <> ''
    ON CONFLICT (college_id, name) DO NOTHING
  `);
  pgm.sql(`
    INSERT INTO departments (college_id, name)
    SELECT DISTINCT college_id, department FROM classes
    WHERE department IS NOT NULL AND department <> ''
    ON CONFLICT (college_id, name) DO NOTHING
  `);

  pgm.sql(`
    UPDATE staff SET department_id = departments.id
    FROM departments
    WHERE staff.college_id = departments.college_id
      AND staff.department = departments.name
      AND staff.department_id IS NULL
  `);
  pgm.sql(`
    UPDATE classes SET department_id = departments.id
    FROM departments
    WHERE classes.college_id = departments.college_id
      AND classes.department = departments.name
      AND classes.department_id IS NULL
  `);

  // staff/classes already carry a full GRANT ... UPDATE for
  // arcnave_app since their first migration (no soft-delete/placeholder
  // grant distinction applies to a single new column) — no new GRANT
  // needed here.
};

exports.down = (pgm) => {
  // Departments rows this migration may have auto-created are left in
  // place on down() — by the time anyone runs this down, application
  // code may already depend on them independent of this migration
  // (e.g. via the College Admin department CRUD API), so deleting them
  // here would be a destructive guess this migration isn't in a
  // position to make safely.
  pgm.sql('ALTER TABLE classes DROP COLUMN IF EXISTS department_id');
  pgm.sql('ALTER TABLE staff DROP COLUMN IF EXISTS department_id');
};
