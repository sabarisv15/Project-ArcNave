'use strict';

// BusinessRules.md Attendance — correction workflow: "before lock,
// routine corrections are allowed [directly on attendance_sessions,
// already true — see markAttendance's own existing locked_at check].
// After lock, Subject Faculty submits a correction request; Class
// Tutor approves routine corrections... original attendance is never
// deleted; approved corrections become the effective attendance
// value... complete audit history is preserved."
//
// A new table rather than editing attendance_sessions in place: the
// rule is explicit that the original row must never be touched once
// locked, so a correction is its own row, referencing the session it
// proposes to change — the same "the entity's own row carries the
// pending/resolved state, workflow_requests tracks approval status"
// shape curriculum_migration's pending_regulation_id column
// established, but as its own table here since a session can
// accumulate more than one correction over time (each fully retained,
// per "complete audit history is preserved") rather than a single
// nullable column that would only ever hold the latest one.
//
// applied_at (nullable): set the moment a correction is approved —
// the "is this the current effective value" signal read directly off
// this table (most recent non-null applied_at for a session), without
// a join back to workflow_requests for ordinary reads. A rejected
// correction simply never gets one; it stays in the table regardless
// (the rejected proposal itself is part of the audit trail).
//
// Tenant table like every other in this schema: ENABLE + FORCE ROW
// LEVEL SECURITY, tenant_isolation policy on college_id (ADR-002).
//
// No deleted_at, no update/delete path: a correction request, once
// made, is a permanent fact (proposed such-and-such, on this date, for
// this reason) — same "permanently retained" treatment
// timetable_revisions/substitute_assignments already get. applied_at
// is the one field that changes after creation (via UPDATE, not
// service-level "editing" of the proposal itself), so UPDATE stays
// granted, unlike those two tables.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE attendance_corrections (
        id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id                  TEXT NOT NULL REFERENCES colleges(college_id),
        attendance_session_id       UUID NOT NULL REFERENCES attendance_sessions(id),
        requested_by_user_id        UUID NOT NULL REFERENCES users(id),
        proposed_absent_student_ids JSONB NOT NULL DEFAULT '[]',
        proposed_total_students     INTEGER NOT NULL,
        reason                      TEXT,
        workflow_request_id         UUID REFERENCES workflow_requests(id),
        applied_at                  TIMESTAMPTZ,
        created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('ALTER TABLE attendance_corrections ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE attendance_corrections FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON attendance_corrections
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON attendance_corrections TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS attendance_corrections');
};
