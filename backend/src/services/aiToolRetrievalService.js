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
//
// ARCNAVE modernization P3 (D3) — config.aiHybridToolRetrieval (OFF by
// default) adds a THIRD tier between the two above: when embeddings are
// available, blend the semantic ranking with a lexical (keyword-
// overlap) ranking via Reciprocal Rank Fusion (retrieveHybrid, below)
// instead of only ever trusting semantic distance alone. Ships behind a
// flag, same posture as config.toolSearch — see config.js's own
// comment and scripts/tool-retrieval-hybrid-probe.js for the live
// measurement needed before flipping it on.

const embeddingService = require('./embeddingService');
const aiToolEmbeddingRepository = require('../repositories/aiToolEmbeddingRepository');
const aiToolRegistry = require('./aiToolRegistry');
const config = require('../config');

// ARCNAVE modernization P2 (1.2 / clash C4) — replaces the fixed
// SIMILARITY_DISTANCE_THRESHOLD = 0.8 absolute cutoff (kept below,
// commented out, for the record) with two real, MEASURED constants —
// scripts/tool-retrieval-margin-probe.js, run live against real Gemini
// embeddings for a principal role's real 100 tools across 5
// representative questions (2 confident single-tool matches, 1
// multi-tool chain, 2 genuinely off-topic). What that run actually
// showed, and why each constant is set where it is:
//
// - On-topic best-match distances clustered 0.26-0.35; off-topic
//   best-match distances clustered 0.41-0.51 — a real, measured
//   separation in the TOP-1 distance itself, not a guess.
//   ABSOLUTE_CEILING = 0.4 sits between those two clusters: nothing
//   passes at all once even the single best candidate is this far out,
//   which is what makes a genuinely empty result possible again (the
//   old 0.8 threshold's own documented problem: "essentially never
//   returns a genuinely empty set").
// - Within the tools that DO pass the ceiling, the old absolute
//   threshold was "too loose" (PDF 1.2's own words) — it could not
//   tell a tightly-clustered, confident match (attendance_summary at
//   0.26, five genuinely attendance-related tools all within 0.09 of
//   it) from a same-magnitude but unrelated one just because both
//   cleared 0.8. MARGIN = 0.10, measured against the SAME probe run,
//   is the actual gap size that cleanly separated "the 4-5 tools
//   genuinely about this question" from "everything else that merely
//   also cleared the ceiling" in both single-tool scenarios (position
//   6 in each — finance_status_summary intruding on an attendance
//   question, list_institutional_documents intruding on a finance one —
//   sat right at or past a 0.10-0.11 gap from the best match; the
//   genuinely relevant tools before it sat well under it).
//
// Both are still a first real-measured value, not a permanent one —
// re-run the probe script against a broader query set (ideally the
// behavioral suite's own categories) once more live usage data exists,
// same "deliberately conservative, re-tune later" honesty the original
// threshold's own comment already carried. describe_tools (C4's other
// half, aiService.js's own SCHEMA_TOOL_NAME) is the deliberate safety
// net for whatever this margin still gets wrong — a wrongly-excluded
// tool is recoverable mid-turn, not a silent dead end, which is what
// makes a real cutoff (rather than the old "essentially never exclude
// anything" posture) an acceptable trade at all.
// const SIMILARITY_DISTANCE_THRESHOLD = 0.8; // superseded, see above
const ABSOLUTE_CEILING = 0.4;
const MARGIN = 0.1;
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
  await Promise.all(
    missing.map((tool, i) =>
      aiToolEmbeddingRepository.upsert(client, {
        toolName: tool.name,
        embedding: vectors[i],
        model,
      }),
    ),
  );
}

// ARCNAVE modernization P2 (1.2 / clash C4) — the margin-based cutoff
// itself. `ranked` is already ascending by distance (nearest first,
// aiToolEmbeddingRepository.search's own ORDER BY) so this is a single
// forward pass: the absolute ceiling first (nothing survives at all if
// even the best candidate is too far out — this is what makes a
// genuinely empty result possible), then the relative margin from the
// BEST match, not from each neighbour — a slow accumulation of small
// consecutive gaps must not smuggle in a tool that is, in total,
// nowhere near the actual best match.
function applyMarginCutoff(ranked) {
  if (ranked.length === 0 || ranked[0].distance > ABSOLUTE_CEILING) return [];
  const bestDistance = ranked[0].distance;
  const kept = [];
  for (const row of ranked) {
    if (row.distance > ABSOLUTE_CEILING) break; // ascending order — nothing after this clears it either
    if (row.distance - bestDistance > MARGIN) break; // same reason, relative to the best match
    kept.push(row);
  }
  return kept;
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
  return applyMarginCutoff(ranked)
    .map((row) => byName.get(row.tool_name))
    .filter(Boolean);
}

