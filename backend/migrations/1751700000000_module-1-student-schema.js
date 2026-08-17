'use strict';

// Module 1 (Student), first vertical slice: `students` table only —
// no service/API/UI yet. See .ai/TASK.md.
//
// students is a tenant table like users/refresh_tokens/audit_log/
// configurations in the Module 0 migration: ENABLE + FORCE ROW LEVEL
// SECURITY and a tenant_isolation policy on college_id, filtered by
// current_setting('app.current_tenant', true) — same pattern, same
// reasoning (ADR-002), not reinvented here.
//
// UNIQUE (college_id, roll_no): BusinessRules describes a per-tenant
// unique "register number" for students, but `register_no`/
// `admission_no` aren't in the documented field list this table was
// built from — roll_no is used as the closest identity field instead.
// Flagging this as an assumption to confirm, not a silent rename.
//
// No Aadhaar column anywhere (CLAUDE.md rule 8).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE students (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id              TEXT NOT NULL REFERENCES colleges(college_id),
        roll_no                 TEXT NOT NULL,
        full_name               TEXT NOT NULL,
        gender                  TEXT,
        entry_type              TEXT,
        emis_number             TEXT,
        umis_number             TEXT,
        email                   TEXT,
        phone                   TEXT,
        phone_verified          BOOLEAN NOT NULL DEFAULT false,
        parent_name             TEXT,
        parent_phone            TEXT,
        parent_phone_verified   BOOLEAN NOT NULL DEFAULT false,
        address                 TEXT,
        pincode                 TEXT,
        mark_10th               NUMERIC,
        mark_12th               NUMERIC,
        mark_iti                NUMERIC,
        accommodation           TEXT,
        club                    TEXT,
        internship              TEXT,
        career_plan             TEXT,
        notes                   TEXT,
        license_number          TEXT,
        bike_number             TEXT,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (college_id, roll_no)
    )
  `);

  pgm.sql('ALTER TABLE students ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE students FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON students
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // No soft-delete field defined yet (open question — see .ai/TASK.md
  // and StudentRepository's `remove`); DELETE here is a placeholder
  // grant for now, not a settled decision, same treatment as
  // configurations got in the Module 0 migration.
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON students TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS students');
};
