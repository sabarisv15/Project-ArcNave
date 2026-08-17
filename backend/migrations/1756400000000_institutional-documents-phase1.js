'use strict';

// Institutional Documents Phase 1 (see docs/architecture — Curriculum/
// Circulars move out of the AI-only sidebar into a real, browsable
// module). Extends the EXISTING `documents` table/DocumentService
// (CLAUDE.md rule 2: DocumentService is the sole owner of file
// storage) rather than standing up a second document system — every
// row created here is a normal `documents` row with student_id NULL,
// same as the institutional Curriculum/Circulars uploads already
// shipped.
//
// document_categories replaces the previous hardcoded
// INSTITUTIONAL_DOC_TYPES array (documentService.js) with real,
// per-college data — categories (Curriculum, Circulars, NAAC evidence,
// ...) will keep growing over the life of this system; that must be
// configuration a principal can manage, not a code change + migration
// every time. `slug` is the doc_type-compatible key (documentService
// sets documents.doc_type = category.slug at upload time), so the
// existing doc_type-keyed AI classification map
// (documentSearchService.DOC_TYPE_CLASSIFICATION) keeps working
// unchanged. Seeded with the same default categories the product
// proposal itself named, for every college that exists today; a new
// college created after this migration does NOT get these
// automatically (that's a college-provisioning-flow concern, flagged
// but not solved here) — a principal can add their own via
// document_categories CRUD regardless.
//
// documents gains: title (a human-entered label distinct from the raw
// uploaded file_name — file names alone are a poor index at real
// volume), academic_year_id (nullable: not every institutional
// document is year-scoped, e.g. a standing Policy), department_id
// (nullable: college-wide by default, same "nullable means global,
// not an error" reasoning class_id already uses), category_id.
// All four are nullable at the DB level — existing per-student rows
// never populate them, and even institutional rows may omit
// academic_year_id/department_id — validity (e.g. "title is required
// for an institutional upload") is a service-layer rule, matching
// this table's existing house convention of enforcing known-value
// rules in DocumentService, not via CHECK constraints.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE document_categories (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id    TEXT NOT NULL REFERENCES colleges(college_id),
        name          TEXT NOT NULL,
        slug          TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX document_categories_college_slug_key
        ON document_categories (college_id, slug)
  `);

  pgm.sql('ALTER TABLE document_categories ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE document_categories FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON document_categories
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // No DELETE grant — a category may already be referenced by
  // documents.category_id (plain FK, no ON DELETE clause = Postgres
  // default NO ACTION); removing categories entirely is not a Phase 1
  // requirement, and omitting DELETE here avoids ever needing to
  // decide "what happens to its documents" under time pressure later.
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON document_categories TO ${APP_ROLE}`);

  pgm.sql(`
    INSERT INTO document_categories (college_id, name, slug)
    SELECT c.college_id, v.name, v.slug
    FROM colleges c
    CROSS JOIN (VALUES
      ('Curriculum', 'curriculum'),
      ('Circulars', 'circular'),
      ('Academic Calendar', 'academic_calendar'),
      ('Examination', 'examination'),
      ('Policies', 'policies'),
      ('Forms', 'forms'),
      ('Notices', 'notices')
    ) AS v(name, slug)
    ON CONFLICT (college_id, slug) DO NOTHING
  `);

  pgm.sql('ALTER TABLE documents ADD COLUMN title TEXT');
  pgm.sql('ALTER TABLE documents ADD COLUMN academic_year_id UUID REFERENCES academic_years(id)');
  pgm.sql('ALTER TABLE documents ADD COLUMN department_id UUID REFERENCES departments(id)');
  pgm.sql('ALTER TABLE documents ADD COLUMN category_id UUID REFERENCES document_categories(id)');

  // Institutional browse/filter is always at least "documents with no
  // student, in this college" (already indexed via the table's own RLS
  // + the pre-existing documents_student_type_idx doesn't cover this
  // shape) — a partial index matching exactly the
  // findInstitutional() WHERE clause keeps faceted browsing indexed as
  // volume grows into the thousands this module is explicitly meant to
  // hold.
  pgm.sql(`
    CREATE INDEX documents_institutional_idx
        ON documents (college_id, academic_year_id, department_id, category_id)
        WHERE student_id IS NULL AND deleted_at IS NULL
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS documents_institutional_idx');
  pgm.sql('ALTER TABLE documents DROP COLUMN IF EXISTS category_id');
  pgm.sql('ALTER TABLE documents DROP COLUMN IF EXISTS department_id');
  pgm.sql('ALTER TABLE documents DROP COLUMN IF EXISTS academic_year_id');
  pgm.sql('ALTER TABLE documents DROP COLUMN IF EXISTS title');
  pgm.sql('DROP TABLE IF EXISTS document_categories');
};
