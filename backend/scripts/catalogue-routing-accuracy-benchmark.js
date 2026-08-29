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
const REPETITIONS = 3;

const VARIANTS = [
  { key: 'current', configValue: null },
  { key: 'oneLine', configValue: 'oneLine' },
  { key: 'keywords', configValue: 'keywords' },
  { key: 'category', configValue: 'category' },
  { key: 'spec', configValue: 'spec' },
  { key: 'hybrid', configValue: 'hybrid' },
];

// Exact wording from this session's approved plan (same Test A/B/C used
// for the Tool Search benchmark, for direct comparability).
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

    console.log('\n========== per-variant vs current, per test ==========');
    // Known-good 'current' baseline from this session's earlier full
    // run (all 3 reps succeeded, 0 throws) — reused here rather than
    // re-spending real API calls to re-measure an unchanged baseline.
    const KNOWN_CURRENT_BASELINE = {
      'Test A': { grandTotalTokens: 7402, fullCoverageRate: 1, planUsageRate: 0 },
      'Test B': { grandTotalTokens: 7540, fullCoverageRate: 1, planUsageRate: 1 },
      'Test C': { grandTotalTokens: 7594, fullCoverageRate: 1, planUsageRate: 1 },
    };
    TESTS.forEach((test) => {
      const baseline = allSummaries.find((s) => s.test === test.label && s.variant === 'current') || KNOWN_CURRENT_BASELINE[test.label];
      VARIANTS.filter((v) => v.key !== 'current').forEach((v) => {
        const s = allSummaries.find((x) => x.test === test.label && x.variant === v.key);
        const delta = s.grandTotalTokens - baseline.grandTotalTokens;
        const pct = ((delta / baseline.grandTotalTokens) * 100).toFixed(1);
        console.log(
          `${test.label} ${v.key}: current=${baseline.grandTotalTokens.toFixed(0)} tok, ${v.key}=${s.grandTotalTokens.toFixed(0)} tok, `
          + `delta=${delta.toFixed(0)} (${pct}%) | coverage current=${(baseline.fullCoverageRate * 100).toFixed(0)}% ${v.key}=${(s.fullCoverageRate * 100).toFixed(0)}% `
          + `| planUse current=${(baseline.planUsageRate * 100).toFixed(0)}% ${v.key}=${(s.planUsageRate * 100).toFixed(0)}%`,
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
