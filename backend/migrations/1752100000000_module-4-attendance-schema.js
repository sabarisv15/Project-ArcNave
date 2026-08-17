'use strict';

// Module 4 (Attendance), first vertical slice: `attendance_sessions`
// table only — no service/API/UI yet. See .ai/TASK.md.
//
// attendance_sessions is a tenant table like classes/staff/students:
// ENABLE + FORCE ROW LEVEL SECURITY and a tenant_isolation policy on
// college_id, filtered by current_setting('app.current_tenant', true)
// — same pattern, same reasoning (ADR-002), not reinvented here.
//
// Grain: one row per (class, calendar date, hour) — a single period's
// roll call, not one row per student. Grounded directly against the
// real, working StaffDashboard.jsx attendance-marking flow:
// POST /api/staff/mark-period-attendance sends exactly
// { tutor_id, hour_index, absent_rolls, date_key } for one period at a
// time, and GET /api/staff/my-schedule reads back one `period_record`
// (`{ absent_rolls, present, total }`) per period, never a per-student
// row. A normalized per-student attendance_records join table was
// considered and rejected for this slice, same reasoning Module 3's
// first slice used to reject normalizing subjects/periods out of
// classes.timetable_data: nothing in the real, working frontend
// queries "all attendance rows for student X" as a structured filter
// — every real screen operates per-period. Revisit only if/when a
// real screen needs that query shape.
//
// class_id (not tutor_id): the prototype's mark-period-attendance
// identifies a period by tutor_id (a username), because in the old
// model tutor uniquely identified a class. The real classes table
// (Module 3) is the class identity now — class_id UUID FK replaces
// tutor_id, matching the same tutor_id -> tutor_user_id migration
// Module 3's fourth slice already made on the read side.
//
// hour_index is the 1-based column position into classes.timetable_data's
// headers/rows grid (index 0 is the "Day" label column) — matches
// TutorClass.jsx's `for (let i = 1; i < timetable.headers.length; i++)`
// loop and "Hour {i}" labels exactly. No CHECK constraint bounding it
// against the grid's actual width, same house convention as
// timetable_status having no CHECK — the grid can change shape, this
// column doesn't second-guess it.
//
// subject/staffDisplay are deliberately NOT persisted columns here:
// StaffDashboard.jsx's schedule entries always re-derive them live
// from classes.timetable_data's cell text (e.g. "DBMS (Dr. Amit)"),
// never reads them back from a `period_record`. Storing a redundant
// snapshot would be inventing a field nothing reads.
//
// absent_student_ids (JSONB array of students.id UUIDs, not roll
// numbers): the wire shape (`absent_rolls`) is roll-number strings,
// but that's what StaffDashboard.jsx's mark-period-attendance sends
// today for a prototype with no auth-resolved student identity behind
// it. Resolving a human-facing roll_no to a real students.id FK is
// exactly the kind of "resolve human identifiers into real IDs"
// AttendanceService's job (not built this slice) — same layering
// staffService.createStaff already established (takes an
// already-resolved userId, never a username). The column stores the
// resolved form a real service would produce, matching the FK-not-
// username precedent Module 2/3 already settled for
// classes.tutor_user_id.
//
// total_students: a snapshot of roster size at marking time, not a
// live join — directly grounded in `period_record.total`, which the
// real frontend reads back verbatim rather than recomputing.
//
// marked_by_user_id is NOT NULL: a row only exists once a period has
// actually been marked (mirrors `already_marked` in the real
// schedule response — its truth *is* row existence, there's no
// separate boolean to track). There is no "pending/unmarked session"
// row state in this slice.
//
// locked_at (nullable, unset by this slice): BusinessRules.md
// Attendance states "Attendance cannot be modified after it is
// locked" as a hard rule — unlike timetable_status's known-values
// enforcement, the real prototype frontend does not implement this at
// all today (StaffDashboard.jsx's "Update Attendance" button re-marks
// indefinitely, no lock check anywhere). The column is added now
// because CLAUDE.md/BusinessRules.md are authoritative over prototype
// behavior (the prototype "validated scope only, not the
// foundation"), same reasoning Module 3 added timetable_status's known
// value set before any transition logic enforced it. The actual lock
// transition (who locks, when) is real business logic, deferred to a
// later Attendance slice, not invented here — this column only makes
// the state representable.
//
// deleted_at (soft-delete, unlike students/staff/classes which left
// this an explicitly open question): BusinessRules.md's AI section is
// unambiguous and names this table by domain — "The AI is never given
// a hard-delete capability on attendance, fees, or marks records, even
// with approval — only soft-delete (a flag/timestamp)." This is a
// resolved rule, not a deferred one, so this slice resolves it at the
// ERD level rather than repeating the "left open" treatment. The
// GRANT below deliberately omits DELETE to arcnave_app — enforced at
// the DB permission level, not just by AttendanceRepository never
// issuing a DELETE statement (defense in depth: even a buggy or
// compromised service call literally cannot hard-delete this table).
//
// UNIQUE (class_id, session_date, hour_index) WHERE deleted_at IS NULL:
// a partial unique index, not a plain UNIQUE constraint — "this exact
// period was already marked today" must be enforceable among live
// rows only, or a soft-deleted session would permanently block ever
// re-marking that period. No other table in this schema needed this
// yet (none of them have deleted_at), so this is new, not copied.
//
// No Aadhaar column anywhere (CLAUDE.md rule 8).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE attendance_sessions (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id          TEXT NOT NULL REFERENCES colleges(college_id),
        class_id            UUID NOT NULL REFERENCES classes(id),
        session_date        DATE NOT NULL,
        hour_index          INT NOT NULL,
        marked_by_user_id   UUID NOT NULL REFERENCES users(id),
        absent_student_ids  JSONB NOT NULL DEFAULT '[]',
        total_students      INT NOT NULL,
        locked_at           TIMESTAMPTZ,
        deleted_at          TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX attendance_sessions_class_date_hour_key
        ON attendance_sessions (class_id, session_date, hour_index)
        WHERE deleted_at IS NULL
  `);

  pgm.sql('ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE attendance_sessions FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON attendance_sessions
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // No DELETE grant — soft-delete only (deleted_at), per
  // BusinessRules.md's AI section. See the file-level comment above.
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON attendance_sessions TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS attendance_sessions');
};
