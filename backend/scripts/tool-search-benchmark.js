'use strict';

// Priority 1, Phase 1 benchmark — Tool Search vs the current
// architecture, against the real seeded 'demo' college / CSE-A data,
// real (billable, authorized this session) Gemini + Vertex MaaS calls.
//
// Token/latency numbers come from real ai_llm_call audit rows —
// logLlmCall's own real usage block (Vertex/MaaS's own reported
// prompt_tokens/completion_tokens, the same mechanism this codebase
// already uses everywhere else for this telemetry), not a separate
// approximation or a re-derived countTokens estimate. This is the
// actual request that was sent, tool declarations and all.
//
// Reports, per this session's approved plan (Sections 13/19/20):
// Tool Search input/output tokens, Gemini reasoning input/output
// tokens, Gemini synthesis input/output tokens, call count, latency,
// and tool-selection accuracy (recall/precision/full-coverage against
// the expected tool set) — for OLD (Tool Search disabled) and NEW
// (Tool Search enabled) paths, same reasoning model both times, so the
// comparison isolates the Tool Search change specifically. Computed as
// a plain sum, never a subtraction of any term (the exact correction
// this session's plan needed after an earlier typo):
//   NEW TOTAL = Tool Search in+out + Gemini reasoning in+out + Gemini synthesis in+out
//   OLD TOTAL = Gemini decision in+out + Gemini synthesis in+out
//
// Prerequisites: docker compose up -d db app; migrations + db/seed-
// test-data.sql already loaded; real GEMINI_PROJECT_ID/ADC already
// configured in the app container env (confirmed this session).
//
// Run (inside the app container):
//   TOOL_SEARCH_MODEL=qwen/qwen3-next-80b-a3b-thinking-maas \
//     node scripts/tool-search-benchmark.js
// TOOL_SEARCH_MODEL is required — no default, matching config.js's own
// "never hardcode the model" comment. Does NOT permanently change
// TOOL_SEARCH_ENABLED — config.toolSearch is mutated in-process, per
// path, for the duration of this script only, and restored after.

const { Pool } = require('pg');
const config = require('../src/config');
const aiService = require('../src/services/aiService');
const aiToolRegistry = require('../src/services/aiToolRegistry');

const PRINCIPAL_USER_ID = '32b4721e-e58a-4aa1-9c7d-81d5865be9b2';
const COLLEGE_ID = 'demo';
const REPETITIONS = 3;

// Exact wording from this session's approved plan (Section 16) — not
// re-derived or "improved" here.
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

// audit_log is a tenant table under RLS (ADR-002) — a plain
// appPool.query with no app.current_tenant set would see zero rows,
// not an error, which would silently make every measurement below read
// as "no calls happened." Read inside the same tenant-scoped
// transaction pattern the write side already uses.
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

function sumBy(rows, purpose, field) {
  return rows.filter((r) => r.purpose === purpose).reduce((sum, r) => sum + (r[field] || 0), 0);
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
    result, threw, llmCalls, invocationLog,
  };
}

