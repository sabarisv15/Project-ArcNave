'use strict';

// ADR-030 P3 follow-up — the controlled causal experiment that must run
// BEFORE any tool-pinning / workspace-tier design work.
//
// cache-hit-analysis.js established from 45 real audit rows that Vertex
// has never returned `cachedContentTokenCount` for this deployment. That
// is a "no signal" result, NOT a demonstrated cache miss and NOT evidence
// that tool declarations break the prefix — production traffic varies too
// many things at once to attribute a cause. Google documents implicit
// caching as supported and on by default for this model/endpoint, so the
// absence of signal is the thing that needs explaining.
//
// Three arms, each changing exactly ONE thing from the previous:
//
//   A  identical large system prompt, trivial user turn, NO tools, N times.
//      Establishes whether implicit caching produces any signal at all in
//      this project/region/model. This is the baseline; without a hit here
//      nothing downstream is interpretable.
//
//   B  identical to A plus a FIXED tool-declaration block, N times.
//      A hits and B doesn't => tool declarations are a legitimate suspect.
//
//   C  same as B but the tool set rotates: A A B A.
//      Only meaningful if B hit. Isolates *changing* declarations from
//      *having* declarations — the actual round-32 question.
//
// Arms run newest-first within a short window because implicit cache
// entries are short-lived; a slow arm ordering would test TTL expiry
// rather than prefix stability.
//
// COSTS REAL MONEY: ~12 live Vertex calls at ~6k input tokens each.
// Requires ADC (`gcloud auth application-default login`) and the same
// GEMINI_* env the app uses (`. ./.env.local.sh`).

const gemini = require('../src/services/aiProviders/gemini');
const aiContextAssembly = require('../src/services/aiContextAssembly');

const cfg = {
  projectId: process.env.GEMINI_PROJECT_ID || null,
  location: process.env.GEMINI_LOCATION || null,
  model: process.env.GEMINI_MODEL || null,
};

const REPS = 3;
// Vertex enforces a tokens-per-minute quota per project: a first run at
// ~17k tokens x 12 rapid calls returned 429 RESOURCE_EXHAUSTED while a
// single small call immediately after succeeded, so this is throughput,
// not a hard block. Spacing the calls keeps the arms comparable — a 429
// mid-arm would otherwise read as a cache result.
const DELAY_MS = 20_000;

const sleep = (ms) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

// ~22k chars (~5.5k tokens) of stable, filler-free system text — the same
// order of magnitude as the 6,246-char system prompt production actually
// sends, so the arms test prefix stability at a realistic size rather than
// at a size that trips quota. Content is inert prose, never instructions.
const STABLE_SYSTEM = Array.from(
  { length: 100 },
  (_, i) =>
    `Reference clause ${i + 1}: ` +
    'this paragraph exists solely to occupy a stable, repeated position in the ' +
    'system instruction so that a prefix-matching cache has something of ' +
    'realistic size to match against across consecutive requests.',
).join('\n');

function decl(name) {
  return {
    name,
    description: `Fixed experimental tool ${name}; never actually invoked by this script.`,
    params: { type: 'object', properties: { q: { type: 'string' } } },
  };
}
const TOOLSET_A = ['alpha_one', 'alpha_two', 'alpha_three'].map(decl);
const TOOLSET_B = ['beta_one', 'beta_two', 'beta_three'].map(decl);

function ctx(question, tools) {
  return aiContextAssembly.buildContext(
    [
      aiContextAssembly.segment({
        source: 'stable-system',
        stability: aiContextAssembly.STABILITY.STATIC,
        target: 'system',
        content: STABLE_SYSTEM,
      }),
      aiContextAssembly.segment({
        source: 'question',
        stability: aiContextAssembly.STABILITY.TURN,
        target: 'user',
        content: question,
      }),
    ],
    tools ? { tools } : undefined,
  );
}

async function one(label, question, tools) {
  const startedAt = Date.now();
  const res = tools
    ? await gemini.completeWithTools(cfg, ctx(question, tools))
    : await gemini.completeWithMeta(cfg, ctx(question));
  const u = res.usage || {};
  return {
    arm: label,
    tools: tools ? tools.map((t) => t.name).join(',') : '(none)',
    inputTokens: u.inputTokens,
    // undefined here is the whole point of the experiment — printed as
    // 'NO SIGNAL' rather than coerced to 0, matching gemini.js's own rule
    // that an absent field never means a confirmed zero.
    cachedTokens: u.cachedTokens === undefined ? 'NO SIGNAL' : u.cachedTokens,
    latencyMs: Date.now() - startedAt,
  };
}

async function main() {
  if (!gemini.isConfigured(cfg)) {
    console.error('GEMINI_PROJECT_ID not set — run `. ./.env.local.sh` first.');
    process.exit(1);
  }
  console.log(`model=${cfg.model} location=${cfg.location} systemChars=${STABLE_SYSTEM.length}\n`);
  const rows = [];

  const plan = [
    ...Array.from({ length: REPS }, () => ['A no-tools', null]),
    ...Array.from({ length: REPS }, () => ['B fixed-tools', TOOLSET_A]),
    ['C rotating', TOOLSET_A],
    ['C rotating', TOOLSET_A],
    ['C rotating', TOOLSET_B],
    ['C rotating', TOOLSET_A],
  ];
  for (const [label, tools] of plan) {
    // eslint-disable-next-line no-await-in-loop
    const row = await one(label, 'hi', tools);
    console.log(`${row.arm.padEnd(15)} in=${row.inputTokens} cached=${row.cachedTokens} ${row.latencyMs}ms`);
    rows.push(row);
    // eslint-disable-next-line no-await-in-loop
    await sleep(DELAY_MS);
  }

  console.table(rows);
  const hit = rows.filter((r) => typeof r.cachedTokens === 'number' && r.cachedTokens > 0);
  console.log(`\ncache hits: ${hit.length}/${rows.length}`);
  if (hit.length === 0) {
    console.log('Arm A never hit => the cause is upstream of tool declarations.');
    console.log('Investigate cache eligibility/request construction, NOT tool retrieval.');
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
