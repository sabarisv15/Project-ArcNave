'use strict';

// Staff Experience build Step 6 (docs/bka/60-product-reasoning/
// staff-experience-2026-08-08.md Approved Spec §12) — Project Detail's
// two new persisted concepts. `instructions` is a plain nullable text
// column on the existing `projects` table (same self-owned-resource
// shape as everything else on that row). `project_documents` is a
// reference-only link table (CLAUDE.md rule 2 / ADR-009 Amendment 1:
// DocumentService remains the sole owner of the underlying file — this
// table never stores a document, only that a project points at one).
// UNIQUE(project_id, document_id) makes "attach" idempotent-safe — a
// second attach of the same document is a clean, catchable conflict,
// not a silent duplicate row.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE projects ADD COLUMN instructions TEXT');

  pgm.sql(`
    CREATE TABLE project_documents (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id       TEXT NOT NULL REFERENCES colleges(college_id),
        project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        document_id      UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        added_by_user_id UUID NOT NULL REFERENCES users(id),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (project_id, document_id)
    )
  `);
  pgm.sql('CREATE INDEX project_documents_project_id_idx ON project_documents (project_id)');
  pgm.sql('ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE project_documents FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON project_documents
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, DELETE ON project_documents TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS project_documents');
  pgm.sql('ALTER TABLE projects DROP COLUMN IF EXISTS instructions');
};
