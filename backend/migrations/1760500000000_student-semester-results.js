'use strict';

// Students List redesign (2026-07-30): "Backlog" filter/column needs a
// real data source. Confirmed with the user: backlog is NOT computed
// from assessment_marks/max_marks (RS-ASM's own "no institutional
// internal mark calculation is ever performed" rule already forbids
// that) — it is the semester-end result as printed on the student's
// official result copy, entered directly by staff exactly as it reads
// (Pass or RA/arrear), one row per subject per semester. Same
// "storage, not computation" philosophy assessmentService.js's own
// recordMark already documents.
//
// One row per (student, academic_year, semester, subject) — a later
// entry for the same triple is an edit to the SAME fact (the printed
// result for that subject that semester never changes), not a new
// historical fact, so it's UPSERTed via the unique constraint, same
// "the record has one current value" reasoning student_flags' cleared_
// at column update uses, not assessment_mark_corrections' separate-row
// append-only history (there is no institution-side "correction
// workflow" for a mis-typed result — a staff member just re-enters it
// correctly, same authority as entering it the first time).
//
// document_id is a nullable FK to `documents` (DocumentService owns
// the actual file — CLAUDE.md rule 2 — this table only ever points at
// a row DocumentService already created via its own uploadDocument
// path, never touches storage itself).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE student_semester_results (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id            TEXT NOT NULL REFERENCES colleges(college_id),
        student_id            UUID NOT NULL REFERENCES students(id),
        academic_year         TEXT NOT NULL,
        semester              INTEGER NOT NULL,
        subject               TEXT NOT NULL,
        result_status         TEXT NOT NULL,
        document_id           UUID REFERENCES documents(id),
        recorded_by_user_id   UUID NOT NULL REFERENCES users(id),
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (student_id, academic_year, semester, subject)
    )
  `);

  pgm.sql('CREATE INDEX student_semester_results_student_id_idx ON student_semester_results (student_id)');

  pgm.sql('ALTER TABLE student_semester_results ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE student_semester_results FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON student_semester_results
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON student_semester_results TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS student_semester_results');
};
