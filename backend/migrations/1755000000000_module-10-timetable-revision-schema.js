'use strict';

// BusinessRules.md Academic/Timetable — Timetable revision: "an
// approved timetable is immutable. Any permanent academic change is
// recorded as a new, numbered, dated revision... only one revision may
// be effective for a given timetable scope at a time; attendance
// always uses the revision effective on the class date... all
// revisions are permanently retained."
//
// This is deliberately an ADDITIVE historical ledger on top of the
// existing classes.timetable_status approval gate
// (academicService.submitTimetableForApproval/approveTimetableApproval/
// rejectTimetableApproval, Module 3->4), not a replacement for it: a
// new row here is created every time a timetable_approval workflow
// request resolves to 'Approved' (see academicService.js's own
// approveTimetableApproval, updated in this same slice). The existing
// attendanceService.assertTimetableApproved gate still reads
// classes.timetable_status directly and is UNCHANGED by this
// migration — rewiring it to consult a revision's effective_from
// instead of the flat status column is a real, separate behavior
// change (what happens to a class whose newest revision is effective
// in the future?) deliberately left as its own follow-up, not silently
// bundled in here.
//
// revision_number: per-class, starting at 1, assigned by the service
// (COUNT of existing rows + 1) rather than a DB sequence/window
// function — the same "service computes it, greater flexibility if the
// numbering rule ever needs a business exception" reasoning
// staffService.js's own staff_code generation already follows,
// enforced here by the unique index below rather than trusted blindly.
//
// effective_from: the date this revision becomes the authoritative one
// for the class; defaults to CURRENT_DATE at the service layer (not a
// DB default) so a caller submitting a future-dated revision is a
// deliberate, explicit choice, not an accident of when the row happens
// to be inserted.
//
// No deleted_at: "all revisions are permanently retained" — there is
// no removal path for this table at all, structurally, matching
// fee_structures/attendance_sessions's own "no hard-delete function
// exposed" precedent but taken one step further (no soft-delete either,
// since a revision is never meant to be un-created).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE timetable_revisions (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id          TEXT NOT NULL REFERENCES colleges(college_id),
        class_id            UUID NOT NULL REFERENCES classes(id),
        revision_number     INTEGER NOT NULL,
        effective_from      DATE NOT NULL,
        workflow_request_id UUID REFERENCES workflow_requests(id),
        created_by_user_id  UUID REFERENCES users(id),
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX timetable_revisions_class_revision_number_key
        ON timetable_revisions (class_id, revision_number)
  `);

  pgm.sql('ALTER TABLE timetable_revisions ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE timetable_revisions FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON timetable_revisions
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // SELECT/INSERT only — no UPDATE, no DELETE. A revision, once
  // created, never changes; see the file-level comment.
  pgm.sql(`GRANT SELECT, INSERT ON timetable_revisions TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS timetable_revisions');
};
