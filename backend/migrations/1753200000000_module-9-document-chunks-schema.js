'use strict';

// Module 9 (AI) — RAG slice: `ai_document_chunks`, pgvector-backed
// chunk+embedding storage behind documentSearchService.js's
// ingestDocument/searchDocuments (backing the new search_documents L1
// tool). AI-Governance.md §2/§3 still hold here exactly as they do for
// every other tool: this table is read only through
// documentSearchService (a Business Service, CLAUDE.md rule 1), never
// raw SQL from a route or the Tool Registry directly, and every row
// this table can ever return still passes through the Context Builder
// / Prompt Safety Layer boundary before reaching an LLM — retrieved
// chunk text is NEVER "sanitized then trusted" here; it's tagged
// untrusted at use time, identically to every other tool's output (see
// documentSearchService.js's own file comment).
//
// Requires the pgvector extension — docker-compose.yml's db image was
// switched from postgres:16 to pgvector/pgvector:pg16 (a drop-in image:
// same Postgres 16 build, the vector extension's shared library
// preinstalled) specifically for this migration; CREATE EXTENSION
// below is a no-op if it's already present.
//
// college_id + document_id FK -> documents(id): a chunk always belongs
// to exactly one uploaded document, same tenant-scoping convention
// every other table in this schema uses (ADR-002) — FORCE ROW LEVEL
// SECURITY + tenant_isolation policy, not reinvented.
//
// classification (TEXT, no CHECK, same no-CHECK convention doc_type/
// status/channel already use in this schema): set once at ingestion
// time by documentSearchService's own doc_type -> classification
// mapping, read back by searchDocuments to filter rows against
// aiClassificationAccess.permittedClassifications(actor.role) — a
// second, independent, per-ROW check distinct from the Policy Gate's
// own single tool-level classification check (AI-Governance.md §4:
// "action level and data classification are two independent checks" —
// this extends that same reasoning down to rows within one tool call,
// not just tools themselves).
//
// embedding vector(1024): nvidia/nv-embedqa-e5-v5's own fixed output
// dimension (see llmProvider.js's EMBEDDING_DIMENSIONS constant) — a
// column width, not a business rule, and it must always match whatever
// model config.nim.embeddingModel actually points at; switching to a
// model with a different dimension needs a new migration, not just a
// config change (pgvector's vector(N) is a fixed-width type).
//
// HNSW index (vector_cosine_ops): approximate-nearest-neighbor cosine
// search, matching the cosine-distance (`<=>`) operator
// aiDocumentChunkRepository.js's own search query uses — the natural
// index for a query pattern that is always "find the closest N chunks
// to this embedding," never an exact-match lookup.
//
// No DELETE/UPDATE grant: a chunk is written once at ingestion and
// never edited in place — same append-only convention notification_
// delivery/audit_log already use. A soft-deleted source document's
// chunks are never physically removed here; searchDocuments's own
// query JOINs documents and filters deleted_at IS NULL there, the same
// place every other soft-delete-aware read in this schema already
// enforces it — not a second deleted_at column duplicated onto this
// table.
//
// No Aadhaar content is ever ingested into this table at all —
// documentSearchService.ingestDocument refuses any document whose
// doc_type is documentService.AADHAAR_DOC_TYPE (CLAUDE.md rule 8:
// Aadhaar numbers are never used for identity, dedup, import, SEARCH,
// AI reasoning, or reporting — indexing an Aadhaar document's own text
// into this table, whose entire purpose is semantic SEARCH, would be
// exactly that use).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS vector');

  pgm.sql(`
    CREATE TABLE ai_document_chunks (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id      TEXT NOT NULL REFERENCES colleges(college_id),
        document_id     UUID NOT NULL REFERENCES documents(id),
        chunk_index     INTEGER NOT NULL,
        chunk_text      TEXT NOT NULL,
        classification  TEXT NOT NULL,
        embedding       vector(1024) NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('CREATE INDEX ai_document_chunks_document_id_idx ON ai_document_chunks (document_id)');
  pgm.sql(`
    CREATE INDEX ai_document_chunks_embedding_idx
        ON ai_document_chunks
        USING hnsw (embedding vector_cosine_ops)
  `);

  pgm.sql('ALTER TABLE ai_document_chunks ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE ai_document_chunks FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON ai_document_chunks
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // No DELETE/UPDATE grant — see the file-level comment.
  pgm.sql(`GRANT SELECT, INSERT ON ai_document_chunks TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS ai_document_chunks');
};
