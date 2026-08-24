'use strict';

// Provider-independent tool retrieval (round 32) — `ai_tool_embeddings`
// backs aiToolRetrievalService.js's semantic shortlisting of
// aiToolRegistry.js's ~69 registered tools, replacing "send every
// role-permitted tool's full JSON schema on every turn" with "embed
// the question, find the closest tools, send only those."
//
// No college_id, no RLS: unlike ai_document_chunks (real tenant data),
// a tool's name/description is static registry metadata identical for
// every college — unlike document content, there is nothing here to
// tenant-isolate. One row per registered tool, platform-wide.
//
// embedding vector(1024): config.embeddingProvider's own default
// ('nim') embeds via nvidia/nv-embedqa-e5-v5, the same fixed 1024-dim
// output ai_document_chunks already sized its own column against (see
// that migration's comment) — a column width, not a business rule.
// Changing EMBEDDING_PROVIDER (or that provider's embeddingModel) to a
// model with a different output dimension needs a new migration, same
// constraint as that earlier table.
//
// updated_at + an UPDATE grant (unlike ai_document_chunks' append-only
// grant): a tool's description can change when its code does, and this
// table must be re-embeddable in place, not only ever inserted once.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS vector');

  pgm.sql(`
    CREATE TABLE ai_tool_embeddings (
        tool_name   TEXT PRIMARY KEY,
        embedding   vector(1024) NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE INDEX ai_tool_embeddings_embedding_idx
        ON ai_tool_embeddings
        USING hnsw (embedding vector_cosine_ops)
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON ai_tool_embeddings TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS ai_tool_embeddings');
};
