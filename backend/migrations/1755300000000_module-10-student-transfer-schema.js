'use strict';

// BusinessRules.md Students — Student transfer: "a student retains a
// single Permanent Student ID throughout their academic lifecycle...
// internal department/course transfers update academic context while
// preserving enrollment continuity; inter-college transfers create a
// new enrollment linked to the same Permanent Student ID... historical
// academic, attendance, financial, administrative, and document
// records remain in their original context."
//
// permanent_student_id: DEFAULT gen_random_uuid(), NOT NULL. Distinct
// from students.id on purpose — students.id is this ONE enrollment
// row's identity, scoped to one tenant by RLS; permanent_student_id is
// the portable identity BusinessRules.md describes, meant to be
// copied forward onto a second row in a DIFFERENT college's students
// table on inter-college transfer (two rows, two different college_id
// values, same permanent_student_id — the whole point). No UNIQUE
// constraint here for exactly that reason: uniqueness would forbid the
// one legitimate case this column exists for. Existing rows each get
// their own fresh, distinct value via the volatile default applied
// per-row during this ALTER (Postgres rewrites the table and evaluates
// gen_random_uuid() once per existing row, not once for the whole
// migration) — every already-enrolled student becomes their own
// Permanent Student ID's first enrollment, which is exactly correct
// since none of them have transferred yet.
//
// student_transfer_requests: a request/approval/audit record living
// entirely inside the SOURCE tenant's own RLS boundary. Deliberately
// does NOT create or touch any row in a different college's `students`
// table — this codebase's tenant isolation (ADR-002, one Postgres
// connection scoped to exactly one college_id via
// current_setting('app.current_tenant')) has no service-layer
// mechanism for writing into another tenant's data, and inventing one
// here would be a real, unreviewed expansion of that trust boundary,
// not a business-logic decision this migration should make alone. For
// an inter-college transfer, approving this request only marks the
// documented fact that the source college approved the student's
// departure (applied_at) — creating the destination college's own new
// enrollment row (linked by the same permanent_student_id) is a
// separate, later action on that college's own side, not automated by
// this table.
//
// transfer_type ('internal' | 'inter_college', no CHECK constraint):
// known values enforced at the service layer, same house convention as
// every other status-like column in this schema.
//
// destination_class_id: only meaningful for 'internal' (same-college)
// transfers — nullable, FK to classes, since an inter_college row has
// no local destination class to point at.
//
// destination_college_id: only meaningful for 'inter_college' transfers
// — a bare TEXT reference (not a foreign key): the destination might
// not even be an ARCNAVE tenant yet, and even when it is, this table
// deliberately has no cross-tenant read/write capability to validate
// against, per the file-level reasoning above.
//
// Tenant table like every other in this schema: ENABLE + FORCE ROW
// LEVEL SECURITY, tenant_isolation policy on college_id (ADR-002).
//
// No deleted_at, no update path beyond applied_at: a transfer request,
// once made, is a permanent fact — same "permanently retained" pattern
// timetable_revisions/substitute_assignments/attendance_corrections
// already establish.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE students ADD COLUMN permanent_student_id UUID NOT NULL DEFAULT gen_random_uuid()');

  pgm.sql(`
    CREATE TABLE student_transfer_requests (
        id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id             TEXT NOT NULL REFERENCES colleges(college_id),
        student_id             UUID NOT NULL REFERENCES students(id),
        permanent_student_id   UUID NOT NULL,
        transfer_type          TEXT NOT NULL,
        destination_class_id   UUID REFERENCES classes(id),
        destination_college_id TEXT,
        reason                 TEXT,
        requested_by_user_id   UUID NOT NULL REFERENCES users(id),
        workflow_request_id    UUID REFERENCES workflow_requests(id),
        applied_at             TIMESTAMPTZ,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('ALTER TABLE student_transfer_requests ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE student_transfer_requests FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON student_transfer_requests
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON student_transfer_requests TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS student_transfer_requests');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS permanent_student_id');
};
