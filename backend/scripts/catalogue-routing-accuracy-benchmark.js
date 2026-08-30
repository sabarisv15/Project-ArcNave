'use strict';

// Real accuracy + token benchmark for the Gemini-native catalogue
// routing experiment (this session's follow-up to the Tool Search
// NO-GO). Gemini stays the ONLY model — config.experimentalCatalogueVariant
// is mutated in-process, per variant, for the duration of this script
// only (restored after; never enabled by default in the shipped app).
// Tool Search is explicitly forced OFF throughout, so this measures the
// catalogue-text change in isolation, not combined with that other
// experiment. Real (billable, already-authorized-this-session) Gemini
// calls against the real seeded 'demo' college / CSE-A data.
//
// ADL-064 (2026-08-30): resolved. 'keywords' and 'hybrid' were the two
// live-measured finalists; the original full-description default plus
// 'oneLine'/'category'/'spec' are retired and aiService.js can no longer
// select any of them (buildToolCatalogueForExperiment only recognizes
// 'hybrid' as an opt-in, everything else resolves to 'keywords', the new
// shipped default). VARIANTS below is narrowed to match — rerunning this
// script against the old 4-variant list would silently measure 'keywords'
// text four times over, since aiService.js no longer has those code paths.
//
// Token/latency numbers come from real ai_llm_call audit rows (same
// mechanism as scripts/tool-search-benchmark.js — Vertex's own reported
// usage, not a re-derived estimate).
//
// Run (inside the app container):
//   node scripts/catalogue-routing-accuracy-benchmark.js

const { Pool } = require('pg');
const config = require('../src/config');
const aiService = require('../src/services/aiService');
const aiToolRegistry = require('../src/services/aiToolRegistry');

const PRINCIPAL_USER_ID = '32b4721e-e58a-4aa1-9c7d-81d5865be9b2';
const COLLEGE_ID = 'demo';
const REPETITIONS = 7;

const VARIANTS = [
  { key: 'keywords', configValue: 'keywords' },
  { key: 'hybrid', configValue: 'hybrid' },
];

// Exact wording from this session's approved plan (same Test A/B/C used
// for the Tool Search benchmark, for direct comparability).
//
// Test D/E added after a real concern raised this session: A/B/C only
// ever test "a tool IS genuinely needed" questions — recall/precision
// against a real expected set. They say nothing about the opposite
// failure mode a shortened catalogue text risks: over-triggering (a
// tool fired when none should be) or picking the WRONG one of two
// overlapping-capability tools once their full-description caveats get
// compressed away. Both are real risks specific to the shortened
// variants (oneLine/keywords/category/hybrid all strip the "never use
// X for Y, prefer Y" exclusion language the full 'current' description
// carries — confirmed live this session for execute_code vs
// analyze_document_table specifically).
const TESTS = [
  {
    label: 'Test A', question: '3rd Sem CSE-A attendance percentage enna?', expectedTools: ['attendance_summary'],
  },
  {
    label: 'Test B',
    question: 'low attendance students matrum fee status kudu',
    expectedTools: ['students_low_attendance', 'finance_status_summary'],
  },
  {
    label: 'Test C',
    question: 'low attendance, fee pending, attendance summary moonrayum kudu',
    expectedTools: ['students_low_attendance', 'finance_status_summary', 'attendance_summary'],
  },
  {
    // Meta/capability question — no data need at all. A shortened
    // catalogue that drops nuance could tempt the model into invoking a
    // tool (even a harmless lookup one) just because tool names now read
    // as more generic/action-flavored once compressed. expectedTools: []
    // — any invocation at all is a precision miss.
    label: 'Test D (meta, no tool needed)',
    question: 'Unga kitta enna features irukku, enna panna mudiyum?',
    expectedTools: [],
  },
  {
    // Overlapping-capability request with NO attachment actually
    // present — execute_code and analyze_document_table both explicitly
    // require an already-uploaded chat attachment to operate on (see
    // their real registry descriptions). The correct behavior with no
    // file attached is to ask the user for the file, not guess-invoke
    // either tool. This is exactly the execute_code/analyze_document_table
    // ambiguity whose disambiguating caveat gets compressed away in
    // every shortened variant (verified this session — 'keywords'
    // renders execute_code as "Runs a short computation in an", 'hybrid'
    // as "computation", neither keeps the "prefer analyze_document_table
    // when it fits" rule). expectedTools: [] — any tool call without a
    // real attachment present is a false positive.
    label: 'Test E (overlapping tools, no attachment)',
    question: 'Oru PDF file-la irukura table-a Excel-ah maathi tharuveengala? Epdi pannuveenga?',
    expectedTools: [],
  },
];

