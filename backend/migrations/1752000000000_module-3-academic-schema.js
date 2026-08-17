'use strict';

// Module 3 (Academic), first vertical slice: `classes` table only —
// no service/API/UI yet. See .ai/TASK.md.
//
// classes is a tenant table like students/staff/users/refresh_tokens/
// audit_log/configurations: ENABLE + FORCE ROW LEVEL SECURITY and a
// tenant_isolation policy on college_id, filtered by
// current_setting('app.current_tenant', true) — same pattern, same
// reasoning (ADR-002), not reinvented here.
//
// This is the class/section table the Module 2 staff migration
// explicitly deferred: "No Class Tutor column: per BusinessRules'
// 'Resolved (Module 2 kickoff)' entry, tutor is an assignment on a
// class/section record referencing a faculty user_id, not a staff
// column — that table belongs to Academic (Module 3)." tutor_user_id
// here references users(id), not staff(id) — followed verbatim from
// that resolution, not re-litigated.
//
// No subjects/faculty_allocation/timetable_periods tables yet: the
// real, working frontend (TutorClass.jsx/TutorClassMonitor.jsx) never
// queries a normalized subjects/periods table — timetable content is
// an opaque CSV-derived grid (headers/rows) attached to a class.
// Normalizing that out is deferred to a later Module 3 slice, not
// guessed at here. See .ai/TASK.md.
//
// No timetable_path (uploaded file reference) column: DocumentService
// is the sole owner of file storage (CLAUDE.md rule 2) and doesn't
// exist yet (Module 6). Only the already-parsed timetable_data JSONB
// is in scope this slice; the raw uploaded file is a flagged open gap,
// not silently dropped. See .ai/TASK.md.
//
// timetable_status has no CHECK constraint, matching house convention
// (users.role / colleges.subscription_status also have none) — known
// real values, enforced at the service layer once AcademicService
// exists, not the DB: 'No Tutor' | 'Pending HOD' | 'Pending Principal'
// | 'Approved' | 'Rejected'. 'Approved' is the literal gate value
// CLAUDE.md rule 7 references for unlocking Attendance.
//
// No Aadhaar column anywhere (CLAUDE.md rule 8).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE classes (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id          TEXT NOT NULL REFERENCES colleges(college_id),
        class_name          TEXT NOT NULL,
        department          TEXT,
        semester            TEXT,
        tutor_user_id       UUID REFERENCES users(id),
        timetable_status    TEXT NOT NULL DEFAULT 'No Tutor',
        timetable_data      JSONB,
        timetable_remarks   TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (college_id, class_name),
        UNIQUE (tutor_user_id)
    )
  `);

  pgm.sql('ALTER TABLE classes ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE classes FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON classes
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // No soft-delete field defined yet (open question, same treatment
  // as students/staff/configurations got in their migrations); DELETE
  // here is a placeholder grant for now, not a settled decision.
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON classes TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS classes');
};
