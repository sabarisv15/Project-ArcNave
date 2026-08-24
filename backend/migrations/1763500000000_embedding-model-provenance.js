'use strict';

// ADR-030 / ADL-049 P0 — embedding provenance. Neither ai_document_chunks
// (1753200000000) nor ai_tool_embeddings (1763400000000) recorded which
// embedding model produced a row — both vector(1024), hard-coded to
// whatever model happened to be configured at the time (currently
// nvidia/nv-embedqa-e5-v5, NIM's default per config.js, both prior
// migrations' own comments). Changing EMBEDDING_PROVIDER/
// NIM_EMBEDDING_MODEL left existing rows silently in the old vector
// space with nothing to detect it:
//   - aiToolRetrievalService.ensureEmbeddings's self-healing backfill
//     checked tool_name existence only, so a model change would never
//     re-embed an already-known tool.
//   - documentSearchService.searchDocuments would rank an old-model
//     chunk's cosine distance against a new-model query embedding —
//     two incompatible vector spaces blended into one ranking, with no
//     error at all.
//
// Existing rows are backfilled to the one model that has ever produced
// them so far (both prior migrations' own comments already document
// this as the fixed default), then the column default is dropped so
// every future INSERT/upsert must state its model explicitly
// (embeddingService.currentModel()) rather than silently inheriting a
// stale default. aiToolEmbeddingRepository.findExistingToolNames and
// aiDocumentChunkRepository.search are the two read paths updated
// (application code, not this migration) to actually filter on this
// column — see those files' own comments for the self-healing/
// mixed-vector-space fix this column exists to enable.

const BACKFILL_MODEL = 'nvidia/nv-embedqa-e5-v5';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE ai_document_chunks ADD COLUMN model TEXT NOT NULL DEFAULT '${BACKFILL_MODEL}'`);
  pgm.sql('ALTER TABLE ai_document_chunks ALTER COLUMN model DROP DEFAULT');

  pgm.sql(`ALTER TABLE ai_tool_embeddings ADD COLUMN model TEXT NOT NULL DEFAULT '${BACKFILL_MODEL}'`);
  pgm.sql('ALTER TABLE ai_tool_embeddings ALTER COLUMN model DROP DEFAULT');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE ai_tool_embeddings DROP COLUMN model');
  pgm.sql('ALTER TABLE ai_document_chunks DROP COLUMN model');
};
