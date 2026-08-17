'use strict';

// Query mechanics for `college_ai_config` only — no business logic
// (encryption, adapter resolution, default-fallback all live in
// ConfigurationService). api_key here is whatever ciphertext the
// caller already produced (or null) — this file never encrypts or
// decrypts anything, same "opaque value in, opaque value out" split
// configurationRepository.js already keeps for its own JSONB column.

async function findByCollegeId(client, collegeId) {
  const result = await client.query(
    `SELECT id, college_id, provider, api_key, model, embedding_model, base_url, created_at, updated_at
     FROM college_ai_config WHERE college_id = $1`,
    [collegeId],
  );
  return result.rows[0] || null;
}

// One row per college — ON CONFLICT (college_id) DO UPDATE, same
// single-statement upsert shape configurationRepository.upsertConfiguration
// already uses, minus that function's own optimistic-concurrency
// version column (nothing in this task asked for one here).
async function upsert(client, {
  collegeId, provider, apiKey, model, embeddingModel, baseUrl,
}) {
  const result = await client.query(
    `INSERT INTO college_ai_config (college_id, provider, api_key, model, embedding_model, base_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (college_id) DO UPDATE
       SET provider = EXCLUDED.provider,
           api_key = EXCLUDED.api_key,
           model = EXCLUDED.model,
           embedding_model = EXCLUDED.embedding_model,
           base_url = EXCLUDED.base_url,
           updated_at = now()
     RETURNING id, college_id, provider, api_key, model, embedding_model, base_url, created_at, updated_at`,
    [collegeId, provider, apiKey, model, embeddingModel, baseUrl],
  );
  return result.rows[0];
}

module.exports = { findByCollegeId, upsert };
