'use strict';

// Provider-independent Tool Retrieval (round 32) — replaces
// aiToolRegistry.filterToolsByRelevance as askAgent's PRIMARY tool-
// shortlisting path. That function is keyword-based and structurally
// blind to exactly the messages that need shortlisting most: "hi",
// "ok", short Tamil/Tanglish turns, typos — anything with no 3+letter
// non-stopword token produced zero ranking signal, which used to mean
// "send every role-permitted tool's full schema" (a measured ~13K
// tokens for a bare "hi" on a 69-tool role). Semantic similarity has
// no such blind spot: "hi" still embeds to *something* comparable
// against the tool index, so a similarity threshold can correctly
// return zero tools instead of falling back to all of them.
//
// This file knows nothing about which LLM is answering the question —
// embeddingService.js resolves ONE platform-wide embedding provider
// (config.embeddingProvider, independent of any college's own chat
// provider/adapter), so adding a tenth chat provider tomorrow changes
// nothing here. When embeddingService.isAvailable() is false (or an
// embedding call fails at request time — a network/quota hiccup must
// never break an entire chat turn), this falls back to the existing
// lexical filterToolsByRelevance, now itself fixed to always respect
// RANK_CAP (see that function's own comment) — so "never send all
// tools just because retrieval failed" holds on both tiers, not just
// the semantic one.
//
// TOP_K/SIMILARITY_DISTANCE_THRESHOLD are fixed constants for this
// first slice, not adaptive-by-query-difficulty (that's an explicitly
// deferred fast-follow, once real retrieval quality can be measured
// against live usage) — same "deliberately conservative, no eval set
// yet" honesty aiToolRegistry.js's own RANK_CAP comment already
// carries for the lexical tier.

const embeddingService = require('./embeddingService');
const aiToolEmbeddingRepository = require('../repositories/aiToolEmbeddingRepository');
const aiToolRegistry = require('./aiToolRegistry');

// pgvector cosine distance (`<=>`) is 0 for identical, 1 for
// orthogonal, 2 for opposite. 0.8 is a deliberately permissive first
// value — biased toward "include it" the same way the lexical tier's
// own RANK_CAP comment already accepts extra tokens over a hard
// exclusion — and is expected to be re-tuned once real query/tool-
// match pairs exist to measure recall against, not left here forever.
const SIMILARITY_DISTANCE_THRESHOLD = 0.8;
// "3-8 tools" per this round's own design brief — the high end of
// that range, not the low end, for the same bias-toward-recall reason
// the threshold above uses. Adaptive K (varying this by query
// difficulty) is an explicitly deferred fast-follow, not this slice.
const TOP_K = 8;

function toolEmbeddingText(tool) {
  return `${tool.name.replace(/_/g, ' ')}: ${tool.description}`;
}

// Self-healing backfill: ai_tool_embeddings starts empty and this
// registry has no separate deploy-time seed step — the first request
// that needs a tool this table has never seen embeds+stores it, every
// later request for that same tool is a pure read. Only ever embeds
// the (small, role-filtered) tools missing a row, never the full
// registry on every call.
async function ensureEmbeddings(client, tools) {
  const names = tools.map((t) => t.name);
  // ADR-030 P0 embedding provenance: "existing" is now scoped to the
  // CURRENT model (aiToolEmbeddingRepository.findExistingToolNames's own
  // comment) — a EMBEDDING_PROVIDER/embeddingModel change makes every
  // tool "missing" again here, so it gets re-embedded and its stale-model
  // row overwritten, rather than silently left in the old vector space.
  const model = embeddingService.currentModel();
  const existing = new Set(await aiToolEmbeddingRepository.findExistingToolNames(client, names, model));
  const missing = tools.filter((t) => !existing.has(t.name));
  if (missing.length === 0) return;

  const vectors = await embeddingService.embed(missing.map(toolEmbeddingText), { inputType: 'passage' });
  await Promise.all(missing.map((tool, i) => aiToolEmbeddingRepository.upsert(client, {
    toolName: tool.name, embedding: vectors[i], model,
  })));
}

async function retrieveSemantic(client, roleTools, question) {
  await ensureEmbeddings(client, roleTools);
  const [questionEmbedding] = await embeddingService.embed([question], { inputType: 'query' });
  const ranked = await aiToolEmbeddingRepository.search(client, {
    toolNames: roleTools.map((t) => t.name),
    embedding: questionEmbedding,
    limit: TOP_K,
  });
  const byName = new Map(roleTools.map((t) => [t.name, t]));
  return ranked
    .filter((row) => row.distance <= SIMILARITY_DISTANCE_THRESHOLD)
    .map((row) => byName.get(row.tool_name))
    .filter(Boolean);
}

// `roleTools` is already role/permission-filtered by the caller
// (aiService.askAgent) — this never decides which tools a role may
// see, only which of that already-permitted set are worth sending
// full schemas for on this turn.
async function retrieveRelevantTools(client, { roleTools, question }) {
  if (roleTools.length <= TOP_K) return roleTools;

  if (embeddingService.isAvailable()) {
    try {
      return await retrieveSemantic(client, roleTools, question);
    } catch {
      // A transient embedding-call failure (network/quota) must never
      // break an entire chat turn — degrade to the lexical tier below,
      // same as the "embeddings unavailable" path.
    }
  }

  return aiToolRegistry.filterToolsByRelevance(roleTools, question);
}

module.exports = { retrieveRelevantTools };
