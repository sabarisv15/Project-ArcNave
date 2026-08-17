'use strict';

// Assessment marks lock/submit/re-evaluation workflow. Supersedes the
// "any second write is a correction" model 1759000000000's own
// comment describes, for assessment marks only (attendance/fees keep
// their existing correction-only model — unaffected).
//
// Business shape, as given by the product owner: mark entry is not
// live/recurring like attendance — the assigned Subject Faculty enters
// freely, then explicitly "Save and Lock" (draft -> locked, freezing
// direct edits), then "Submit" whenever ready (locked -> submitted,
// making marks visible up the chain — HOD is Level 3 in the
// Principal=1/L2=2/HOD=3/Staff=4 scheme). Three states map to three
// edit mechanisms, reusing existing infrastructure where it already
// fits:
//   draft     -> direct edit (assessmentMarkRepository.update, no workflow)
//   locked    -> assessment_mark_corrections + tutor approval (UNCHANGED,
//                the existing RS-ASM-003 mechanism — this migration adds
//                no new column there, it just narrows *when* it applies)
//   submitted -> assessment_mark_reevaluations (new table below) + HOD
//                approval — a student disputing an already-submitted
//                mark, not a faculty self-correction, hence the
//                different approver and a separate table rather than
//                reusing assessment_mark_corrections.
//
// assessment_submissions is keyed by the same (academic_year, class_id,
// subject, assessment_type_id) tuple assessment_marks itself is scoped
// by — one row per "batch" of marks for one class/subject/assessment,
// not one row per mark, since lock/submit are batch actions performed
// once for the whole class at a time.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE assessment_submissions (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id          TEXT NOT NULL REFERENCES colleges(college_id),
        academic_year       TEXT NOT NULL,
        class_id            UUID NOT NULL REFERENCES classes(id),
        subject             TEXT NOT NULL,
        assessment_type_id  UUID NOT NULL REFERENCES assessment_types(id),
        status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'locked', 'submitted')),
        locked_at           TIMESTAMPTZ,
        locked_by_user_id   UUID REFERENCES users(id),
        submitted_at        TIMESTAMPTZ,
        submitted_by_user_id UUID REFERENCES users(id),
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX assessment_submissions_batch_key
        ON assessment_submissions (academic_year, class_id, subject, assessment_type_id)
  `);

  pgm.sql('ALTER TABLE assessment_submissions ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE assessment_submissions FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON assessment_submissions
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON assessment_submissions TO ${APP_ROLE}`);

  pgm.sql(`
    CREATE TABLE assessment_mark_reevaluations (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id              TEXT NOT NULL REFERENCES colleges(college_id),
        assessment_mark_id      UUID NOT NULL REFERENCES assessment_marks(id),
        requested_by_user_id    UUID NOT NULL REFERENCES users(id),
        proposed_marks_obtained NUMERIC NOT NULL,
        reason                  TEXT,
        workflow_request_id     UUID REFERENCES workflow_requests(id),
        applied_at              TIMESTAMPTZ,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('ALTER TABLE assessment_mark_reevaluations ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE assessment_mark_reevaluations FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON assessment_mark_reevaluations
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON assessment_mark_reevaluations TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS assessment_mark_reevaluations');
  pgm.sql('DROP TABLE IF EXISTS assessment_submissions');
};
