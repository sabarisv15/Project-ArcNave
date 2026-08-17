'use strict';

// BusinessRules.md Configurable approval workflow: "ARCNAVE shall
// provide a configurable workflow engine that allows each institution
// to define approval hierarchies for different modules... temporary
// delegation supports start date, end date, reason, and delegated
// approver... HOD In-Charge appointments automatically act as workflow
// delegates where applicable."
//
// HOD delegation is ALREADY solved structurally: staffService.
// findHodForDepartment (task #10) already falls back to an active
// hod_in_charge_appointments row when no permanent HOD exists, and
// every existing HOD-resolving approval chain already calls that same
// function — no second delegation path is needed for HOD specifically.
// This table is the GENERIC case BusinessRules.md's own wording also
// names ("delegated approver," not "HOD In-Charge" specifically) —
// e.g. a Principal going on leave and delegating approval authority to
// someone else for a date range, which nothing in this schema handles
// yet.
//
// role: free text ('principal', 'hod', 'tutor', or any future chain
// role), matching the same role-name convention approver_chain entries
// already use (workflowService.js's own {step, role, user_id} shape).
// department_id: nullable — only meaningful when role scopes to a
// department (e.g. a delegated 'hod'-equivalent duty for one specific
// department); a college-wide role like 'principal' leaves this null.
//
// end_date nullable: an open-ended delegation (no planned end) is a
// real, valid case, not required to guess a date.
//
// revoked_at nullable: a delegation can be ended early, same
// non-destructive "flip a flag, never delete" pattern
// hod_in_charge_appointments already establishes — permanently
// retained for audit, never removed.
//
// Tenant table like every other in this schema: ENABLE + FORCE ROW
// LEVEL SECURITY, tenant_isolation policy on college_id (ADR-002).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE workflow_delegations (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id           TEXT NOT NULL REFERENCES colleges(college_id),
        role                 TEXT NOT NULL,
        department_id        UUID REFERENCES departments(id),
        delegate_user_id     UUID NOT NULL REFERENCES users(id),
        start_date           DATE NOT NULL,
        end_date             DATE,
        reason               TEXT,
        delegated_by_user_id UUID NOT NULL REFERENCES users(id),
        revoked_at           TIMESTAMPTZ,
        revoked_by_user_id   UUID REFERENCES users(id),
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('ALTER TABLE workflow_delegations ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE workflow_delegations FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON workflow_delegations
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON workflow_delegations TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS workflow_delegations');
};
