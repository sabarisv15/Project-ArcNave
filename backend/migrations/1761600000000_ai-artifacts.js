'use strict';

// ADL-032 — AI Artifacts: structured, editable AI-generated content
// (markdown, versioned), owned by ArtifactService as ordinary DB
// rows, not by DocumentService. Only ArtifactService.publishArtifact
// ever calls DocumentService (uploadPersonalDocument) to turn an
// artifact into a real binary document — see ADR-009 Amendment 1
// (docs/bka/30-decisions/adr-register.md) for the governance record
// of this boundary.
//
// Soft delete via deleted_at, not a hard DELETE — follows
// documentRepository.js's own lifecycle-timestamp pattern
// (archived_at/superseded_at) rather than personal_notes'/
// staff_work_history's hard-delete pattern: a draft artifact is,
// structurally, a not-yet-published document, and documents already
// chose soft lifecycle over hard delete for the same recoverable-
// content reasoning. artifact_versions rows are untouched by a soft
// delete on the parent artifact.
//
// artifact_versions is immutable, append-only — same
// timetable_revisions reasoning as messages (see the
// ai-conversations-and-projects migration). change_summary is
// nullable and unpopulated in v1 (no UI writes it yet) — present now
// so a future "describe what changed" feature doesn't need its own
// migration.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE artifacts (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id              TEXT NOT NULL REFERENCES colleges(college_id),
        user_id                 UUID NOT NULL REFERENCES users(id),
        conversation_id         UUID REFERENCES conversations(id) ON DELETE SET NULL,
        source_message_id       UUID REFERENCES messages(id) ON DELETE SET NULL,
        title                   TEXT NOT NULL,
        content                 TEXT NOT NULL,
        status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
        version_number          INTEGER NOT NULL DEFAULT 1,
        published_document_id   UUID REFERENCES documents(id),
        published_at            TIMESTAMPTZ,
        deleted_at              TIMESTAMPTZ,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  pgm.sql('CREATE INDEX artifacts_user_id_idx ON artifacts (user_id)');
  pgm.sql('ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE artifacts FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON artifacts
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON artifacts TO ${APP_ROLE}`);

  pgm.sql(`
    CREATE TABLE artifact_versions (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id          TEXT NOT NULL REFERENCES colleges(college_id),
        artifact_id         UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
        version_number      INTEGER NOT NULL,
        content             TEXT NOT NULL,
        change_summary      TEXT,
        created_by_user_id  UUID NOT NULL REFERENCES users(id),
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (artifact_id, version_number)
    )
  `);
  pgm.sql('CREATE INDEX artifact_versions_artifact_id_idx ON artifact_versions (artifact_id, version_number)');
  pgm.sql('ALTER TABLE artifact_versions ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE artifact_versions FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON artifact_versions
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT ON artifact_versions TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS artifact_versions');
  pgm.sql('DROP TABLE IF EXISTS artifacts');
};
