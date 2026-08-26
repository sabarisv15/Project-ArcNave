'use strict';

// Consumer-tool adaptation, file-generation slice (2026-08-26) — an
// artifact can now hold a sandbox-generated binary (e.g. a formula-
// bearing xlsx built and recalculated in the ADL-059 sandbox), verified
// before delivery by scripts/recalc.py.
//
// Deliberately a SEPARATE pair of columns from `published_document_id`/
// `published_at`, not a reuse of them:
//   - publish is TERMINAL (assertNotPublished rejects any further edit
//     once status = 'published'); a generated file should stay
//     re-runnable — asking again for the same report should not be
//     blocked by an earlier generation.
//   - a published document is ALWAYS the user's own markdown content
//     converted to another format (markdownFormatConverter.js); a
//     generated document is ALWAYS sandbox-produced bytes the artifact's
//     own text content never contained. Conflating the two columns would
//     make it impossible to tell which path produced a given document
//     without inspecting the file itself.
//
// `generation_verified` is nullable, not a plain boolean with a default:
// NULL means "no generation has happened yet", not "failed" — an
// artifact with no generated_document_id and generation_verified = NULL
// is just an ordinary text artifact, same as every existing row.
// artifactService.attachGeneratedFile (this session) refuses to set
// generated_document_id unless generation_verified would be TRUE — a
// FALSE value never reaches this table, only NULL or TRUE — but the
// column stays nullable rather than a CHECK-constrained boolean because
// that refusal is application logic (the verification report itself
// needs to reach the user, and it does not fit a boolean column), not a
// fact the schema should try to enforce a second time.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE artifacts ADD COLUMN generated_document_id UUID REFERENCES documents(id)');
  pgm.sql('ALTER TABLE artifacts ADD COLUMN generation_verified BOOLEAN');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE artifacts DROP COLUMN IF EXISTS generation_verified');
  pgm.sql('ALTER TABLE artifacts DROP COLUMN IF EXISTS generated_document_id');
};
