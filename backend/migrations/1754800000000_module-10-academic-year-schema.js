'use strict';

// BusinessRules.md Academic/Timetable — Academic Year: "an institution
// operates under exactly one Active Academic Year at a time (lifecycle:
// Draft -> Active -> Closed -> Archived)." A tenant table like every
// other in this schema: ENABLE + FORCE ROW LEVEL SECURITY and a
// tenant_isolation policy on college_id, filtered by
// current_setting('app.current_tenant', true) — same pattern, same
// reasoning (ADR-002), not reinvented.
//
// status ('Draft' | 'Active' | 'Closed' | 'Archived', no CHECK
// constraint): known values enforced at the service layer, same house
// convention as fee_structures.status/classes.timetable_status/
// users.role. Default 'Draft' — a newly created academic year is never
// implicitly Active; BusinessRules.md's own rule ("only the Principal
// may request lifecycle transitions") means Active is always an
// explicit, later action, never the creation default.
//
// users_one_active_academic_year_per_college (a partial unique index,
// not a service-level check): "only one Academic Year may be Active at
// any time" is expressible as a genuine single-table constraint — same
// reasoning 1753400000000 (single active principal) gives for
// preferring a real DB backstop wherever the shape allows it. Unlike
// that migration, this one cannot be violated by pre-existing data
// (this table has no rows yet), so there is no "fail loudly on
// existing conflicts" concern to carry over.
//
// No deleted_at: an academic year is never soft-deleted — its
// lifecycle already has a terminal, non-destructive end state
// (Archived) that BusinessRules.md's Data retention/archival section
// covers; a second, parallel deletion mechanism would be redundant.
// The GRANT below has no DELETE for the same reason fee_structures/
// fee_payments/attendance_sessions omit it.
//
// No Aadhaar column anywhere (CLAUDE.md rule 8) — not applicable to
// this table regardless.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE academic_years (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id    TEXT NOT NULL REFERENCES colleges(college_id),
        year_label    TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'Draft',
        start_date    DATE,
        end_date      DATE,
        created_by_user_id UUID REFERENCES users(id),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // A college cannot define the same year_label twice (e.g. two
  // "2026-2027" rows) — mirrors fee_structures's own
  // college+key uniqueness reasoning, scoped to college_id since
  // year_label is deliberately free text, not globally unique.
  pgm.sql(`
    CREATE UNIQUE INDEX academic_years_college_year_label_key
        ON academic_years (college_id, year_label)
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX academic_years_one_active_per_college
        ON academic_years (college_id)
        WHERE status = 'Active'
  `);

  pgm.sql('ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE academic_years FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON academic_years
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON academic_years TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS academic_years');
};
