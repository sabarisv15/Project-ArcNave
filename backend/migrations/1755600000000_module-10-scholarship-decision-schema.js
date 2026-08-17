'use strict';

// BusinessRules.md Finance — Scholarship eligibility (superseded):
// "ARCNAVE does not enforce hardcoded eligibility criteria... the
// Class Tutor reviews students and marks each one Eligible or Not
// Eligible per the institution's own policy, with every decision
// audited. AI never decides or sets eligibility — it may only surface
// advisory signals... The previously built
// financeService.checkScholarshipEligibility (a hardcoded income-
// threshold check) is retained only as one such advisory input, not
// as the eligibility outcome itself."
//
// This table is the actual Tutor decision — checkScholarshipEligibility
// itself is UNCHANGED by this migration (still a pure read, still
// income-threshold-only, still never called an "outcome" anywhere in
// this codebase's own comments); this is the missing other half: a
// place to record what the Tutor actually decided, which the old
// function had no way to do.
//
// scheme_name: free text, not a foreign key to a "schemes" table —
// BusinessRules.md says schemes are institution-defined but no
// schemes table exists anywhere in this schema yet (same "don't invent
// structure nobody asked for" restraint every other slice in this
// codebase follows); a real schemes table is a future, separate
// concern if an institution ever needs to manage scheme metadata
// itself, not guessed at here.
//
// No UNIQUE (student_id, scheme_name): BusinessRules.md doesn't say a
// decision can't be revisited for the same scheme in a later academic
// year — every decision is retained as its own permanent row (all of
// them, not just the latest), matching this session's own "audit
// trail over mutable state" convention (timetable_revisions/
// attendance_corrections/student_lifecycle_events all keep full
// history rather than overwriting a single current value).
//
// Tenant table like every other in this schema: ENABLE + FORCE ROW
// LEVEL SECURITY, tenant_isolation policy on college_id (ADR-002). No
// update/delete — a recorded decision is a permanent fact, same
// pattern every other lifecycle-ledger table in this schema uses.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE scholarship_decisions (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id            TEXT NOT NULL REFERENCES colleges(college_id),
        student_id            UUID NOT NULL REFERENCES students(id),
        scheme_name           TEXT NOT NULL,
        eligible              BOOLEAN NOT NULL,
        reason                TEXT,
        supporting_document_id UUID REFERENCES documents(id),
        decided_by_user_id    UUID NOT NULL REFERENCES users(id),
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('ALTER TABLE scholarship_decisions ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE scholarship_decisions FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON scholarship_decisions
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT ON scholarship_decisions TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS scholarship_decisions');
};