// ARCNAVE modernization P3 (D3) — Reciprocal Rank Fusion, a standard,
// deterministic, training-free way to combine two rankings whose raw
// scores are not comparable numbers (cosine distance vs. a keyword-
// overlap count) — but whose RANK POSITIONS are. For a tool appearing
// at 1-indexed rank `r` in a list, its contribution from that list is
// 1/(RRF_K + r); a tool present in both lists sums both contributions,
// naturally rewarding agreement between the two signals without either
// one dominating on its own scale. RRF_K = 60 is the standard constant
// from the technique's original paper (Cormack, Clarke & Buettcher
// 2009) — a deliberate, well-established default, not tuned against
// this project's own data (same "first real value, not a permanent
// one" honesty applyMarginCutoff's own constants carry — re-tune only
// once scripts/tool-retrieval-hybrid-probe.js has real measurements to
// re-tune it against).
const RRF_K = 60;

function reciprocalRankFusion(semanticRankedTools, lexicalRankedTools) {
  const scoreByToolName = new Map(); // toolName -> { tool, score }
  const addContributions = (rankedTools) => {
    rankedTools.forEach((tool, index) => {
      const rank = index + 1;
      const contribution = 1 / (RRF_K + rank);
      const existing = scoreByToolName.get(tool.name);
      scoreByToolName.set(tool.name, { tool, score: (existing ? existing.score : 0) + contribution });
    });
  };
  addContributions(semanticRankedTools);
  addContributions(lexicalRankedTools);
  return [...scoreByToolName.values()].sort((a, b) => b.score - a.score).map((entry) => entry.tool);
}

// The hybrid path itself — semantic candidates come from the SAME
// aiToolEmbeddingRepository.search call retrieveSemantic already makes
// (raw ranked-by-distance order), still gated by ABSOLUTE_CEILING alone
// — NOT the relative MARGIN cutoff, which is the part fusion exists to
// relax (a margin-excluded-but-ceiling-passing tool can still win a
// fused rank if the lexical signal also supports it). Keeping the
// ceiling matters: without SOME distance gate, embedding search always
// returns its nearest TOP_K neighbours regardless of how far they
// actually are, so a genuinely irrelevant question ("hi") would always
// get TOP_K tools back — exactly the bug 1.2/C4 (this same session)
// just fixed for the pure-semantic tier. Lexical candidates come from
// aiToolRegistry.rankToolsByKeywordOverlap (zero-overlap tools already
// excluded there). The fused, re-ranked list is capped at TOP_K, same
// "3-8 tools, high end of range" bias every other tier in this file
// already uses.
async function retrieveHybrid(client, roleTools, question) {
  await ensureEmbeddings(client, roleTools);
  const [questionEmbedding] = await embeddingService.embed([question], { inputType: 'query' });
  const semanticRanked = await aiToolEmbeddingRepository.search(client, {
    toolNames: roleTools.map((t) => t.name),
    embedding: questionEmbedding,
    limit: TOP_K,
  });
  const byName = new Map(roleTools.map((t) => [t.name, t]));
  const semanticRankedTools = semanticRanked
    .filter((row) => row.distance <= ABSOLUTE_CEILING)
    .map((row) => byName.get(row.tool_name))
    .filter(Boolean);

  const lexicalRanked = aiToolRegistry.rankToolsByKeywordOverlap(roleTools, question);
  const lexicalRankedTools = lexicalRanked.map((r) => r.tool);

  return reciprocalRankFusion(semanticRankedTools, lexicalRankedTools).slice(0, TOP_K);
}

// `roleTools` is already role/permission-filtered by the caller
// (aiService.askAgent) — this never decides which tools a role may
// see, only which of that already-permitted set are worth sending
// full schemas for on this turn.
//
// ARCNAVE modernization P2 (1.2 / clash C4) — the `roleTools.length <=
// TOP_K` bypass that used to sit here is gone: this IS the PDF's own
// named bug ("if a role has 8 or fewer tools, all get sent" regardless
// of what the question actually asks). A role with a small tool set now
// gets the exact same real retrieval + margin cutoff every other role
// does — the ONLY thing TOP_K still bounds is how many candidates
// aiToolEmbeddingRepository.search fetches to rank in the first place,
// never a shortcut around ranking them at all.
//
// ARCNAVE modernization P3 (D3) — config.aiHybridToolRetrieval (OFF by
// default, see config.js's own comment) switches the semantic-available
// branch between the pure-semantic margin-cutoff tier (1.2/C4, already
// live-measured) and the new fused hybrid tier — never both attempted
// per call, and the flag is read once per call so a request never
// straddles two different mechanisms. Both still share the exact same
// "embedding call failed -> degrade to lexical" catch below.
async function retrieveRelevantTools(client, { roleTools, question }) {
  if (embeddingService.isAvailable()) {
    try {
      return config.aiHybridToolRetrieval
        ? await retrieveHybrid(client, roleTools, question)
        : await retrieveSemantic(client, roleTools, question);
    } catch {
      // A transient embedding-call failure (network/quota) must never
      // break an entire chat turn — degrade to the lexical tier below,
      // same as the "embeddings unavailable" path.
    }
  }

  return aiToolRegistry.filterToolsByRelevance(roleTools, question);
}

module.exports = {
  retrieveRelevantTools,
  // Exported for direct unit testing only, same precedent aiService.js's
  // own buildHistoryHint/buildAttachmentHint exports already establish
  // for a narrow internal this file needs covered on its own, not just
  // indirectly through retrieveRelevantTools' end-to-end path.
  applyMarginCutoff,
  reciprocalRankFusion,
  retrieveHybrid,
};
