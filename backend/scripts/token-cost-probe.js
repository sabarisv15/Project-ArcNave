// Measures F9 (conversation_read's actual token cost) and F13 (the
// tool_select function-declarations payload's real size, 85 tools vs the
// current 106) against the real Vertex AI countTokens endpoint — same
// technique and same model ADL-055's own 11,514/1,423/2,176/424 tok
// measurement used, so these numbers are directly comparable to it.
// Run inside the app container (needs GEMINI_PROJECT_ID/LOCATION/MODEL +
// ADC, same as any live Gemini call this session already made):
//   docker compose exec app node scripts/token-cost-probe.js [collegeId]
'use strict';

const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');
const config = require('../src/config');
const { appPool } = require('../src/db/pool');
const toolRegistry = require('../src/services/aiToolRegistry');
require('../src/services/aiInteractionService'); // registers present_* tools
require('../src/services/aiDiagramService');

const COLLEGE_ID = process.argv[2] || 'demo';

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const auth = new GoogleAuth({ scopes: CLOUD_PLATFORM_SCOPE });

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
  const loc = cfg.location || 'global'; // gemini.js's own DEFAULT_LOCATION
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

function toolsToDeclarations(names, allTools) {
  const byName = new Map(allTools.map((t) => [t.name, t]));
  return names
    .map((name) => byName.get(name))
    .filter(Boolean)
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: stripAdditionalProperties(tool.params),
    }));
}

const DUMMY_CONTENTS = [{ role: 'user', parts: [{ text: 'What is my attendance today?' }] }];

async function measureF13() {
  const current = toolRegistry.listTools({ excludeHumanOnly: true, role: 'principal' });

  // 85-tool baseline = the tool set as of the last commit (HEAD), before
  // this session's 21-tool addition. Names read from a file extracted on
  // the host via `git show HEAD:...` (this container has no .git — only
  // backend/ is bind-mounted), then matched against the CURRENT registry
  // so descriptions reflect real live schemas, not a hand-copied guess.
  const headNamesPath = path.join(__dirname, '.head-tool-names.txt');
  const headNames = fs.readFileSync(headNamesPath, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
    .filter((n) => current.some((t) => t.name === n));

  const currentDecls = toolsToDeclarations(current.map((t) => t.name), current);
  const headDecls = toolsToDeclarations(headNames, current); // current descriptions for tools that already existed at HEAD

  const [beforeTok, afterTok] = await Promise.all([
    countTokens({ contents: DUMMY_CONTENTS, tools: [{ functionDeclarations: headDecls }] }),
    countTokens({ contents: DUMMY_CONTENTS, tools: [{ functionDeclarations: currentDecls }] }),
  ]);

  console.log('\n=== F13: tool_select functionDeclarations token cost (role=principal) ===');
  console.log(`Before (HEAD, ${headDecls.length} tools):   ${beforeTok} tok`);
  console.log(`After  (working tree, ${currentDecls.length} tools): ${afterTok} tok`);
  console.log(`Delta: +${afterTok - beforeTok} tok (${(((afterTok - beforeTok) / beforeTok) * 100).toFixed(1)}%)`);
  console.log('Note: "before" reuses CURRENT descriptions for tools that already existed at HEAD — a handful may have been edited this session, so this is a real but approximate delta, not a byte-exact replay of the old registry.');
}

async function measureF9() {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [COLLEGE_ID]);

    const { rows } = await client.query(`
      SELECT conversation_id
      FROM messages
      GROUP BY conversation_id
      ORDER BY sum(length(coalesce(presentation::text, '')) + length(coalesce(raw_data::text, ''))) DESC
      LIMIT 1
    `);
    if (!rows.length) {
      console.log(`\n=== F9: no conversations found for college '${COLLEGE_ID}' ===`);
      await client.query('ROLLBACK');
      return;
    }
    const conversationId = rows[0].conversation_id;
    const { rows: messages } = await client.query(
      `SELECT role, content, presentation, raw_data, created_at
       FROM messages WHERE conversation_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [conversationId],
    );
    await client.query('COMMIT');

    const full = messages.map((m) => ({
      role: m.role, content: m.content, presentation: m.presentation, rawData: m.raw_data, createdAt: m.created_at,
    }));
    const guarded = messages.map((m) => ({ role: m.role, content: m.content, createdAt: m.created_at }));

    const asText = (obj) => JSON.stringify(obj);
    const [fullTok, guardedTok] = await Promise.all([
      countTokens({ contents: [{ role: 'user', parts: [{ text: asText(full) }] }] }),
      countTokens({ contents: [{ role: 'user', parts: [{ text: asText(guarded) }] }] }),
    ]);

    console.log(`\n=== F9: conversation_read token cost (largest conversation for '${COLLEGE_ID}', ${messages.length} messages) ===`);
    console.log(`conversationId: ${conversationId}`);
    console.log(`Unguarded (role+content+presentation+rawData+createdAt): ${fullTok} tok`);
    console.log(`Guarded (role+content+createdAt only, actual tool output): ${guardedTok} tok`);
    console.log(`Guard saves: ${fullTok - guardedTok} tok (${(((fullTok - guardedTok) / fullTok) * 100).toFixed(1)}%) on this conversation.`);
    console.log('Note: this dev DB has no conversation carrying an ADL-055-scale document extraction (the 125,048-token case was measured against real ledger-PDF content not present here) — this measures the guard on realistic-but-modest local data, not the worst case. The worst case is already bounded by construction: the guard drops exactly the two fields (rawData/presentation) that carried that cost, regardless of how large they get.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

(async () => {
  try {
    await measureF13();
    await measureF9();
  } catch (err) {
    console.error('Probe failed:', err.message);
    process.exitCode = 1;
  } finally {
    await appPool.end();
  }
})();
