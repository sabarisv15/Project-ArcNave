'use strict';

// BusinessRules.md Documents / Reports — Assessment marks: "assessment
// types are institution-wide, configurable, editable by authorized
// administrators... the assigned Subject Faculty records assessment
// marks for their subject against institution-configured assessment
// types; the system stores marks exactly as entered — no automatic
// grade, best-of, or weightage calculation."
//
// assessment_types: institution-wide (college_id-scoped, not tied to
// a class/department/subject) — matches the rule's own "institution-
// wide" wording exactly; a specific class/subject's use of a type is
// assessment_marks' own job, not this table's.
//
// assessment_marks: subject stays free text, matching
// faculty_allocation.subject's own existing convention (Module 3's
// deliberate "no normalized subjects table for this join" decision) —
// "assigned Subject Faculty" is checked against faculty_allocation's
// existing (class_id, subject, staff_user_id) shape, so using the
// identical free-text key here, not the newer curriculum `subjects`
// table (task #2), keeps that check meaningful without requiring every
// institution to have adopted structured curriculum data first.
// academic_year is also free text, matching fee_structures.academic_year's
// own precedent, not a FK to `academic_years` (task #1) — BusinessRules.md
// doesn't tie assessment marks to the Academic Year lifecycle state
// machine specifically, only names it as one of several filter
// dimensions, same as the other free-text filters here.
//
// UNIQUE (student_id, assessment_type_id, class_id, subject): one mark
// per student per assessment per subject per class — re-entry is an
// UPDATE, not a second row, same "one row per real-world fact"
// reasoning attendance_sessions_class_date_hour_key already
// establishes. marks_obtained is nullable-free (NOT NULL): a row only
// exists once a mark has actually been entered, same "row's mere
// existence carries meaning" precedent attendance_sessions/fee_payments
// already set — a student with no mark yet simply has no row (the
// AI's "missing mark detection," a future concern, works from that
// absence, not a null placeholder).
//
// Tenant tables like every other in this schema: ENABLE + FORCE ROW
// LEVEL SECURITY, tenant_isolation policy on college_id (ADR-002).
// deleted_at on assessment_marks (soft-delete only, matching
// attendance_sessions/fee_structures' own precedent for student-record
// data); no deleted_at on assessment_types — a type, once created, is
// institution configuration, not a student-facing record; removing one
// is a real, separate future concern (what happens to marks already
// entered against it?), not guessed at here.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE assessment_types (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id    TEXT NOT NULL REFERENCES colleges(college_id),
        name          TEXT NOT NULL,
        max_marks     NUMERIC,
        created_by_user_id UUID REFERENCES users(id),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX assessment_types_college_name_key
        ON assessment_types (college_id, name)
  `);

  pgm.sql('ALTER TABLE assessment_types ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE assessment_types FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON assessment_types
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON assessment_types TO ${APP_ROLE}`);

  pgm.sql(`
    CREATE TABLE assessment_marks (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id          TEXT NOT NULL REFERENCES colleges(college_id),
        academic_year       TEXT NOT NULL,
        class_id            UUID NOT NULL REFERENCES classes(id),
        subject             TEXT NOT NULL,
        assessment_type_id  UUID NOT NULL REFERENCES assessment_types(id),
        student_id          UUID NOT NULL REFERENCES students(id),
        marks_obtained      NUMERIC NOT NULL,
        entered_by_user_id  UUID NOT NULL REFERENCES users(id),
        deleted_at          TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX assessment_marks_student_assessment_class_subject_key
        ON assessment_marks (student_id, assessment_type_id, class_id, subject)
        WHERE deleted_at IS NULL
  `);

  pgm.sql('ALTER TABLE assessment_marks ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE assessment_marks FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON assessment_marks
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON assessment_marks TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS assessment_marks');
  pgm.sql('DROP TABLE IF EXISTS assessment_types');
};
