'use strict';

// RS-CLS-007: "A substitute may act only after L3 approves; the absent
// staff member, L3, or the class's L4 may initiate the request." The
// existing substitute_assignments table (Module 10) is left completely
// untouched — it remains the immutable record of an APPROVED substitute
// fact, INSERTed only once a request clears the workflow (mirrors
// staff_registration's own "the real users/staff row exists ahead of
// approval, workflow_requests just gates it" shape, except here nothing
// about the eventual fact can exist yet, since there's no pre-existing
// row like the staff invitation flow's own users/staff rows to attach a
// pending state to).
//
// substitute_assignment_requests holds the PROPOSED data only — one row
// per initiation, immutable once created (no UPDATE/DELETE grant, same
// as workflow_requests itself): the fact of "X requested a substitute
// for this period" never changes even if the request is later approved
// or rejected. workflow_requests.entity_id points at this table's id
// (entity_type = 'substitute_assignment'); on approval,
// academicService.approveSubstituteAssignment reads this row and
// INSERTs the real substitute_assignments row from it, reusing the
// exact same conflict/period-not-found mapping assignSubstitute already
// had.
//
// No status column here — workflow_requests.status is the single source
// of truth for Pending/Approved/Rejected, same "don't duplicate state
// workflow_requests already owns" reasoning studentService's
// pendingLifecycleStatus comment gives for why IT needed a column (there,
// the target row already existed and needed a place to stage the
// proposed value; here, the row doesn't exist until approval, so there's
// nothing to stage a value onto).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE substitute_assignment_requests (
        id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id                TEXT NOT NULL REFERENCES colleges(college_id),
        class_id                  UUID NOT NULL REFERENCES classes(id),
        timetable_period_id       UUID NOT NULL REFERENCES timetable_periods(id),
        assignment_date           DATE NOT NULL,
        original_staff_user_id    UUID REFERENCES users(id),
        substitute_staff_user_id  UUID NOT NULL REFERENCES users(id),
        reason                    TEXT,
        requested_by_user_id      UUID NOT NULL REFERENCES users(id),
        created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('ALTER TABLE substitute_assignment_requests ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE substitute_assignment_requests FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON substitute_assignment_requests
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // No DELETE, no UPDATE — an initiation request is a permanent fact
  // about what was asked for, same immutability substitute_assignments
  // itself already enforces at the GRANT level.
  pgm.sql(`GRANT SELECT, INSERT ON substitute_assignment_requests TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS substitute_assignment_requests');
};
