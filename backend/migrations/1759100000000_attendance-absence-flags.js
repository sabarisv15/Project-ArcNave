'use strict';

// RS-ATT-008/RS-NTF-005 (D6, Stage 6, ADL-011): "A student absent for more
// than five consecutive working days raises an automatic system
// notification to L3 carrying a mandatory review action... It stays
// outstanding until acted on — never a message that can silently go
// unread." ADL-011's own migration note: "a new notification type plus
// a lightweight outstanding-flag state for the absence flag" —
// deliberately NOT a workflow_requests entity (ADL-011: "there is
// nothing to approve or reject, only to close. Modelling it as a
// workflow request would misrepresent it and add an approver where
// none exists"), so this is its own small table, not routed through
// WorkflowService.
//
// One outstanding flag per student at a time (partial unique index on
// student_id WHERE closed_at IS NULL) — re-triggering the same
// still-open condition must never pile up duplicate flags for the same
// student; attendanceService's own raise logic checks this first, but
// the index is the structural guarantee.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE attendance_absence_flags (
        id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id                TEXT NOT NULL REFERENCES colleges(college_id),
        student_id                UUID NOT NULL REFERENCES students(id),
        class_id                  UUID NOT NULL REFERENCES classes(id),
        consecutive_absent_days   INTEGER NOT NULL,
        raised_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
        closed_at                 TIMESTAMPTZ,
        closed_by_user_id         UUID REFERENCES users(id),
        closure_remarks           TEXT,
        created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX attendance_absence_flags_student_outstanding_key
        ON attendance_absence_flags (student_id)
        WHERE closed_at IS NULL
  `);

  pgm.sql('ALTER TABLE attendance_absence_flags ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE attendance_absence_flags FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON attendance_absence_flags
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON attendance_absence_flags TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS attendance_absence_flags');
};
