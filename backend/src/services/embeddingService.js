'use strict';

// The shared, provider-independent embedding service — the one thing
// tool retrieval (aiToolRetrievalService.js) and document search
// (documentSearchService.js) should both call into instead of each
// separately reaching for "whatever adapter the calling college's own
// chat provider happens to be" (documentSearchService.js's own prior
// pattern — configurationService.getAiConfig(collegeId) — is exactly
// the coupling this file exists to remove).
//
// Why this must be independent of a college's chat provider: Claude
// has no embed() at all (claude.js's own comment — a real Anthropic
// API gap, not a missing implementation), so a college configured to
// chat via Claude would silently lose embeddings-backed retrieval
// entirely if this service just deferred to getAiConfig like
// documentSearchService used to. config.embeddingProvider is a single
// platform-wide choice (defaults to 'gemini', which already ships a
// real embedding model with zero extra env config beyond
// GEMINI_PROJECT_ID) — swapping a college's chat provider, or adding a
// brand new one later, never touches this file or anything downstream
// of it.
//
// isAvailable() is the capability check every caller should branch on
// instead of checking a provider name — "can ARCNAVE embed text right
// now," never "is this specific provider Gemini/OpenAI/self-hosted."

const config = require('../config');
const aiProviders = require('./aiProviders');
// Reused, not reinvented: this is exactly the "a configured platform
// genuinely can't do what was asked" meaning claude.js's own embed()
// already throws for "claude has no embeddings endpoint" — and
// routes/ai.js already maps it to a real 503 with the vendor-limitation
// message shown to the caller (see that route's own comment). A second,
// bespoke error class here would mean this exact failure mode either
// bypasses that mapping (falls through to a generic 500) or requires
// duplicating the mapping for a second class meaning the same thing.
const { AiProviderCapabilityError } = require('./aiProviders/errors');

function resolve() {
  const providerName = config.embeddingProvider;
  const providerConfig = config[providerName];
  if (!providerConfig) return null;
  const adapter = aiProviders.getAdapter(providerName);
  if (typeof adapter.embed !== 'function') return null;
  return { adapter, providerConfig };
}

function isAvailable() {
  const resolved = resolve();
  if (!resolved) return false;
  const { adapter, providerConfig } = resolved;
  return adapter.isConfigured(providerConfig) && Boolean(providerConfig.embeddingModel);
}

// The embedding model name currently in effect (e.g.
// 'nvidia/nv-embedqa-e5-v5'), or null when embedding is unavailable —
// ADR-030 P0 embedding provenance: every caller that stores a new
// embedding row (documentSearchService.ingestDocument/searchDocuments,
// aiToolRetrievalService.ensureEmbeddings) records this alongside the
// vector so a later EMBEDDING_PROVIDER/embeddingModel change is
// detectable and self-healing, instead of silently blending two
// incompatible vector spaces into one cosine-distance ranking (see the
// embedding-model-provenance migration's own comment).
function currentModel() {
  const resolved = resolve();
  return resolved ? resolved.providerConfig.embeddingModel : null;
}

async function embed(texts, { inputType } = {}) {
  const resolved = resolve();
  if (!resolved) {
    throw new AiProviderCapabilityError(
      `embedding provider ${JSON.stringify(config.embeddingProvider)} is not configured or has no embed() capability`,
    );
  }
  const { adapter, providerConfig } = resolved;
  return adapter.embed(providerConfig, texts, { inputType });
}

module.exports = {
  isAvailable,
  currentModel,
  embed,
};
