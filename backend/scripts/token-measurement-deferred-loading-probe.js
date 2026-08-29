'use strict';

// TOKEN MEASUREMENT ONLY — no production code modified, no billable
// generation calls. Reuses the exact countTokens mechanism and pattern
// already established in scripts/token-cost-probe.js (same technique
// behind the existing 11,514/1,423/2,176/424 baseline numbers cited in
// aiService.js:926-930), applied to 4 real roles and 4 architecture
// variants for the deferred-loading investigation.
//
// The catalogue/meta-tool TEXT-BUILDING LOGIC below is copied verbatim
// from aiService.js's own buildToolCatalogue/buildPlanMetaTool/
// buildSchemaMetaTool (private, unexported functions there) — copied,
// not reimplemented differently, so Variant A is a faithful replica of
// production. All tool names/descriptions/params come from the live
// aiToolRegistry at runtime — nothing hand-typed or guessed.
//
// Run (from backend/):
//   set -a && . ./.env.local.sh && set +a && node scripts/token-measurement-deferred-loading-probe.js

const { GoogleAuth } = require('google-auth-library');
const config = require('../src/config');
const toolRegistry = require('../src/services/aiToolRegistry');
const aiToolRetrievalService = require('../src/services/aiToolRetrievalService');
const { Pool } = require('pg');
require('../src/services/aiInteractionService'); // registers present_* tools, matches production require order
require('../src/services/aiDiagramService');

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const auth = new GoogleAuth({ scopes: CLOUD_PLATFORM_SCOPE });

const ROLES = ['principal', 'hod', 'class_tutor', 'staff'];
const COLLEGE_ID = 'demo';
// Same representative question used by the existing token-cost-probe.js
// DUMMY_CONTENTS, for direct comparability to that established baseline.
const DUMMY_CONTENTS = [{ role: 'user', parts: [{ text: 'What is my attendance today?' }] }];

function stripAdditionalProperties(schema) {
  if (Array.isArray(schema)) return schema.map(stripAdditionalProperties);
  if (schema && typeof schema === 'object') {
    const { additionalProperties, ...rest } = schema;
    const cleaned = {};
    for (const [key, value] of Object.entries(rest)) cleaned[key] = stripAdditionalProperties(value);
    return cleaned;
  }
  return schema;
}

function modelUrl(cfg, modelId, verb) {
  const loc = cfg.location || 'global';
  const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${cfg.projectId}/locations/${loc}/publishers/google/models/${modelId}:${verb}`;
}

async function countTokens(body) {
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  const cfg = config.gemini;
  const modelId = cfg.model || 'gemini-3.7-flash';
  const url = modelUrl(cfg, modelId, 'countTokens');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`countTokens ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = await res.json();
  return json.totalTokens;
}

