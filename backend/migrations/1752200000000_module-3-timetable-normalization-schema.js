'use strict';

// Module 3 (Academic), new vertical slice: `timetable_periods` +
// `faculty_allocation` — no service/API/UI yet. See .ai/TASK.md.
//
// This is the normalization Module 4's second slice
// (attendanceService.js, 82f8479) explicitly triggered: it documented
// that "the staff member scheduled for that period" (BusinessRules.md
// Attendance's third named eligible marker) could not be verified,
// because classes.timetable_data is a free-text CSV grid with no real
// staff link — resolving a cell like "DBMS (Dr. Amit)" to a real
// user_id would mean heuristic text matching behind an authorization
// decision, which that slice correctly refused to build. These two
// tables are the real, structured link that makes that verification
// possible in a future AttendanceService slice — not built here,
// only enabled.
//
// classes.timetable_data is UNCHANGED and UNTOUCHED by this
// migration: the real, working frontend (TutorClass.jsx/
// TutorClassMonitor.jsx) still renders the timetable grid straight
// from that JSONB blob, and nothing in this slice repoints that
// display. These two tables are purely additive, parallel structure —
// "don't lose the display use case" per .ai/TASK.md's own framing.
// Keeping both in sync (e.g. a CSV upload populating both
// timetable_data and faculty_allocation at once) is real
// AcademicService business logic, explicitly deferred to a later
// slice, not attempted at the ERD/repository layer.
//
// Two tables, not one, because "period" and "who teaches what, when"
// are genuinely different things at different scopes:
//
// - `timetable_periods`: the SHARED bell schedule — one row per
//   (college_id, day_of_week, hour_index) giving that slot's
//   start_time/end_time. "Shared" is deliberate and grounded: every
//   class's timetable_data.headers in the real frontend is the same
//   flat list of time ranges (e.g. "09:00 - 10:00", "10:00 - 11:00",
//   ...) applied identically across every row (day) — nothing in the
//   real, working frontend gives different classes different bell
//   times. Scoped to college_id, not class_id: a real institution has
//   one bell schedule for everyone, not one per class or per
//   department. hour_index matches attendance_sessions.hour_index's
//   existing meaning exactly (the same 1-based column position into
//   the grid), reused rather than inventing a synonym
//   ("period_index") for the identical concept.
//
// - `faculty_allocation`: the real join — one row per (class_id,
//   period_id) naming which subject is taught and which staff user
//   teaches it. day_of_week is NOT duplicated here: it already lives
//   on the referenced timetable_periods row, so a class's Monday-
//   Hour-1 and Tuesday-Hour-1 allocations are simply two different
//   rows pointing at two different periods, not two columns on one
//   row. subject stays free text (no normalized `subjects` table) —
//   unchanged from Module 3's first slice's own explicit decision not
//   to build one; only the staff link is being made real here.
//   staff_user_id -> users(id), nullable, not staff(id): follows the
//   same "Resolved (Module 2 kickoff)" BusinessRules.md entry
//   classes.tutor_user_id already follows — a faculty reference is a
//   users.id, never a staff.id or a role grant. Nullable because a
//   period can be a real, named non-teaching slot (the prototype
//   grid's "Lunch"/"Library"/"Sports"/"Placement" cells) with a
//   subject label but no staff assigned; a period with genuinely
//   nothing scheduled (a blank grid cell) simply has no
//   faculty_allocation row at all for that (class_id, period_id) pair
//   — the absence of a row is "free/unscheduled," not a special flag.
//
// UNIQUE (class_id, period_id): a class can only have one subject/
// staff assignment per period — the same one-row-per-slot invariant
// the free-text grid already enforces implicitly (each cell holds
// exactly one value).
//
// UNIQUE (period_id, staff_user_id): a staff member cannot be
// double-booked to teach two different classes during the same
// period — the same "one row can't represent two conflicting real-
// world facts" reasoning classes' UNIQUE (tutor_user_id) already
// applies to tutor assignment, extended here to teaching assignment.
// NULLs remain distinct under this constraint (multiple
// non-teaching/no-staff periods coexist freely), same proof technique
// classes_tutor_user_id_key's NULL-coexistence case already
// established.
//
// Both tables are tenant-scoped like every other table in this
// schema: ENABLE + FORCE ROW LEVEL SECURITY, tenant_isolation policy
// on college_id, filtered by current_setting('app.current_tenant',
// true) — identical pattern, not reinvented.
//
// No soft-delete column on either table: unlike attendance_sessions
// (which BusinessRules.md's AI section names by domain as
// soft-delete-only), neither schedule metadata table is named by that
// rule — same open-question treatment students/staff/classes already
// got, DELETE granted as a placeholder, not a settled decision.
//
// No Aadhaar column anywhere (CLAUDE.md rule 8 — moot for schedule
// metadata, kept for the same explicit-absence discipline regardless).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE timetable_periods (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id    TEXT NOT NULL REFERENCES colleges(college_id),
        day_of_week   TEXT NOT NULL,
        hour_index    INT NOT NULL,
        start_time    TIME NOT NULL,
        end_time      TIME NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (college_id, day_of_week, hour_index)
    )
  `);

  pgm.sql('ALTER TABLE timetable_periods ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE timetable_periods FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON timetable_periods
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON timetable_periods TO ${APP_ROLE}`);

  pgm.sql(`
    CREATE TABLE faculty_allocation (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id      TEXT NOT NULL REFERENCES colleges(college_id),
        class_id        UUID NOT NULL REFERENCES classes(id),
        period_id       UUID NOT NULL REFERENCES timetable_periods(id),
        subject         TEXT NOT NULL,
        staff_user_id   UUID REFERENCES users(id),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (class_id, period_id),
        UNIQUE (period_id, staff_user_id)
    )
  `);

  pgm.sql('ALTER TABLE faculty_allocation ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE faculty_allocation FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON faculty_allocation
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON faculty_allocation TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS faculty_allocation');
  pgm.sql('DROP TABLE IF EXISTS timetable_periods');
};