function summarizeAccuracy(expectedTools, invoked) {
  const expected = new Set(expectedTools);
  const actual = new Set(invoked);
  const recallHits = [...expected].filter((t) => actual.has(t)).length;
  const truePositives = [...actual].filter((t) => expected.has(t)).length;
  return {
    expected: [...expected],
    actual: [...actual],
    recall: expected.size === 0 ? 1 : recallHits / expected.size,
    precision: actual.size === 0 ? 1 : truePositives / actual.size,
    fullCoverage: recallHits === expected.size,
  };
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// A real, live-hit 429 (RESOURCE_EXHAUSTED) mid-run showed this project's
// Vertex quota does not tolerate back-to-back turns with zero spacing —
// a real infra constraint, not an architecture signal, so a rep that
// threw a 429 is retried (once) after a pause rather than silently
// recorded as a misleading "zero tokens, zero coverage" data point.
const INTER_TURN_DELAY_MS = 4000;
const MAX_429_RETRIES = 2;

async function runPath(appPool, identityContext, test, path, toolSearchModel) {
  config.toolSearch.enabled = path === 'new';
  config.toolSearch.model = toolSearchModel;

  const reps = [];
  for (let i = 0; i < REPETITIONS; i += 1) {
    if (i > 0 || reps.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(INTER_TURN_DELAY_MS);
    }
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
  const toolSearchIn = sumBy(llmCalls, 'tool_search', 'inputTokens');
  const toolSearchOut = sumBy(llmCalls, 'tool_search', 'outputTokens');
  const reasoningIn = sumBy(llmCalls, 'tool_select', 'inputTokens') + sumBy(llmCalls, 'tool_select_continue', 'inputTokens');
  const reasoningOut = sumBy(llmCalls, 'tool_select', 'outputTokens') + sumBy(llmCalls, 'tool_select_continue', 'outputTokens');
  const synthesisIn = sumBy(llmCalls, 'tool_answer', 'inputTokens') + sumBy(llmCalls, 'plan_synthesis', 'inputTokens');
  const synthesisOut = sumBy(llmCalls, 'tool_answer', 'outputTokens') + sumBy(llmCalls, 'plan_synthesis', 'outputTokens');
  const totalCalls = llmCalls.length;
  const totalLatency = llmCalls.reduce((s, r) => s + (r.latencyMs || 0), 0);
  console.log(
    `  rep ${index + 1}: calls=${totalCalls} toolSearch(in=${toolSearchIn},out=${toolSearchOut}) `
    + `reasoning(in=${reasoningIn},out=${reasoningOut}) synthesis(in=${synthesisIn},out=${synthesisOut}) `
    + `totalLatencyMs=${totalLatency}`,
  );
  console.log(`           invoked=${JSON.stringify(rep.invocationLog)}`);
  return {
    toolSearchIn, toolSearchOut, reasoningIn, reasoningOut, synthesisIn, synthesisOut, totalCalls, totalLatency,
  };
}

function avg(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

async function main() {
  const toolSearchModel = process.env.TOOL_SEARCH_MODEL;
  if (!toolSearchModel) {
    throw new Error('TOOL_SEARCH_MODEL env var is required (e.g. qwen/qwen3-next-80b-a3b-thinking-maas) — no default, per config.js\'s own "never hardcode the model" convention.');
  }
  const originalEnabled = config.toolSearch.enabled;
  const originalModel = config.toolSearch.model;

  const appPool = new Pool({ connectionString: config.databaseUrl });
  const identityContext = { userId: PRINCIPAL_USER_ID, role: 'principal', collegeId: COLLEGE_ID };

  const allSummaries = [];
  try {
    for (const test of TESTS) {
      console.log(`\n\n########## ${test.label}: "${test.question}" ##########`);
      console.log(`expected tools: ${JSON.stringify(test.expectedTools)}`);

      for (const path of ['old', 'new']) {
        console.log(`\n--- path: ${path.toUpperCase()} (TOOL_SEARCH_ENABLED=${path === 'new'}) ---`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(INTER_TURN_DELAY_MS);
        // eslint-disable-next-line no-await-in-loop
        const reps = await runPath(appPool, identityContext, test, path, toolSearchModel);
        const metrics = reps.map((rep, i) => reportRep(rep, i)).filter(Boolean);
        const accuracyPerRep = reps.filter((r) => !r.threw).map((r) => summarizeAccuracy(test.expectedTools, r.invocationLog));

        const summary = {
          test: test.label,
          path,
          repsOk: metrics.length,
          repsThrew: reps.length - metrics.length,
          avgToolSearchIn: avg(metrics.map((m) => m.toolSearchIn)),
          avgToolSearchOut: avg(metrics.map((m) => m.toolSearchOut)),
          avgReasoningIn: avg(metrics.map((m) => m.reasoningIn)),
          avgReasoningOut: avg(metrics.map((m) => m.reasoningOut)),
          avgSynthesisIn: avg(metrics.map((m) => m.synthesisIn)),
          avgSynthesisOut: avg(metrics.map((m) => m.synthesisOut)),
          avgTotalCalls: avg(metrics.map((m) => m.totalCalls)),
          avgTotalLatencyMs: avg(metrics.map((m) => m.totalLatency)),
          fullCoverageRate: accuracyPerRep.length ? accuracyPerRep.filter((a) => a.fullCoverage).length / accuracyPerRep.length : 0,
          avgRecall: avg(accuracyPerRep.map((a) => a.recall)),
          avgPrecision: avg(accuracyPerRep.map((a) => a.precision)),
        };
        summary.grandTotalTokens = summary.avgToolSearchIn + summary.avgToolSearchOut
          + summary.avgReasoningIn + summary.avgReasoningOut + summary.avgSynthesisIn + summary.avgSynthesisOut;
        allSummaries.push(summary);
        console.log(`  SUMMARY: ${JSON.stringify(summary, null, 2)}`);
      }
    }

    console.log('\n\n========== FINAL COMPARISON TABLE (averages across repetitions) ==========');
    console.log('test  | path | toolSearch(io) | reasoning(io) | synthesis(io) | grandTotal | avgCalls | avgLatencyMs | fullCoverage | recall | precision');
    allSummaries.forEach((s) => {
      console.log(
        `${s.test.padEnd(6)}| ${s.path.padEnd(5)}| ${(s.avgToolSearchIn + s.avgToolSearchOut).toFixed(0).padEnd(15)}| `
        + `${(s.avgReasoningIn + s.avgReasoningOut).toFixed(0).padEnd(14)}| ${(s.avgSynthesisIn + s.avgSynthesisOut).toFixed(0).padEnd(14)}| `
        + `${s.grandTotalTokens.toFixed(0).padEnd(11)}| ${s.avgTotalCalls.toFixed(1).padEnd(9)}| ${s.avgTotalLatencyMs.toFixed(0).padEnd(13)}| `
        + `${(s.fullCoverageRate * 100).toFixed(0)}%`.padEnd(13) + `| ${s.avgRecall.toFixed(2)} | ${s.avgPrecision.toFixed(2)}`,
      );
    });

    console.log('\n========== NEW vs OLD total token economics, per test (sum, never a subtraction) ==========');
    TESTS.forEach((test) => {
      const oldS = allSummaries.find((s) => s.test === test.label && s.path === 'old');
      const newS = allSummaries.find((s) => s.test === test.label && s.path === 'new');
      const delta = newS.grandTotalTokens - oldS.grandTotalTokens;
      const verdict = delta < 0 ? 'NEW IS CHEAPER' : 'OLD IS CHEAPER OR EQUAL — NEW ADDS COST';
      console.log(
        `${test.label}: OLD TOTAL=${oldS.grandTotalTokens.toFixed(0)} tok, NEW TOTAL=${newS.grandTotalTokens.toFixed(0)} tok, `
        + `delta=${delta.toFixed(0)} tok -> ${verdict} | OLD coverage=${(oldS.fullCoverageRate * 100).toFixed(0)}% NEW coverage=${(newS.fullCoverageRate * 100).toFixed(0)}%`,
      );
    });
  } finally {
    config.toolSearch.enabled = originalEnabled;
    config.toolSearch.model = originalModel;
    await appPool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