async function withTenantClient(appPool, collegeId, fn) {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function fetchLlmCallRows(appPool, sinceIso) {
  return withTenantClient(appPool, COLLEGE_ID, async (client) => {
    const { rows } = await client.query(
      `SELECT metadata, created_at FROM audit_log
       WHERE action = 'ai_llm_call' AND college_id = $1 AND user_id = $2 AND created_at >= $3
       ORDER BY created_at ASC`,
      [COLLEGE_ID, PRINCIPAL_USER_ID, sinceIso],
    );
    return rows.map((r) => r.metadata);
  });
}

function sumBy(rows, purposes, field) {
  return rows.filter((r) => purposes.includes(r.purpose)).reduce((sum, r) => sum + (r[field] || 0), 0);
}

async function runOneTurn(appPool, identityContext, question) {
  const since = new Date();
  const invocationLog = [];
  const realInvokeTool = aiToolRegistry.invokeTool;
  aiToolRegistry.invokeTool = async (toolName, opts) => {
    const result = await realInvokeTool(toolName, opts);
    invocationLog.push(toolName);
    return result;
  };
  let result;
  let threw = null;
  try {
    result = await withTenantClient(appPool, COLLEGE_ID, (client) => aiService.askAgent(client, question, { identityContext }));
  } catch (err) {
    threw = err;
  } finally {
    aiToolRegistry.invokeTool = realInvokeTool;
  }
  const llmCalls = await fetchLlmCallRows(appPool, since.toISOString());
  return {
    result, threw, llmCalls, invocationLog, usedPlan: Boolean(result && result.plan),
  };
}

function summarizeAccuracy(expectedTools, invoked) {
  const expected = new Set(expectedTools);
  const actual = new Set(invoked);
  const recallHits = [...expected].filter((t) => actual.has(t)).length;
  const truePositives = [...actual].filter((t) => expected.has(t)).length;
  return {
    recall: expected.size === 0 ? 1 : recallHits / expected.size,
    precision: actual.size === 0 ? 1 : truePositives / actual.size,
    fullCoverage: recallHits === expected.size,
  };
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}
const INTER_TURN_DELAY_MS = 4000;
const MAX_429_RETRIES = 2;

async function runVariant(appPool, identityContext, test, variant) {
  config.experimentalCatalogueVariant = variant.configValue;
  config.toolSearch.enabled = false; // explicitly isolated from the other experiment

  const reps = [];
  for (let i = 0; i < REPETITIONS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(INTER_TURN_DELAY_MS);
    let turn;
    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      turn = await runOneTurn(appPool, identityContext, test.question);
      if (!turn.threw || !/429|RESOURCE_EXHAUSTED/.test(turn.threw.message)) break;
      console.log(`    (429 rate-limited, retrying after a pause — attempt ${attempt + 1}/${MAX_429_RETRIES})`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(INTER_TURN_DELAY_MS * 2);
    }
    reps.push(turn);
  }
  return reps;
}

function reportRep(rep, index) {
  if (rep.threw) {
    console.log(`  rep ${index + 1}: THREW ${rep.threw.name}: ${rep.threw.message}`);
    return null;
  }
  const { llmCalls } = rep;
  const decisionIn = sumBy(llmCalls, ['tool_select', 'tool_select_continue'], 'inputTokens');
  const decisionOut = sumBy(llmCalls, ['tool_select', 'tool_select_continue'], 'outputTokens');
  const synthesisIn = sumBy(llmCalls, ['tool_answer', 'plan_synthesis'], 'inputTokens');
  const synthesisOut = sumBy(llmCalls, ['tool_answer', 'plan_synthesis'], 'outputTokens');
  const totalCalls = llmCalls.length;
  const totalLatency = llmCalls.reduce((s, r) => s + (r.latencyMs || 0), 0);
  console.log(
    `  rep ${index + 1}: calls=${totalCalls} decision(in=${decisionIn},out=${decisionOut}) `
    + `synthesis(in=${synthesisIn},out=${synthesisOut}) totalLatencyMs=${totalLatency} usedPlan=${rep.usedPlan}`,
  );
  console.log(`           invoked=${JSON.stringify(rep.invocationLog)}`);
  return {
    decisionIn, decisionOut, synthesisIn, synthesisOut, totalCalls, totalLatency, usedPlan: rep.usedPlan,
  };
}

function avg(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

async function main() {
  const originalVariant = config.experimentalCatalogueVariant;
  const originalToolSearchEnabled = config.toolSearch.enabled;

  const appPool = new Pool({ connectionString: config.databaseUrl });
  const identityContext = { userId: PRINCIPAL_USER_ID, role: 'principal', collegeId: COLLEGE_ID };

  const allSummaries = [];
  try {
    for (const test of TESTS) {
      console.log(`\n\n########## ${test.label}: "${test.question}" ##########`);
      console.log(`expected tools: ${JSON.stringify(test.expectedTools)}`);

      for (const variant of VARIANTS) {
        console.log(`\n--- variant: ${variant.key} (experimentalCatalogueVariant=${JSON.stringify(variant.configValue)}) ---`);
        // eslint-disable-next-line no-await-in-loop
        const reps = await runVariant(appPool, identityContext, test, variant);
        const metrics = reps.map((rep, i) => reportRep(rep, i)).filter(Boolean);
        const accuracyPerRep = reps.filter((r) => !r.threw).map((r) => summarizeAccuracy(test.expectedTools, r.invocationLog));

        const summary = {
          test: test.label,
          variant: variant.key,
          repsOk: metrics.length,
          repsThrew: reps.length - metrics.length,
          avgDecisionIn: avg(metrics.map((m) => m.decisionIn)),
          avgDecisionOut: avg(metrics.map((m) => m.decisionOut)),
          avgSynthesisIn: avg(metrics.map((m) => m.synthesisIn)),
          avgSynthesisOut: avg(metrics.map((m) => m.synthesisOut)),
          avgTotalCalls: avg(metrics.map((m) => m.totalCalls)),
          avgTotalLatencyMs: avg(metrics.map((m) => m.totalLatency)),
          planUsageRate: metrics.length ? metrics.filter((m) => m.usedPlan).length / metrics.length : 0,
          fullCoverageRate: accuracyPerRep.length ? accuracyPerRep.filter((a) => a.fullCoverage).length / accuracyPerRep.length : 0,
          avgRecall: avg(accuracyPerRep.map((a) => a.recall)),
          avgPrecision: avg(accuracyPerRep.map((a) => a.precision)),
        };
        summary.grandTotalTokens = summary.avgDecisionIn + summary.avgDecisionOut + summary.avgSynthesisIn + summary.avgSynthesisOut;
        allSummaries.push(summary);
        console.log(`  SUMMARY: ${JSON.stringify(summary, null, 2)}`);
      }
    }

    console.log('\n\n========== FINAL COMPARISON TABLE (averages across repetitions) ==========');
    console.log('test  | variant  | decision(io) | synthesis(io) | grandTotal | avgCalls | avgLatencyMs | planUse | fullCoverage | recall | precision');
    allSummaries.forEach((s) => {
      console.log(
        `${s.test.padEnd(6)}| ${s.variant.padEnd(9)}| ${(s.avgDecisionIn + s.avgDecisionOut).toFixed(0).padEnd(13)}| `
        + `${(s.avgSynthesisIn + s.avgSynthesisOut).toFixed(0).padEnd(14)}| ${s.grandTotalTokens.toFixed(0).padEnd(11)}| `
        + `${s.avgTotalCalls.toFixed(1).padEnd(9)}| ${s.avgTotalLatencyMs.toFixed(0).padEnd(13)}| ${(s.planUsageRate * 100).toFixed(0)}%`.padEnd(9)
        + `| ${(s.fullCoverageRate * 100).toFixed(0)}%`.padEnd(13) + `| ${s.avgRecall.toFixed(2)} | ${s.avgPrecision.toFixed(2)}`,
      );
    });

    console.log('\n========== per-test: keywords vs hybrid ==========');
    // ADL-064 resolved this down to a straight two-variant comparison —
    // there is no longer a 'current' variant to diff against (it was
    // retired along with 'oneLine'/'category'/'spec'; see the file header
    // comment). Diffing 'hybrid' directly against 'keywords' (the shipped
    // default) is the only comparison still meaningful for every TEST,
    // including D/E, unlike the old current-only baseline map above which
    // never had entries for D/E and would crash on them if reused here.
    const baselineVariant = VARIANTS[0];
    TESTS.forEach((test) => {
      const baseline = allSummaries.find((s) => s.test === test.label && s.variant === baselineVariant.key);
      VARIANTS.filter((v) => v.key !== baselineVariant.key).forEach((v) => {
        const s = allSummaries.find((x) => x.test === test.label && x.variant === v.key);
        const delta = s.grandTotalTokens - baseline.grandTotalTokens;
        const pct = baseline.grandTotalTokens ? ((delta / baseline.grandTotalTokens) * 100).toFixed(1) : 'n/a';
        console.log(
          `${test.label} ${v.key} vs ${baselineVariant.key}: ${baselineVariant.key}=${baseline.grandTotalTokens.toFixed(0)} tok, `
          + `${v.key}=${s.grandTotalTokens.toFixed(0)} tok, delta=${delta.toFixed(0)} (${pct}%) `
          + `| coverage ${baselineVariant.key}=${(baseline.fullCoverageRate * 100).toFixed(0)}% ${v.key}=${(s.fullCoverageRate * 100).toFixed(0)}% `
          + `| planUse ${baselineVariant.key}=${(baseline.planUsageRate * 100).toFixed(0)}% ${v.key}=${(s.planUsageRate * 100).toFixed(0)}%`,
        );
      });
    });
  } finally {
    config.experimentalCatalogueVariant = originalVariant;
    config.toolSearch.enabled = originalToolSearchEnabled;
    await appPool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
