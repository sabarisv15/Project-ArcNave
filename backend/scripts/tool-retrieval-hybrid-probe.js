'use strict';

// ARCNAVE modernization P3 (D3 — "meaning-search only -> blend with
// keyword search + re-ranking") — a real, live measurement to decide
// whether config.aiHybridToolRetrieval (OFF by default) is worth
// enabling, same "measure before designing/flipping on an architecture"
// standing practice tool-retrieval-margin-probe.js's own header already
// documents. 1.2/C4's margin cutoff (this same modernization effort) was
// already live-measured against real Gemini embeddings; this hybrid
// fusion tier has NOT been — this script is that measurement.
//
// Reuses the SAME probe question set as tool-retrieval-margin-probe.js
// (deliberately — this is a comparison against an already-measured
// baseline, not a new one) and shows, side by side for each question:
// the pure-semantic ranking (today's live default), the pure-lexical
// ranking (aiToolRegistry.rankToolsByKeywordOverlap), and the fused
// hybrid ranking (aiToolRetrievalService.reciprocalRankFusion) — so a
// human can see concretely whether fusion recovers a real miss or just
// reshuffles an already-correct ranking.
//
// Real Gemini embeddings (config.embeddingProvider), no Postgres needed
// — same posture as tool-retrieval-margin-probe.js. Cheap but a real
// billable call — not run in CI, a manual probe.
//
// Run (from backend/):
//   source .env.local.sh && node scripts/tool-retrieval-hybrid-probe.js

const embeddingService = require('../src/services/embeddingService');
const aiToolRegistry = require('../src/services/aiToolRegistry');
const { reciprocalRankFusion, applyMarginCutoff } = require('../src/services/aiToolRetrievalService');

const ABSOLUTE_CEILING = 0.4; // must match aiToolRetrievalService.js's own constant

function cosineDistance(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function toolEmbeddingText(tool) {
  return `${tool.name.replace(/_/g, ' ')}: ${tool.description}`;
}

// Same PROBES set as tool-retrieval-margin-probe.js — see that file's
// own comment for why each one is included.
const PROBES = [
  { label: 'confident single-tool match', question: 'What is our attendance rate for class 10B this month?' },
  { label: 'confident single-tool match 2', question: 'Show me the fee dues for the finance department' },
  { label: 'borderline / needs 2-3 tools', question: 'Check our college profile then draft an email to parents' },
  { label: 'genuinely off-topic', question: 'What is the capital of France?' },
  { label: 'genuinely off-topic 2', question: 'hi' },
];

function printRanking(title, names) {
  console.log(`  ${title}: ${names.length === 0 ? '(empty)' : names.join(', ')}`);
}

async function main() {
  const role = 'principal';
  const roleTools = aiToolRegistry.listTools({ excludeHumanOnly: true, role });
  console.log(`Role: ${role}, ${roleTools.length} tools. Embedding model: ${embeddingService.currentModel()}\n`);

  const toolVectors = await embeddingService.embed(roleTools.map(toolEmbeddingText), { inputType: 'passage' });
  const toolsWithVectors = roleTools.map((tool, i) => ({ tool, vector: toolVectors[i] }));

  for (const probe of PROBES) {
    // eslint-disable-next-line no-await-in-loop
    const [qVector] = await embeddingService.embed([probe.question], { inputType: 'query' });
    const semanticRankedAll = toolsWithVectors
      .map(({ tool, vector }) => ({ tool_name: tool.name, distance: cosineDistance(qVector, vector) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8);
    const byName = new Map(roleTools.map((t) => [t.name, t]));

    const marginCutoffTools = applyMarginCutoff(semanticRankedAll).map((r) => r.tool_name);
    const semanticForFusion = semanticRankedAll
      .filter((r) => r.distance <= ABSOLUTE_CEILING)
      .map((r) => byName.get(r.tool_name))
      .filter(Boolean);
    const lexicalRanked = aiToolRegistry.rankToolsByKeywordOverlap(roleTools, probe.question);
    const lexicalTools = lexicalRanked.map((r) => r.tool);
    const hybridTools = reciprocalRankFusion(semanticForFusion, lexicalTools)
      .slice(0, 8)
      .map((t) => t.name);

    console.log(`--- ${probe.label}: "${probe.question}" ---`);
    printRanking('today (margin cutoff, pure semantic)', marginCutoffTools);
    printRanking('lexical only', lexicalTools.map((t) => t.name));
    printRanking('hybrid (RRF fusion)', hybridTools);
    const recovered = hybridTools.filter((n) => !marginCutoffTools.includes(n));
    const dropped = marginCutoffTools.filter((n) => !hybridTools.includes(n));
    if (recovered.length > 0) console.log(`  hybrid RECOVERED (not in today's result): ${recovered.join(', ')}`);
    if (dropped.length > 0) console.log(`  hybrid DROPPED (was in today's result): ${dropped.join(', ')}`);
    console.log('');
  }

  console.log(
    'Review each "RECOVERED"/"DROPPED" line above against what the real correct answer for that question should be ' +
      'before deciding whether to set AI_HYBRID_TOOL_RETRIEVAL=true — same standard tool-retrieval-margin-probe.js\'s ' +
      'own numbers were held to before ABSOLUTE_CEILING/MARGIN were finalized.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
