'use strict';

// Module 2 (Staff), first vertical slice: `staff` table only — no
// service/API/UI yet. See .ai/TASK.md.
//
// staff is a tenant table like students/users/refresh_tokens/
// audit_log/configurations: ENABLE + FORCE ROW LEVEL SECURITY and a
// tenant_isolation policy on college_id, filtered by
// current_setting('app.current_tenant', true) — same pattern, same
// reasoning (ADR-002), not reinvented here.
//
// Unlike students, staff has a real `user_id` FK to `users`: staff
// are login accounts (role IN staff|hod|principal|college_admin),
// students are not. `staff` deliberately does not duplicate anything
// `users` already owns (username/email/password_hash/role/is_active/
// activated_by) — it only holds profile fields users has no place
// for. This slice models the profile of an already-provisioned staff
// member (a users row must already exist); the multi-step
// registration/approval chain described in BusinessRules.md (Faculty
// submits -> HOD approves -> Principal approves -> credentials
// emailed) is explicitly out of scope here — that belongs to
// WorkflowService (Module 8), not guessed at in this slice. See
// .ai/TASK.md's "Key design decision" section for the full reasoning.
//
// staff_code (not staff_id): the prototype UI's own field is named
// `staff_id` ("Staff ID (Biometric)"), but that name is deliberately
// not reused here — it would collide with the FK-naming convention
// (`staff_id UUID REFERENCES staff(id)`) other tables will use once
// they need to reference this table. See .ai/TASK.md.
//
// No Aadhaar column anywhere (CLAUDE.md rule 8). No Class Tutor
// column: per BusinessRules' "Resolved (Module 2 kickoff)" entry,
// tutor is an assignment on a class/section record referencing a
// faculty user_id, not a staff column — that table belongs to
// Academic (Module 3).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE staff (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id      TEXT NOT NULL REFERENCES colleges(college_id),
        user_id         UUID NOT NULL REFERENCES users(id),
        staff_code      TEXT,
        full_name       TEXT NOT NULL,
        gender          TEXT,
        dob             DATE,
        phone           TEXT,
        department      TEXT,
        designation     TEXT,
        qualification   TEXT,
        has_phd         BOOLEAN NOT NULL DEFAULT false,
        aicte_id        TEXT,
        joined_year     INT,
        address         TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id),
        UNIQUE (college_id, staff_code)
    )
  `);

  pgm.sql('ALTER TABLE staff ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE staff FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON staff
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // No soft-delete field defined yet (open question, same treatment
  // as students/configurations got in their migrations); DELETE here
  // is a placeholder grant for now, not a settled decision.
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON staff TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS staff');
};
