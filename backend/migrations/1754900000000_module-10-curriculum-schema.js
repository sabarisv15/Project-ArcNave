'use strict';

// BusinessRules.md Academic/Timetable — Curriculum / regulation
// versioning: "multiple curriculum ('regulation') versions may
// coexist... each regulation owns its own subject list, credits,
// contact hours, and examination scheme; historical regulation
// versions never change." Two tenant tables, same RLS pattern as
// every other table in this schema (ADR-002), each with its own
// college_id rather than relying on a join for tenant scoping — same
// direct-column precedent fee_payments sets alongside its student_id/
// fee_structure_id FKs.
//
// regulations: no lifecycle/status column. Nothing in BusinessRules.md
// gives a regulation a Draft/Active/Archived state machine the way
// Academic Year has one — a regulation simply exists once created, and
// "historical regulation versions never change" is enforced by never
// exposing an update path in the service layer, not by a status
// column here.
//
// subjects: college_id is denormalized from regulations.college_id
// (not derived via a join at query time) for the same reason
// fee_payments denormalizes college_id despite having real FKs —
// direct RLS filtering without a join. UNIQUE (regulation_id,
// subject_code): a regulation cannot define the same subject code
// twice, mirroring fee_structures' own per-scope uniqueness reasoning.
//
// students.regulation_id: nullable (existing students predate this
// column), no CHECK/trigger enforcing immutability at the DB layer —
// "fixed after admission except through Curriculum Migration workflow"
// is enforced by CurriculumService being the only writer of this
// column and studentService's own ALLOWED_FIELDS never including it,
// same "known literal enforced at the service layer, not the DB" house
// convention every other status-like column in this schema follows.
//
// No Aadhaar column anywhere (CLAUDE.md rule 8) — not applicable here.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE regulations (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id    TEXT NOT NULL REFERENCES colleges(college_id),
        name          TEXT NOT NULL,
        description   TEXT,
        created_by_user_id UUID REFERENCES users(id),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX regulations_college_name_key
        ON regulations (college_id, name)
  `);

  pgm.sql('ALTER TABLE regulations ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE regulations FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON regulations
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON regulations TO ${APP_ROLE}`);

  pgm.sql(`
    CREATE TABLE subjects (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id        TEXT NOT NULL REFERENCES colleges(college_id),
        regulation_id     UUID NOT NULL REFERENCES regulations(id),
        subject_code      TEXT NOT NULL,
        subject_name      TEXT NOT NULL,
        semester          INTEGER NOT NULL,
        credits           NUMERIC,
        lecture_hours     INTEGER,
        tutorial_hours    INTEGER,
        practical_hours   INTEGER,
        subject_type      TEXT,
        prerequisites     TEXT,
        source_document_id UUID,
        deleted_at        TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX subjects_regulation_subject_code_key
        ON subjects (regulation_id, subject_code)
        WHERE deleted_at IS NULL
  `);

  pgm.sql('ALTER TABLE subjects ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE subjects FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON subjects
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON subjects TO ${APP_ROLE}`);

  pgm.sql('ALTER TABLE students ADD COLUMN regulation_id UUID REFERENCES regulations(id)');

  // Carries the target regulation while a Curriculum Migration
  // workflow_requests row is Pending — same "the entity's own row
  // carries the pending change, workflow_requests only tracks status"
  // pattern classes.timetable_status/fee_structures.status already
  // establish (entity_id in workflow_requests points at the student
  // row itself; this column is that row's own pending-change field).
  // Cleared back to NULL once the migration resolves either way.
  pgm.sql('ALTER TABLE students ADD COLUMN pending_regulation_id UUID REFERENCES regulations(id)');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS pending_regulation_id');
  pgm.sql('ALTER TABLE students DROP COLUMN IF EXISTS regulation_id');
  pgm.sql('DROP TABLE IF EXISTS subjects');
  pgm.sql('DROP TABLE IF EXISTS regulations');
};
