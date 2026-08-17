'use strict';

// BusinessRules.md Academic/Timetable — Substitute teacher provision:
// "when the assigned faculty member is unavailable, an authorized
// academic authority (HOD or equivalent) may temporarily assign
// another qualified faculty member to conduct the scheduled class. The
// assignment is session-scoped only... does not alter the official
// timetable... is fully audited (assigned faculty, substitute, period,
// reason, assigning authority)."
//
// A tenant table like every other in this schema: ENABLE + FORCE ROW
// LEVEL SECURITY, tenant_isolation policy on college_id (ADR-002).
//
// "Session-scoped only" is enforced by shape, not a runtime expiry
// job: this row names one (timetable_period_id, assignment_date) pair
// — a single occurrence of that weekly slot, not the recurring slot
// itself — so there is nothing to "expire" after the fact; the
// assignment simply doesn't apply to any date other than the one named
// (attendanceService's own lookup, added in this same slice, queries
// by that exact pair). UNIQUE (timetable_period_id, assignment_date):
// only one substitute per slot per date, mirroring
// attendance_sessions_class_date_hour_key's own "one row per real-world
// occurrence" reasoning.
//
// original_staff_user_id is nullable: BusinessRules.md doesn't require
// the slot to already have a real faculty_allocation row for a
// substitute to be assigned (a slot could be unallocated and still
// need covering) — recorded when known, for audit completeness, not
// re-derived by a join at read time.
//
// No deleted_at, no update path: an assignment, once made, is a fact
// about what happened for that date — same "permanently retained,
// never edited" treatment timetable_revisions gets, for the identical
// audit-trail reason. The GRANT below omits UPDATE/DELETE accordingly.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE substitute_assignments (
        id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id                TEXT NOT NULL REFERENCES colleges(college_id),
        class_id                  UUID NOT NULL REFERENCES classes(id),
        timetable_period_id       UUID NOT NULL REFERENCES timetable_periods(id),
        assignment_date           DATE NOT NULL,
        original_staff_user_id    UUID REFERENCES users(id),
        substitute_staff_user_id  UUID NOT NULL REFERENCES users(id),
        assigning_authority_user_id UUID NOT NULL REFERENCES users(id),
        reason                    TEXT,
        created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // (class_id, timetable_period_id, assignment_date), not just
  // (timetable_period_id, assignment_date): timetable_periods is the
  // SHARED college-wide bell schedule (one row per (college, day,
  // hour), reused by every class's own faculty_allocation row for that
  // slot — see the Module 3 timetable-normalization migration's own
  // comment). A bare (period, date) key would let only one class in
  // the entire college ever have a substitute for "Monday Hour 1" on a
  // given date, wrongly blocking every other, unrelated class's own
  // substitute for the identical shared slot.
  pgm.sql(`
    CREATE UNIQUE INDEX substitute_assignments_class_period_date_key
        ON substitute_assignments (class_id, timetable_period_id, assignment_date)
  `);

  pgm.sql('ALTER TABLE substitute_assignments ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE substitute_assignments FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON substitute_assignments
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT ON substitute_assignments TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS substitute_assignments');
};