// --- Copied verbatim from aiService.js (firstSentence, ~line 987 — the
// FIRST attempt at this in this script used a hand-guessed regex that
// diverged from the real implementation; this is the actual source,
// confirmed by reading aiService.js directly, not re-derived. ---
function firstSentence(text) {
  return String(text || '').split(/(?<=\.)\s/)[0].slice(0, 140).trim();
}
function buildToolCatalogue(roleTools, offeredNames) {
  const lines = roleTools
    .map((t) => `${t.name} — ${firstSentence(t.description)}`)
    .join('\n');
  return 'EVERY tool available to you, by name. The ones already described in full above are ready to call '
    + `directly. For any OTHER name in this list, call describe_tools with that name first to get its `
    + 'parameters — you cannot call it before doing so. If nothing here fits the question, say so plainly '
    + 'rather than answering as if you had checked.\n\n'
    + `${lines}\n\nAlready described in full above: ${offeredNames.join(', ')}.`;
}
// --- Copied verbatim from aiService.js (buildSchemaMetaTool, ~line 1004) ---
function buildSchemaMetaToolDecl() {
  return {
    name: 'describe_tools',
    description: 'Get the full parameters of one or more tools listed in the catalogue but not yet described '
      + 'above. Use this when the catalogue names a capability that fits the question better than anything '
      + 'already described. After this returns, those tools become callable in this same turn.',
    parameters: {
      type: 'object',
      required: ['names'],
      properties: {
        names: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          items: { type: 'string', description: 'an exact tool name from the catalogue' },
        },
      },
    },
  };
}
// --- Copied verbatim from aiService.js (buildPlanMetaTool, ~line 1027) ---
const MAX_PLAN_STEPS = 6;
function buildPlanMetaToolDecl() {
  return {
    name: 'run_workflow_plan',
    description: 'Run an ORDERED sequence of the tools above (2 to '
      + `${MAX_PLAN_STEPS} steps) when ONE tool alone cannot answer the question — e.g. "find students below `
      + '75% attendance, then check which of them also have pending fee corrections" needs two separate tools. '
      + 'Do NOT use this for a question one tool alone can answer — call that tool directly instead (this exists '
      + 'for genuine multi-step requests only, never as a default). Each step names one of the tools above by its '
      + 'exact name plus that tool\'s own params.',
    parameters: {
      type: 'object',
      required: ['steps'],
      properties: {
        steps: {
          type: 'array',
          minItems: 2,
          maxItems: MAX_PLAN_STEPS,
          items: {
            type: 'object',
            required: ['tool'],
            properties: {
              tool: { type: 'string', description: 'the exact name of one of the tools offered above' },
              params: { type: 'object' },
            },
          },
        },
      },
    },
  };
}

function toolToFullDecl(tool) {
  return { name: tool.name, description: tool.description, parameters: stripAdditionalProperties(tool.params) };
}

// Proposed compact line: tool_name(paramName1, paramName2) — one-line description.
// Param names read from the REAL registry schema (tool.params.properties keys) — not guessed.
function toolToCompactLine(tool) {
  const paramNames = (tool.params && tool.params.properties) ? Object.keys(tool.params.properties) : [];
  return `${tool.name}(${paramNames.join(', ')}) — ${firstSentence(tool.description)}`;
}

async function measureRole(client, role) {
  const roleTools = toolRegistry.listTools({ excludeHumanOnly: true, role });
  const retrieved = await aiToolRetrievalService.retrieveRelevantTools(client, { roleTools, question: DUMMY_CONTENTS[0].parts[0].text });
  const offeredNames = [...retrieved.map((t) => t.name), 'run_workflow_plan'];

  const currentCatalogueText = buildToolCatalogue(roleTools, offeredNames);
  const compactCatalogueText = 'CAPABILITY INDEX (compact — name(params) — description):\n\n'
    + roleTools.map(toolToCompactLine).join('\n');
  const bareNamesText = 'TOOL NAMES:\n\n' + roleTools.map((t) => t.name).join('\n');

  const top8FullDecls = retrieved.map(toolToFullDecl);
  const planDecl = buildPlanMetaToolDecl();
  const schemaDecl = buildSchemaMetaToolDecl();

  const bodies = {
    // Fixed floor — DUMMY_CONTENTS alone, nothing else — subtracted out
    // below to isolate what the catalogue/schemas themselves cost.
    floor: { contents: DUMMY_CONTENTS },

    // Variant A — current production shape: catalogue text (system) +
    // TOP_K full schemas + both meta-tool full declarations.
    variantA: {
      contents: DUMMY_CONTENTS,
      systemInstruction: { parts: [{ text: currentCatalogueText }] },
      tools: [{ functionDeclarations: [...top8FullDecls, planDecl, schemaDecl] }],
    },

    // Variant B — compact ALL-tools catalogue, zero full schemas, zero
    // function declarations at all.
    variantB: {
      contents: DUMMY_CONTENTS,
      systemInstruction: { parts: [{ text: compactCatalogueText }] },
    },

    // Variant C — Variant B's compact catalogue + the EXISTING (full)
    // run_workflow_plan/describe_tools declarations.
    variantC: {
      contents: DUMMY_CONTENTS,
      systemInstruction: { parts: [{ text: compactCatalogueText }] },
      tools: [{ functionDeclarations: [planDecl, schemaDecl] }],
    },

    // Variant D — bare names only, no params, no descriptions, no tools.
    variantD: {
      contents: DUMMY_CONTENTS,
      systemInstruction: { parts: [{ text: bareNamesText }] },
    },

    // Decomposition of Variant A's total, in isolation:
    catalogueOnly: { contents: DUMMY_CONTENTS, systemInstruction: { parts: [{ text: currentCatalogueText }] } },
    schemasOnly: { contents: DUMMY_CONTENTS, tools: [{ functionDeclarations: top8FullDecls }] },
    metaToolsOnly: { contents: DUMMY_CONTENTS, tools: [{ functionDeclarations: [planDecl, schemaDecl] }] },
  };

  const keys = Object.keys(bodies);
  const results = {};
  // Sequential, not Promise.all — countTokens is cheap but this keeps
  // per-role output ordered and avoids any rate-limit surprise across
  // 4 roles x 8 bodies = 32 calls.
  for (const key of keys) {
    // eslint-disable-next-line no-await-in-loop
    results[key] = await countTokens(bodies[key]);
  }

  return {
    role,
    totalPermitted: roleTools.length,
    retrievedTopK: retrieved.length,
    ...results,
  };
}

