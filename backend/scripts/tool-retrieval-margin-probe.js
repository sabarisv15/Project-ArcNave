'use strict';

// ARCNAVE modernization P2 (1.2 / clash C4) — a real, live measurement to
// GROUND the margin-based cutoff's own MARGIN constant in real numbers
// (project standing practice: measure before designing an architecture
// on a hypothesis — see e.g. ADL-058/063's own pdfplumber-attribution-
// probe.js precedent), rather than picking a value by feel the way the
// original SIMILARITY_DISTANCE_THRESHOLD = 0.8 comment openly admits it
// did ("a deliberately permissive first value... expected to be
// re-tuned once real query/tool-match pairs exist to measure recall
// against").
//
// Real Gemini embeddings (config.embeddingProvider), no Postgres needed
// — this only measures cosine distances between a question and a role's
// real tool descriptions, it never touches ai_tool_embeddings or any
// tenant data. Cheap (embeddings, not chat completions) but still a
// real billable call — not run in CI, a manual probe like every other
// script in this directory.
//
// Run (from backend/):
//   source .env.local.sh && node scripts/tool-retrieval-margin-probe.js

const embeddingService = require('../src/services/embeddingService');
const aiToolRegistry = require('../src/services/aiToolRegistry');

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

// Real, representative questions spanning the range this cutoff must
// handle correctly: a confident single-tool match, an ambiguous/
// borderline one, and a genuinely off-topic one (no real ARCNAVE tool
// should survive this last case at all).
const PROBES = [
  { label: 'confident single-tool match', question: 'What is our attendance rate for class 10B this month?' },
  { label: 'confident single-tool match 2', question: 'Show me the fee dues for the finance department' },
  { label: 'borderline / needs 2-3 tools', question: 'Check our college profile then draft an email to parents' },
  { label: 'genuinely off-topic', question: 'What is the capital of France?' },
  { label: 'genuinely off-topic 2', question: 'hi' },
];

async function main() {
  const role = 'principal';
  const roleTools = aiToolRegistry.listTools({ excludeHumanOnly: true, role });
  console.log(`Role: ${role}, ${roleTools.length} tools. Embedding model: ${embeddingService.currentModel()}\n`);

  const toolVectors = await embeddingService.embed(roleTools.map(toolEmbeddingText), { inputType: 'passage' });
  const toolsWithVectors = roleTools.map((tool, i) => ({ tool, vector: toolVectors[i] }));

  for (const probe of PROBES) {
    // eslint-disable-next-line no-await-in-loop
    const [qVector] = await embeddingService.embed([probe.question], { inputType: 'query' });
    const ranked = toolsWithVectors
      .map(({ tool, vector }) => ({ name: tool.name, distance: cosineDistance(qVector, vector) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 10);

    console.log(`--- ${probe.label}: "${probe.question}" ---`);
    ranked.forEach((r, i) => {
      const gapFromBest = i === 0 ? 0 : r.distance - ranked[0].distance;
      const gapFromPrev = i === 0 ? 0 : r.distance - ranked[i - 1].distance;
      console.log(
        `  ${i + 1}. ${r.name.padEnd(35)} distance=${r.distance.toFixed(4)}  gapFromBest=${gapFromBest.toFixed(4)}  gapFromPrev=${gapFromPrev.toFixed(4)}`,
      );
    });
    console.log('');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
