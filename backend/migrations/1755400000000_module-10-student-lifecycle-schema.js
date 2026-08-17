'use strict';

// BusinessRules.md Students — Student lifecycle: "Applied, Admitted,
// Active, Suspended, Discontinued, Debarred, Dismissed, Graduated,
// Alumni, and Archived are recognized lifecycle states. Attendance
// status is governed separately by attendance records... every status
// change is permanently audited (previous status, new status,
// effective date, updated by, reason)."
//
// lifecycle_status TEXT NOT NULL DEFAULT 'Active': known values
// enforced at the service layer, same house convention as every other
// status-like column in this schema. 'Active' as the default, not
// 'Applied'/'Admitted': a `students` row in this codebase is only ever
// created once a Class Tutor has already admitted the student into a
// real class (studentService.createStudent requires a real classId) —
// Applied/Admitted describe a pre-enrollment stage this schema has no
// row for yet (no admissions-pipeline table exists), so every row that
// can exist today already represents an Active enrollment. Every
// pre-existing row backfills to 'Active' for the identical reason.
//
// pending_lifecycle_status / pending_lifecycle_reason: the same "the
// entity's own row carries the pending change, workflow_requests
// tracks approval status" pattern curriculum migration's
// pending_regulation_id already established — used only for the
// high-severity transitions BusinessRules.md names as requiring
// approval (Discontinued, Debarred, Dismissed, and Graduated/Alumni),
// not for ordinary tutor-set status changes, which apply directly.
//
// current_semester: nullable INTEGER — the counter semester
// progression increments. Nullable because not every institution using
// this schema necessarily tracks it from day one; a null value simply
// means "not yet tracked for this student," not zero.
//
// student_lifecycle_events: the permanent audit ledger BusinessRules.md
// explicitly names by its own field list (previous status, new status,
// effective date, updated by, reason) — a dedicated, queryable table
// for a "this student's lifecycle history" screen, not folded into the
// generic audit_log's opaque JSON metadata the way a less-structured
// event would be. Tenant table like every other in this schema: ENABLE
// + FORCE ROW LEVEL SECURITY, tenant_isolation policy on college_id
// (ADR-002). No update/delete path — a lifecycle event, once recorded,
// is a permanent fact, same "permanently retained" pattern
// timetable_revisions/attendance_corrections/student_transfer_requests
// already establish.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql("ALTER TABLE students ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'Active'");
  pgm.sql('ALTER TABLE students ADD COLUMN pending_lifecycle_status TEXT');
  pgm.sql('ALTER TABLE students ADD COLUMN pending_lifecycle_reason TEXT');
  pgm.sql('ALTER TABLE students ADD COLUMN current_semester INTEGER');

  pgm.sql(`
    CREATE TABLE student_lifecycle_events (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id           TEXT NOT NULL REFERENCES colleges(college_id),
        student_id           UUID NOT NULL REFERENCES students(id),
        previous_status      TEXT NOT NULL,
        new_status           TEXT NOT NULL,
        effective_date       DATE NOT NULL,
        reason               TEXT NOT NULL,
        updated_by_user_id   UUID NOT NULL REFERENCES users(id),
        workflow_request_id  UUID REFERENCES workflow_requests(id),
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('ALTER TABLE student_lifecycle_events ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE student_lifecycle_events FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON student_lifecycle_events
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT ON student_lifecycle_events TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS student_lifecycle_events');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS current_semester');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS pending_lifecycle_reason');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS pending_lifecycle_status');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS lifecycle_status');
};