async function main() {
  const appPool = new Pool({ connectionString: config.databaseUrl });
  const client = await appPool.connect();
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.current_tenant', $1, true)", [COLLEGE_ID]);

  const rows = [];
  try {
    for (const role of ROLES) {
      // eslint-disable-next-line no-await-in-loop
      const r = await measureRole(client, role);
      rows.push(r);
      console.log(`\n=== role: ${role} ===`);
      console.log(JSON.stringify(r, null, 2));
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await appPool.end();
  }

  console.log('\n\n=== SUMMARY TABLE (raw countTokens totals, includes the fixed DUMMY_CONTENTS floor) ===');
  console.log('role       | permitted | topK | floor | variantA(current) | variantB(compact) | variantC(compact+meta) | variantD(bare)');
  rows.forEach((r) => {
    console.log(
      `${r.role.padEnd(11)}| ${String(r.totalPermitted).padEnd(10)}| ${String(r.retrievedTopK).padEnd(5)}| `
      + `${String(r.floor).padEnd(6)}| ${String(r.variantA).padEnd(19)}| ${String(r.variantB).padEnd(19)}| `
      + `${String(r.variantC).padEnd(23)}| ${r.variantD}`,
    );
  });

  console.log('\n=== DECOMPOSITION (catalogue-only / schemas-only / meta-tools-only, raw totals) ===');
  console.log('role       | floor | catalogueOnly | schemasOnly | metaToolsOnly | variantA(combined)');
  rows.forEach((r) => {
    console.log(
      `${r.role.padEnd(11)}| ${String(r.floor).padEnd(6)}| ${String(r.catalogueOnly).padEnd(14)}| `
      + `${String(r.schemasOnly).padEnd(13)}| ${String(r.metaToolsOnly).padEnd(14)}| ${r.variantA}`,
    );
  });

  console.log('\n=== SAVINGS (variantA - variantC, both minus floor to isolate the tool-related cost) ===');
  rows.forEach((r) => {
    const currentNet = r.variantA - r.floor;
    const proposedNet = r.variantC - r.floor;
    const saving = currentNet - proposedNet;
    const pct = ((saving / currentNet) * 100).toFixed(1);
    console.log(`${r.role}: current(net)=${currentNet} proposed(net)=${proposedNet} saving=${saving} (${pct}%)`);
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
