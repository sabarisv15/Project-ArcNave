'use strict';

// Module 6 (Documents & OCR), first vertical slice: `documents` table
// only — no service/API/UI yet. See .ai/TASK.md.
//
// Scope, per this session's own instructions: storage of STUDENT
// certificates/photos/files only. OCR/AI extraction (an
// `ai_confidence` column, an `ocr_results` table) is Module 9 (AI Tool
// Registry) territory, not added here. Staff documents and
// college-wide templates — also DocumentService-owned per
// Architecture.md 2.5 — are likewise out of scope this slice.
//
// documents is a tenant table like every other in this schema: ENABLE
// + FORCE ROW LEVEL SECURITY and a tenant_isolation policy on
// college_id, filtered by current_setting('app.current_tenant',
// true) — same pattern, same reasoning (ADR-002), not reinvented.
//
// Grounded against frontend/src/components/DocumentPanel.jsx — a
// per-student document grid whose requests all target dead prototype
// endpoints (POST /api/students/:id/documents/upload, POST
// /api/ai/ocr, POST /api/students/:id/documents/:docType/verify —
// none under /api/v1/, none matching a real route in this rebuild).
// Not a backend to repoint, only a shape to ground this ERD against,
// same role the old prototype played for every earlier module's first
// slice. See .ai/TASK.md for the full grounding note.
//
// Grounded, resolved decisions:
//
// - doc_type is free TEXT, no CHECK constraint. DocumentPanel.jsx's
//   DOC_TYPES names 8 known categories (aadhaar, community_cert,
//   bank_passbook, transfer_cert, birth_cert, income_cert,
//   scholarship_cert, disability_cert); this session's own scope
//   ("certificates/photos/files") adds a plain student photo as a 9th.
//   Same "don't normalize what nothing queries that way yet"
//   reasoning fee_structures.fee_category and faculty_allocation.subject
//   already established — known values documented here, not enforced
//   by the DB.
// - student_id is NOT NULL — one student per row, no polymorphic
//   owner column. Staff documents / templates are a different
//   DocumentService responsibility, out of scope this session.
// - No UNIQUE constraint on (student_id, doc_type). Architecture.md
//   2.5 names "versioning" as one of DocumentService's owned
//   responsibilities — re-uploading a document type is a new row (a
//   new version), not an overwrite. DocumentPanel.jsx's
//   single-record-per-type grid is a display convention (show the
//   latest), not a schema constraint.
// - status ('uploaded' | 'verified' | 'rejected', no CHECK
//   constraint, default 'uploaded'): same house convention as
//   classes.timetable_status / fee_structures.status — known values
//   enforced at the service layer once DocumentService exists (not
//   built this slice), not the DB. DocumentPanel.jsx's own
//   'not_uploaded'/'ai_extracted' states don't appear here:
//   'not_uploaded' just means no row exists yet, and 'ai_extracted' is
//   Module 9 territory, excluded this slice.
// - deleted_at (soft-delete), resolved now rather than left open like
//   students' first slice was: Architecture.md 2.5 explicitly names
//   "retention" as one of DocumentService's owned responsibilities,
//   and these rows are hard-to-replace artifacts (certificates, ID
//   scans) where an accidental hard delete is exactly what "retention"
//   exists to prevent. Not a rule named as explicitly as fees/
//   attendance/marks in BusinessRules.md's AI section, but the same
//   risk-averse default, flagged as a deliberate choice. The GRANT
//   below omits DELETE entirely, same as fee_structures.
// - storage_path (not file bytes) is what this table records —
//   Architecture.md 2.9 / CLAUDE.md rule 2: DocumentService is the
//   sole owner of file storage; this column only records where a file
//   lives (a tenant-prefixed path DocumentService will assign), not
//   the bytes themselves. No actual storage integration exists yet —
//   a later Module 6 slice's problem, not solved here.
// - Storing an 'aadhaar' doc_type value does not violate CLAUDE.md
//   rule 8: that rule restricts USING Aadhaar numbers "for identity,
//   dedup, import, search, AI reasoning, or reporting." This table
//   never reads or reasons over the Aadhaar number at all — it
//   records the existence and storage location of a scanned card
//   image, labeled like any other document category, exactly the
//   carve-out BusinessRules.md itself describes for a college that
//   needs it for a government process. Encryption-at-rest for the
//   actual file bytes is a storage-layer concern for a later slice —
//   flagged, not solved here. No Aadhaar NUMBER column exists anywhere
//   in this table.
// - uploaded_by_user_id NOT NULL, verified_by_user_id/verified_at
//   nullable, remarks nullable — mirrors the who/when/why shape
//   BusinessRules.md's approval chains already use elsewhere
//   (fee_structures.remarks plays the identical role), without
//   inventing new bookkeeping this slice doesn't need.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE documents (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id            TEXT NOT NULL REFERENCES colleges(college_id),
        student_id            UUID NOT NULL REFERENCES students(id),
        doc_type              TEXT NOT NULL,
        file_name             TEXT NOT NULL,
        storage_path          TEXT NOT NULL,
        mime_type             TEXT NOT NULL,
        file_size_bytes       BIGINT NOT NULL,
        status                TEXT NOT NULL DEFAULT 'uploaded',
        uploaded_by_user_id   UUID NOT NULL REFERENCES users(id),
        verified_by_user_id   UUID REFERENCES users(id),
        verified_at           TIMESTAMPTZ,
        remarks               TEXT,
        deleted_at            TIMESTAMPTZ,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE INDEX documents_student_type_idx
        ON documents (student_id, doc_type)
        WHERE deleted_at IS NULL
  `);

  pgm.sql('ALTER TABLE documents ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE documents FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON documents
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // No DELETE grant — soft-delete only (deleted_at), per the
  // file-level comment above (Architecture.md 2.5's "retention"
  // responsibility).
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON documents TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS documents');
};
