'use strict';

// ADR-030 P3 follow-up — read-only analysis of the `ai_llm_call` audit
// rows logLlmCall (aiService.js) already writes, to answer one question
// before any workspace/context-tier design work starts:
//
//   Does Vertex AI's implicit context caching actually fire for ARCNAVE's
//   requests, and if not, is per-turn tool-declaration variance the reason?
//
// Deliberately splits the question in two, because the two have different
// causes and different fixes:
//
//   INTRA-TURN  — the P2(c) bounded tool-use loop reuses `decisionContext`
//                 UNCHANGED and never narrows `tools` (aiService.js:1801),
//                 so iterations 2+ of one turn present a strictly growing,
//                 byte-identical prefix. If cachedTokens is still 0 here,
//                 tool variance is NOT the problem — the requests are
//                 below the model's cache-eligibility minimum, or implicit
//                 caching isn't active for this model/region at all.
//
//   INTER-TURN  — across turns of a conversation the systemInstruction is
//                 stable but the question changes and (round 32) the
//                 retrieved tool set changes. This is where tool-set
//                 stability (option A/B/C) would actually matter.
//
// Connects with MIGRATION_DATABASE_URL (the superuser role) purely so the
// audit_log RLS policy doesn't silently hide other tenants' rows from an
// operator-facing analysis; this script only ever SELECTs.

const { Pool } = require('pg');

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('set MIGRATION_DATABASE_URL (or DATABASE_URL) first — see .env');
  process.exit(1);
}

const pool = new Pool({ connectionString: url });

// `cachedTokens` is deliberately absent (not 0) when the provider gave no
// signal — gemini.js's extractUsage comment is explicit that NULL means
// "no signal," never "confirmed zero." So every aggregate below counts
// three states separately: hit (>0), confirmed-zero (=0), no-signal (NULL).
const SUMMARY = `
  SELECT
    metadata->>'provider'                              AS provider,
    metadata->>'model'                                 AS model,
    metadata->>'purpose'                               AS purpose,
    count(*)                                           AS calls,
    count(*) FILTER (WHERE (metadata->>'cachedTokens')::int > 0)  AS cache_hits,
    count(*) FILTER (WHERE (metadata->>'cachedTokens')::int = 0)  AS confirmed_zero,
    count(*) FILTER (WHERE metadata->>'cachedTokens' IS NULL)     AS no_signal,
    round(avg((metadata->>'inputTokens')::int))        AS avg_input_tok,
    round(avg((metadata->>'outputTokens')::int))       AS avg_output_tok,
    -- "Tokens per unit of user intent" proxy (Static System Prompt Overhead
    -- doc, "What to measure" #3): we don't log the user question's own
    -- token count today, so outputTokens stands in for it — a trivial
    -- question ("hi") gets a trivial reply, a real data question gets a
    -- real one, so a HIGH ratio here means a lot of prefix was paid for
    -- relative to what the turn actually produced. Proxy, not exact; a
    -- genuinely short-answer-but-hard-question turn will also score high
    -- here and that's a false positive, not a bug in this metric.
    round(avg((metadata->>'inputTokens')::int)
      / NULLIF(avg((metadata->>'outputTokens')::int), 0), 1)      AS overhead_ratio,
    round(avg((metadata->>'cachedTokens')::int)
      FILTER (WHERE (metadata->>'cachedTokens')::int > 0))        AS avg_cached_when_hit,
    round(avg((metadata->>'toolCount')::int))          AS avg_tools,
    round(avg((metadata->>'systemPromptChars')::int))  AS avg_sys_chars
  FROM audit_log
  WHERE action = 'ai_llm_call'
  GROUP BY 1, 2, 3
  ORDER BY calls DESC
`;

// Direct surfacing of the doc's "Hi costs 12,000 tokens" scenario — the
// individual calls where the smallest possible reply (few output tokens,
// implying a trivial question) still paid the largest input bill. Ordered
// by ratio, not by input_tok alone, so a genuinely large-but-proportionate
// call (big attachment, big answer) doesn't crowd out the real offenders.
const WORST_OFFENDERS = `
  SELECT
    created_at,
    metadata->>'purpose'                          AS purpose,
    (metadata->>'inputTokens')::int                AS input_tok,
    (metadata->>'outputTokens')::int                AS output_tok,
    round((metadata->>'inputTokens')::numeric
      / NULLIF((metadata->>'outputTokens')::int, 0), 1)  AS ratio,
    (metadata->>'toolCount')::int                   AS tool_count,
    (metadata->>'cachedTokens')::int                AS cached_tok
  FROM audit_log
  WHERE action = 'ai_llm_call'
    AND (metadata->>'outputTokens')::int > 0
    AND (metadata->>'outputTokens')::int <= 30
  ORDER BY ratio DESC
  LIMIT 15
`;

// Groups consecutive calls by (user, 60s window) as a proxy for "one
// askAgent turn and its tool loop" — the audit row carries no turn id, so
// this is a heuristic, not ground truth. A burst of >1 call with an
// identical toolCount is almost certainly one turn's decision call plus
// its loop iterations; that is where a growing-prefix cache hit should
// appear if implicit caching works at all.
const BURSTS = `
  WITH calls AS (
    SELECT
      created_at,
      user_id,
      metadata->>'purpose'          AS purpose,
      (metadata->>'inputTokens')::int   AS input_tok,
      (metadata->>'cachedTokens')::int  AS cached_tok,
      (metadata->>'toolCount')::int     AS tool_count,
      (metadata->>'systemPromptChars')::int AS sys_chars,
      created_at - lag(created_at) OVER (PARTITION BY user_id ORDER BY created_at) AS gap
    FROM audit_log
    WHERE action = 'ai_llm_call'
  ),
  marked AS (
    SELECT *,
      count(*) FILTER (WHERE gap IS NULL OR gap > interval '60 seconds')
        OVER (PARTITION BY user_id ORDER BY created_at
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS burst_id
    FROM calls
  )
  SELECT
    burst_id, user_id, created_at, purpose,
    row_number() OVER (PARTITION BY user_id, burst_id ORDER BY created_at) AS seq,
    input_tok, cached_tok, tool_count, sys_chars
  FROM marked
  ORDER BY user_id, burst_id, created_at
  LIMIT 200
`;

async function main() {
  const total = await pool.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'ai_llm_call'");
  console.log(`\nai_llm_call rows: ${total.rows[0].n}`);
  if (total.rows[0].n === 0) {
    console.log('\nNo telemetry yet. Run a few real multi-turn AI chat turns against');
    console.log('Vertex first, then re-run this script.\n');
    return;
  }

  console.log('\n=== 1. Cache signal by provider/model/purpose ===');
  console.table((await pool.query(SUMMARY)).rows);

  console.log('\n=== 2. Call bursts (proxy for one turn + its tool loop) ===');
  console.log('seq>1 with a stable tool_count = intra-turn growing prefix.');
  console.log('cached_tok still 0/NULL there => NOT a tool-variance problem.\n');
  console.table((await pool.query(BURSTS)).rows);

  console.log('\n=== 3. Worst offenders (trivial reply, disproportionate input bill) ===');
  console.log('output_tok<=30 (proxy for "trivial question") ranked by input/output ratio.');
  console.log('High ratio = a lot of prefix paid for what the turn actually produced.\n');
  console.table((await pool.query(WORST_OFFENDERS)).rows);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
