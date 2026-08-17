'use strict';

// Institutional Documents Phase 3 — version history, cross-year
// lineage, duplicate detection, and a Draft -> Published -> Superseded
// -> Archived publish lifecycle gated by WorkflowService (CLAUDE.md
// rule 3). Extends the EXISTING `documents` table (CLAUDE.md rule 2:
// DocumentService is the sole owner of file storage) — no second
// document table, same discipline Phase 1's own migration comment
// already established.
//
// Columns added to `documents`:
//
// - publication_status TEXT NOT NULL DEFAULT 'Draft' (Draft/Published/
//   Superseded/Archived): a SEPARATE lifecycle from the existing
//   `status` column ('uploaded'/'verified'/'rejected' — the per-
//   student review workflow from Module 6). Reusing `status` here
//   would silently conflate two unrelated state machines; a document
//   can be 'uploaded' AND 'Published' at once, they are orthogonal.
//   Known values enforced at the service layer (documentService.js),
//   not a DB CHECK — same house convention `status`/`fee_structures.status`
//   already use.
// - document_group_id UUID NOT NULL DEFAULT gen_random_uuid(): groups
//   every version of the same logical document together. NOT a
//   self-referencing FK to documents.id — it is a bare grouping key
//   that does not have to equal any one row's own id, so the very
//   first version of a document can get one at INSERT time via the
//   column default, same instant its own id is generated, with no
//   "insert then update to point at yourself" two-step dance.
// - version_number INTEGER NOT NULL DEFAULT 1: 1-indexed, increments
//   per new version uploaded into the same document_group_id.
// - lineage_parent_id UUID REFERENCES documents(id): cross-year
//   lineage — "this document is the successor of that one in a
//   different academic year." Deliberately separate from
//   document_group_id: version history is same-document revisions
//   (typically same year), lineage is "the equivalent document in a
//   DIFFERENT year," a distinct relationship the product brief itself
//   names as its own feature (#2), not just "more versions."
// - content_hash TEXT: sha256 of the uploaded bytes, computed by
//   DocumentService at upload time (fileStorage never computes
//   business-meaningful hashes itself — that's upload-time business
//   logic, DocumentService's job). Used for exact-duplicate detection
//   on upload; nullable because existing rows predate this column and
//   backfilling every historical file's hash is out of scope here.
// - superseded_at / archived_at TIMESTAMPTZ: when this row itself was
//   moved to Superseded/Archived — mirrors verified_at's existing
//   who/when shape, without repurposing verified_at (that column is
//   the OTHER, review workflow's timestamp).
//
// Indexes:
// - documents_group_idx: version-history lookups ("every version of
//   this logical document") are the whole point of document_group_id;
//   this is the natural index for it.
// - documents_content_hash_idx: duplicate-detection's own lookup —
//   scoped to institutional rows only (student_id IS NULL), same shape
//   documents_institutional_idx already uses, since duplicate
//   detection is an Institutional Documents Phase 3 feature, not a
//   per-student one.
// - documents_lineage_parent_idx: "what supersedes this document in a
//   later year" (the reverse-lookup direction lineage navigation
//   needs) — a plain FK gets no automatic index on the referencing
//   column in Postgres.
//
// Backfill: every row that pre-dates this migration keeps its brand
// new default publication_status of 'Draft', EXCEPT existing
// institutional documents (student_id IS NULL, category_id IS NOT
// NULL — i.e. real Phase 1/2 uploads already live and already visible
// to every role today). Those are backfilled straight to 'Published'
// so this migration does not silently hide documents that were
// already generally visible before Phase 3's student-visibility gate
// (task #5) existed — a real behavior-preserving backfill, not a
// guess.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql("ALTER TABLE documents ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'Draft'");
  pgm.sql('ALTER TABLE documents ADD COLUMN document_group_id UUID NOT NULL DEFAULT gen_random_uuid()');
  pgm.sql('ALTER TABLE documents ADD COLUMN version_number INTEGER NOT NULL DEFAULT 1');
  pgm.sql('ALTER TABLE documents ADD COLUMN lineage_parent_id UUID REFERENCES documents(id)');
  pgm.sql('ALTER TABLE documents ADD COLUMN content_hash TEXT');
  pgm.sql('ALTER TABLE documents ADD COLUMN superseded_at TIMESTAMPTZ');
  pgm.sql('ALTER TABLE documents ADD COLUMN archived_at TIMESTAMPTZ');

  pgm.sql(`
    UPDATE documents
       SET publication_status = 'Published'
     WHERE student_id IS NULL AND category_id IS NOT NULL AND deleted_at IS NULL
  `);

  pgm.sql(`
    CREATE INDEX documents_group_idx
        ON documents (document_group_id)
        WHERE deleted_at IS NULL
  `);

  pgm.sql(`
    CREATE INDEX documents_content_hash_idx
        ON documents (college_id, content_hash)
        WHERE student_id IS NULL AND deleted_at IS NULL AND content_hash IS NOT NULL
  `);

  pgm.sql(`
    CREATE INDEX documents_lineage_parent_idx
        ON documents (lineage_parent_id)
        WHERE lineage_parent_id IS NOT NULL
  `);

  // Already covered by the blanket documents GRANT (Module 6's own
  // migration) — no new GRANT needed, new columns on an existing table
  // inherit the table-level privilege.
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON documents TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS documents_lineage_parent_idx');
  pgm.sql('DROP INDEX IF EXISTS documents_content_hash_idx');
  pgm.sql('DROP INDEX IF EXISTS documents_group_idx');
  pgm.sql('ALTER TABLE documents DROP COLUMN IF EXISTS archived_at');
  pgm.sql('ALTER TABLE documents DROP COLUMN IF EXISTS superseded_at');
  pgm.sql('ALTER TABLE documents DROP COLUMN IF EXISTS content_hash');
  pgm.sql('ALTER TABLE documents DROP COLUMN IF EXISTS lineage_parent_id');
  pgm.sql('ALTER TABLE documents DROP COLUMN IF EXISTS version_number');
  pgm.sql('ALTER TABLE documents DROP COLUMN IF EXISTS document_group_id');
  pgm.sql('ALTER TABLE documents DROP COLUMN IF EXISTS publication_status');
};
