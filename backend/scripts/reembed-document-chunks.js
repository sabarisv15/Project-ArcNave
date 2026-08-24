'use strict';

// NIM-provider removal — config.embeddingProvider now defaults to
// 'gemini' (was 'nim'). Tool embeddings self-heal automatically
// (aiToolRetrievalService.ensureEmbeddings re-embeds on the next real
// request, scoped by model — see that file's own comment). Document
// chunks do NOT self-heal: ai_document_chunks rows are created once, at
// upload time, and never re-derived on search. Once
// aiDocumentChunkRepository.search's model-scoped filter (`c.model =
// $6`, that file's own comment on the embedding-provenance fix) excludes
// old-model rows, every already-ingested document's chunks go silently
// invisible to search — not wrong-but-mixed, just gone — until
// re-embedded under the new model. This script does that.
//
// Idempotent: for each (document_id, chunk_index), skips if a row
// already exists under the current model, so this is safe to stop
// halfway, retry after a transient API failure, or re-run after
// deployment with zero double-embedding cost.
//
// One-off — run manually as part of the NIM-removal rollout, never
// wired into any request path.
//
// Run (from backend/):
//   source .env.local.sh && node scripts/reembed-document-chunks.js

const { Pool } = require('pg');
const embeddingService = require('../src/services/embeddingService');
const aiDocumentChunkRepository = require('../src/repositories/aiDocumentChunkRepository');

async function main() {
  if (!embeddingService.isAvailable()) {
    console.error('embeddingService.isAvailable() is false — no embedding provider configured. Aborting.');
    process.exitCode = 1;
    return;
  }
  const model = embeddingService.currentModel();
  console.log(`Re-embedding document chunks under model=${model}`);

  // RLS-bypassing admin connection — this deliberately touches every
  // tenant's chunks in one pass, same MIGRATION_DATABASE_URL pattern
  // every other maintenance/seed script in this repo already uses
  // (e.g. ai-behavioral-suite.js's seedTenant), not a per-request
  // tenant-scoped client.
  const adminPool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  try {
    // Every chunk not already under the CURRENT model, whose source
    // document still exists (skip soft-deleted documents — their
    // chunks are already invisible to search regardless of model, so
    // re-embedding them would only waste API calls).
    const { rows: stale } = await adminPool.query(
      `SELECT c.id, c.college_id, c.document_id, c.chunk_index, c.chunk_text, c.classification
       FROM ai_document_chunks c
       JOIN documents d ON d.id = c.document_id AND d.deleted_at IS NULL
       WHERE c.model != $1
         AND NOT EXISTS (
           SELECT 1 FROM ai_document_chunks c2
           WHERE c2.document_id = c.document_id AND c2.chunk_index = c.chunk_index AND c2.model = $1
         )
       ORDER BY c.document_id, c.chunk_index`,
      [model],
    );

    if (stale.length === 0) {
      console.log('Nothing to do — every chunk already has a row under the current model.');
      return;
    }
    console.log(`${stale.length} chunk(s) need re-embedding.`);

    for (const chunk of stale) {
      // Sequential, not Promise.all — real API rate limits, same
      // reasoning ai-behavioral-suite.js's own scenario loop uses.
      // eslint-disable-next-line no-await-in-loop
      const [embedding] = await embeddingService.embed([chunk.chunk_text], { inputType: 'passage' });
      // eslint-disable-next-line no-await-in-loop
      await aiDocumentChunkRepository.create(adminPool, {
        collegeId: chunk.college_id,
        documentId: chunk.document_id,
        chunkIndex: chunk.chunk_index,
        chunkText: chunk.chunk_text,
        classification: chunk.classification,
        embedding,
        model,
      });
      console.log(`  re-embedded document ${chunk.document_id} chunk ${chunk.chunk_index}`);
    }
    console.log(`Done — ${stale.length} chunk(s) re-embedded under ${model}.`);
  } finally {
    await adminPool.end();
  }
}

main();
