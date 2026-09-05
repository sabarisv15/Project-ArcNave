'use strict';

// Create Student admission wizard, Phase 2: draft persistence ("Save
// Draft"/"Resume Draft" — admission clerks rarely finish in one sitting).
//
// student_admission_drafts mirrors the SAME flat profile columns
// students has (both the pre-existing base fields and the new admission
// fields from 1758200000000) rather than an opaque form_data jsonb blob —
// so a draft is validated the same way a real student is, not a second,
// untyped shape to keep in sync by hand. No aadhaar_number column here
// (or on students): CLAUDE.md rule 8 — studentService.createStudent
// already silently drops any aadhaar-shaped field, and that stays true
// for drafts too; the Aadhaar Card DOCUMENT is what gets stored (doc_type
// 'aadhaar', already supported), never a text field for the number.
//
// student_admission_draft_documents is intentionally its OWN table, not
// a nullable-student_id row in `documents`: documentService.js's own
// header comment calls documents.student_id "immutable once uploaded" —
// a draft document only becomes a real `documents` row (via the
// existing, unchanged documentService.uploadDocument) once the student
// is actually created and its real id is known, so that invariant is
// never touched. ocr_engine/ocr_engine_version/ai_model/ai_model_version/
// prompt_version give per-document traceability (which engine/model/
// prompt version produced this extraction), so a later engine/model/
// prompt change never makes an old draft's results uninterpretable.
//
// Both tables: tenant-scoped RLS (ADR-002) with their OWN college_id
// column each — this schema gives every tenant table its own college_id
// + RLS policy even when it's a child of another tenant table (e.g.
// position_department_assignments carries college_id alongside its
// position_id FK), not just a FK-inherited scope. Followed here, not
// invented.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE student_admission_drafts (
      id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      college_id                  TEXT NOT NULL REFERENCES colleges(college_id),
      created_by_user_id          UUID NOT NULL REFERENCES users(id),
      status                      TEXT NOT NULL DEFAULT 'in_progress',
      roll_no                     TEXT,
      full_name                   TEXT,
      gender                      TEXT,
      entry_type                  TEXT,
      emis_number                 TEXT,
      umis_number                 TEXT,
      email                       TEXT,
      phone                       TEXT,
      parent_name                 TEXT,
      parent_phone                TEXT,
      address                     TEXT,
      pincode                     TEXT,
      mark_10th                   TEXT,
      mark_12th                   TEXT,
      mark_iti                    TEXT,
      accommodation               TEXT,
      club                        TEXT,
      internship                  TEXT,
      career_plan                 TEXT,
      notes                       TEXT,
      license_number              TEXT,
      bike_number                 TEXT,
      annual_income               NUMERIC,
      class_id                    UUID REFERENCES classes(id) ON DELETE SET NULL,
      regulation_id               UUID REFERENCES regulations(id),
      current_semester            INTEGER,
      dob                         DATE,
      blood_group                 TEXT,
      nationality                 TEXT,
      section                     TEXT,
      batch                       TEXT,
      admission_year              INTEGER,
      register_number             TEXT,
      academic_year_id            UUID REFERENCES academic_years(id) ON DELETE SET NULL,
      school_name                 TEXT,
      school_type                 TEXT,
      education_board             TEXT,
      previous_qualification      TEXT,
      passing_year                TEXT,
      community                   TEXT,
      community_cert_number       TEXT,
      bank_account_holder_name    TEXT,
      bank_name                   TEXT,
      bank_branch                 TEXT,
      bank_account_number         TEXT,
      bank_ifsc_code              TEXT,
      bank_account_type           TEXT,
      extra                       JSONB,
      created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  pgm.sql('ALTER TABLE student_admission_drafts ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE student_admission_drafts FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON student_admission_drafts
      USING (college_id = current_setting('app.current_tenant', true))
      WITH CHECK (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON student_admission_drafts TO ${APP_ROLE}`);

  pgm.sql(`
    CREATE TABLE student_admission_draft_documents (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      college_id            TEXT NOT NULL REFERENCES colleges(college_id),
      draft_id              UUID NOT NULL REFERENCES student_admission_drafts(id) ON DELETE CASCADE,
      doc_type              TEXT NOT NULL,
      storage_path          TEXT,
      file_name             TEXT,
      mime_type             TEXT,
      uploaded_at           TIMESTAMPTZ,
      extraction_status     TEXT NOT NULL DEFAULT 'missing',
      detected_doc_type     TEXT,
      detection_confidence  INTEGER,
      extraction_job_id     UUID REFERENCES background_jobs(id) ON DELETE SET NULL,
      ocr_engine            TEXT,
      ocr_engine_version    TEXT,
      ai_model              TEXT,
      ai_model_version      TEXT,
      prompt_version        TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(
    'CREATE INDEX student_admission_draft_documents_draft_id_idx ON student_admission_draft_documents (draft_id)',
  );
  pgm.sql('ALTER TABLE student_admission_draft_documents ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE student_admission_draft_documents FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON student_admission_draft_documents
      USING (college_id = current_setting('app.current_tenant', true))
      WITH CHECK (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON student_admission_draft_documents TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS student_admission_draft_documents');
  pgm.sql('DROP TABLE IF EXISTS student_admission_drafts');
};
