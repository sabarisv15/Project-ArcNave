'use strict';

// Query mechanics for `ai_tool_embeddings` only — no business logic
// (which tools need embedding, similarity thresholds, permission
// scoping all live in aiToolRetrievalService.js), same repository/
// service split aiDocumentChunkRepository.js already keeps for the
// same kind of table.

function toVectorLiteral(embedding) {
  return `[${embedding.join(',')}]`;
}

// model (ADR-030 P0): the row is fully overwritten on every upsert
// (tool_name stays the sole PK — one row per tool, always its
// most-recently-embedded model), so re-embedding under a new model
// naturally replaces the old vector rather than leaving a second,
// stale-model row behind.
async function upsert(client, { toolName, embedding, model }) {
  await client.query(
    `INSERT INTO ai_tool_embeddings (tool_name, embedding, model, updated_at)
     VALUES ($1, $2::vector, $3, now())
     ON CONFLICT (tool_name) DO UPDATE SET embedding = EXCLUDED.embedding, model = EXCLUDED.model, updated_at = now()`,
    [toolName, toVectorLiteral(embedding), model],
  );
}

// model (ADR-030 P0): "existing" now means "already embedded under the
// CURRENT model," not merely "has some row." aiToolRetrievalService.
// ensureEmbeddings previously checked tool_name existence only, so a
// EMBEDDING_PROVIDER/embeddingModel change left every already-known
// tool's stale-model row silently treated as up to date, never
// re-embedded — this makes a model change self-healing: every tool
// becomes "missing" for the new model and gets re-embedded/overwritten
// on the next call, instead of silently ranking mixed vector spaces.
async function findExistingToolNames(client, toolNames, model) {
  if (!toolNames || toolNames.length === 0) return [];
  const result = await client.query(
    'SELECT tool_name FROM ai_tool_embeddings WHERE tool_name = ANY($1) AND model = $2',
    [toolNames, model],
  );
  return result.rows.map((row) => row.tool_name);
}

// Nearest tools by cosine distance (`<=>`, smaller is more similar),
// restricted to `toolNames` (the caller's already role/permission-
// filtered set — this repository never decides which tools a role may
// see, it only ranks within whatever set it's given).
async function search(client, { toolNames, embedding, limit }) {
  if (!toolNames || toolNames.length === 0) return [];
  const result = await client.query(
    `SELECT tool_name, embedding <=> $2::vector AS distance
     FROM ai_tool_embeddings
     WHERE tool_name = ANY($1)
     ORDER BY embedding <=> $2::vector
     LIMIT $3`,
    [toolNames, toVectorLiteral(embedding), limit],
  );
  return result.rows;
}

module.exports = {
  upsert, findExistingToolNames, search,
};
