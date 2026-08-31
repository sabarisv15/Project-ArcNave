'use strict';

// ARCNAVE modernization P2 / clash C2 — end-to-end check that
// config.aiExplicitCache actually cuts billed input on the real askAgent
// decision call. Runs 3 identical curriculum turns for one principal:
// turn 1 creates the cachedContents handle, turns 2-3 reference it.
// Reads the real ai_llm_call audit rows (purpose='curriculum_decision')
// to compare promptTokenCount / cachedContentTokenCount.
//
// Real billable Vertex calls (~6). Run inside the app container with:
//   AI_EXPLICIT_CACHE=true node scripts/explicit-cache-live-turn-probe.js

const { Pool } = require('pg');
const aiService = require('../src/services/aiService');

const COLLEGE_ID = 'demo';
const PRINCIPAL_USER_ID = '32b4721e-e58a-4aa1-9c7d-81d5865be9b2';
const QUESTION = 'List the classes that have low attendance this term.';

async function withTenant(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [COLLEGE_ID]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function main() {
  const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL });
  const identityContext = { userId: PRINCIPAL_USER_ID, role: 'principal', collegeId: COLLEGE_ID };
  const since = new Date();
  for (let i = 1; i <= 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await withTenant(pool, (client) => aiService.askAgent(client, QUESTION, { identityContext }));
    process.stdout.write(`turn ${i} done\n`);
  }
  const rows = await withTenant(pool, (client) =>
    client.query(
      `SELECT created_at,
              (metadata->>'purpose') AS purpose,
              (metadata->>'inputTokens')::int AS input_tokens,
              (metadata->>'cachedTokens')::int AS cached_tokens
         FROM audit_log
        WHERE college_id = $1 AND action = 'ai_llm_call' AND created_at >= $2
        ORDER BY created_at`,
      [COLLEGE_ID, since],
    ),
  );
  console.log('\nai_llm_call rows since start:');
  for (const r of rows.rows) {
    console.log(
      `  ${r.purpose.padEnd(22)} input=${String(r.input_tokens).padStart(6)}  cached=${String(r.cached_tokens || 0).padStart(6)}  billed=${r.input_tokens - (r.cached_tokens || 0)}`,
    );
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
