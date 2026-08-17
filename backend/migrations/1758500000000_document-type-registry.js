'use strict';

// Create Student admission wizard, Phase 2: a registry table instead of a
// hardcoded per-docType mapping — documentExtractionService looks field
// targets up here, and the wizard's 8 upload cards are fetched from
// GET /document-types?module=student_admission instead of a hardcoded
// frontend array. `module` scopes rows so a future feature (Staff,
// Alumni, Certificates) adds rows here, not a second hardcoded map
// elsewhere.
//
// key reuses the EXISTING doc_type vocabulary already established for
// `documents.doc_type` (a free-text convention, no CHECK constraint —
// 1752500000000's own comment lists aadhaar/community_cert/bank_passbook/
// transfer_cert among the known values) for aadhaar/transfer_cert/
// community_cert/bank_passbook, so the eventual real `documents` row this
// wizard creates (via the existing, unchanged documentService.
// uploadDocument) lands under the same doc_type an admin reviewing
// Documents already expects. student_photo/marksheet_10th/
// marksheet_12th_iti/fee_receipt are new values this wizard introduces.
//
// ocr_enabled: false for student_photo (not a text document — nothing to
// extract) and aadhaar (CLAUDE.md rule 8 — never OCR'd/sent to AI,
// upload-only) and fee_receipt (Finance module owns fee data, not
// duplicated here — stored for the record, no field extraction).
//
// extraction_field_targets is a plain array of camelCase student-profile
// field names — the exact same names studentService.ADMISSION_PROFILE_
// FIELDS/ALLOWED_FIELDS use, so a match requires no translation layer.
//
// Global/platform-scoped, not per-college: whether "10th Marksheet" is a
// thing this wizard asks for isn't an institution-level customization
// today (college-level override is a real, deliberately deferred future
// gap, not built here) — no college_id column, no RLS; every tenant sees
// the same registry, same reasoning documentSearchService's own static
// DOC_TYPE_CLASSIFICATION map already applies platform-wide.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE document_type_registry (
      id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key                       TEXT NOT NULL UNIQUE,
      label                     TEXT NOT NULL,
      module                    TEXT NOT NULL,
      required                  BOOLEAN NOT NULL DEFAULT false,
      ocr_enabled               BOOLEAN NOT NULL DEFAULT false,
      extraction_field_targets  JSONB NOT NULL DEFAULT '[]'::jsonb,
      sort_order                INTEGER NOT NULL DEFAULT 0,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`GRANT SELECT ON document_type_registry TO ${APP_ROLE}`);

  pgm.sql(`
    INSERT INTO document_type_registry (key, label, module, required, ocr_enabled, extraction_field_targets, sort_order) VALUES
      ('student_photo', 'Student Photo', 'student_admission', true, false, '[]'::jsonb, 1),
      ('aadhaar', 'Aadhaar Card', 'student_admission', true, false, '[]'::jsonb, 2),
      ('marksheet_10th', '10th Marksheet', 'student_admission', true, true,
        '["mark10th", "schoolName", "schoolType", "educationBoard", "passingYear"]'::jsonb, 3),
      ('marksheet_12th_iti', '12th / ITI Marksheet', 'student_admission', true, true,
        '["mark12th", "markIti", "previousQualification", "passingYear", "educationBoard"]'::jsonb, 4),
      ('transfer_cert', 'Transfer Certificate', 'student_admission', true, true,
        '["fullName", "dob", "gender"]'::jsonb, 5),
      ('community_cert', 'Community Certificate', 'student_admission', true, true,
        '["community", "communityCertNumber"]'::jsonb, 6),
      ('bank_passbook', 'Bank Passbook', 'student_admission', true, true,
        '["bankAccountHolderName", "bankName", "bankBranch", "bankAccountNumber", "bankIfscCode"]'::jsonb, 7),
      ('fee_receipt', 'Fee Receipt', 'student_admission', true, false, '[]'::jsonb, 8)
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS document_type_registry');
};
