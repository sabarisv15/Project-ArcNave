'use strict';

// Priority 2 — reasoning-model benchmark (current Gemini vs GLM-5.2 vs
// Kimi K2 Thinking), real Gemini + real Vertex MaaS calls (billable,
// authorized this session), against the real seeded 'demo' college /
// CSE-A data. Isolates the reasoning-model variable specifically:
// aiService.js's resolveReasoningConfig() is the ONLY thing this script
// mutates (config.experimentalReasoningModel) — Tool Search stays off
// (config.toolSearch.enabled=false throughout, untouched
// aiToolSearchService/aiToolRetrievalService), the hybrid catalogue is
// held constant as the baseline (config.experimentalCatalogueVariant=
// 'hybrid' throughout, untouched hybrid catalogue rules), run_workflow_
// plan/Policy Gate/RLS/business handlers are all the real, unmodified
// code paths.
//
// Multimodal NOT tested here — vertex_maas.supportsVision is false, so
// GLM-5.2/Kimi K2 Thinking never receive images; a real, disclosed
// limitation of the existing adapter interface, not redesigned in this
// script per this session's explicit instruction.
//
// Token/latency numbers come from real ai_llm_call audit rows (same
// mechanism used throughout this session — Vertex's own reported
// usage, output tokens already include any reasoning/thinking tokens a
// provider bills as completion_tokens, never hidden separately).
//
// Scope actually run this pass (disclosed, not silently trimmed):
// Tests 1-3 at 3 reps each (the core comparable set), plus ambiguous
// and permission-restricted at 1 rep each (binary pass/fail checks,
// less variance-sensitive than multi-tool coverage). Write-operation
// and internal-vs-external categories were NOT run this pass — noted
// as a real scope gap in the final report, not silently omitted.
//
// Run (inside the app container):
//   node scripts/reasoning-model-benchmark.js

const { Pool } = require('pg');
const config = require('../src/config');
const aiService = require('../src/services/aiService');
const aiToolRegistry = require('../src/services/aiToolRegistry');

const PRINCIPAL_USER_ID = '32b4721e-e58a-4aa1-9c7d-81d5865be9b2';
const STAFF_USER_ID = '076885d8-61c3-4fd3-ba1a-99cd587bd51b'; // real seeded 'staff.ece', role=staff
const COLLEGE_ID = 'demo';
const CORE_REPETITIONS = 3;

const MODELS = [
  { key: 'gemini', reasoningModel: null },
  { key: 'glm-5.2', reasoningModel: 'zai-org/glm-5.2-maas' },
  { key: 'kimi-k2-thinking', reasoningModel: 'moonshotai/kimi-k2-thinking-maas' },
];

// Exact wording, same as every prior benchmark this session.
const CORE_TESTS = [
  {
    label: 'Test1',
    question: '3rd Sem CSE-A attendance percentage enna?',
    expectedTools: ['attendance_summary'],
    reps: CORE_REPETITIONS,
  },
  {
    label: 'Test2',
    question: 'low attendance students matrum fee status kudu',
    expectedTools: ['students_low_attendance', 'finance_status_summary'],
    reps: CORE_REPETITIONS,
  },
  {
    label: 'Test3',
    question: 'low attendance, fee pending, attendance summary moonrayum kudu',
    expectedTools: ['students_low_attendance', 'finance_status_summary', 'attendance_summary'],
    reps: CORE_REPETITIONS,
  },
];

// Real existing ambiguous-question test case, reused verbatim from
// ai-service.test.js ("the tool-selection call's system prompt
// instructs the model to ask for clarification rather than guess a
// tool on an ambiguous question") — not invented for this benchmark.
const AMBIGUOUS_TEST = {
  label: 'Ambiguous',
  question: 'help me with the thing',
  expectedTools: [],
  identity: 'principal',
  reps: 1,
};

// finance_status_summary is allowedRoles: ['principal'] only (checked
// live against the real registry this session) — 'staff' never even
// sees this tool in its role-filtered catalogue, so the real question
// this tests is whether a candidate model still answers sensibly (no
// hallucinated tool call) when the thing the user is asking about
// simply isn't in its offered tool set.
const PERMISSION_TEST = {
  label: 'PermissionRestricted',
  question: 'fee status full ah kudu',
  expectedTools: [],
  identity: 'staff',
  reps: 1,
};

function identityFor(kind) {
  if (kind === 'staff') return { userId: STAFF_USER_ID, role: 'staff', collegeId: COLLEGE_ID };
  return { userId: PRINCIPAL_USER_ID, role: 'principal', collegeId: COLLEGE_ID };
}

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

async function fetchLlmCallRows(appPool, identityContext, sinceIso) {
  return withTenantClient(appPool, COLLEGE_ID, async (client) => {
    const { rows } = await client.query(
      `SELECT metadata, created_at FROM audit_log
       WHERE action = 'ai_llm_call' AND college_id = $1 AND user_id = $2 AND created_at >= $3
       ORDER BY created_at ASC`,
      [COLLEGE_ID, identityContext.userId, sinceIso],
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
  const start = Date.now();
  try {
    result = await withTenantClient(appPool, COLLEGE_ID, (client) =>
      aiService.askAgent(client, question, { identityContext }),
    );
  } catch (err) {
    threw = err;
  } finally {
    aiToolRegistry.invokeTool = realInvokeTool;
  }
  const wallClockMs = Date.now() - start;
  const llmCalls = await fetchLlmCallRows(appPool, identityContext, since.toISOString());
  return {
    result,
    threw,
    llmCalls,
    invocationLog,
    wallClockMs,
    usedPlan: Boolean(result && result.plan),
    pendingConfirmation: Boolean(result && result.pendingConfirmation),
  };
}

function summarizeAccuracy(expectedTools, invoked) {
  const expected = new Set(expectedTools);
  const actual = new Set(invoked);
  const recallHits = [...expected].filter((t) => actual.has(t)).length;
  const truePositives = [...actual].filter((t) => expected.has(t)).length;
  return {
    recall: expected.size === 0 ? (actual.size === 0 ? 1 : 0) : recallHits / expected.size,
    precision: actual.size === 0 ? 1 : truePositives / actual.size,
    fullCoverage: expected.size === 0 ? actual.size === 0 : recallHits === expected.size,
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
const INTER_TURN_DELAY_MS = 4500;
const MAX_RETRIES = 2;
const RETRYABLE_RE = /429|RESOURCE_EXHAUSTED|exceeded its overall time budget/;

async function runModelOnTest(appPool, model, test) {
  config.experimentalReasoningModel = model.reasoningModel;
  config.experimentalCatalogueVariant = 'hybrid';
  config.toolSearch.enabled = false;
  const identityContext = identityFor(test.identity || 'principal');

  const reps = [];
  for (let i = 0; i < test.reps; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(INTER_TURN_DELAY_MS);
    let turn;
    let retries = 0;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      turn = await runOneTurn(appPool, identityContext, test.question);
      if (!turn.threw || !RETRYABLE_RE.test(turn.threw.message)) break;
      retries += 1;
      console.log(`    (retryable failure: ${turn.threw.message.slice(0, 80)} — retry ${attempt + 1}/${MAX_RETRIES})`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(INTER_TURN_DELAY_MS * 2);
    }
    turn.retries = retries;
    reps.push(turn);
  }
  return reps;
}

function classifyFailure(err) {
  if (!err) return null;
  const m = err.message || '';
  if (/429|RESOURCE_EXHAUSTED/.test(m)) return 'rate_limit';
  if (/exceeded its overall time budget/.test(m)) return 'timeout';
  if (/did not contain choices|malformed|not valid JSON/i.test(m)) return 'malformed_response';
  if (err.name && /NotFound|AiToolNotFound/.test(err.name)) return 'invalid_tool_call';
  return `other:${err.name || 'Error'}`;
}

function reportRep(rep, index) {
  if (rep.threw) {
    const failureType = classifyFailure(rep.threw);
    console.log(
      `  rep ${index + 1}: THREW [${failureType}] ${rep.threw.name}: ${rep.threw.message.slice(0, 150)} (retries=${rep.retries})`,
    );
    return { failed: true, failureType };
  }
  const { llmCalls } = rep;
  const decisionIn = sumBy(llmCalls, ['tool_select', 'tool_select_continue'], 'inputTokens');
  const decisionOut = sumBy(llmCalls, ['tool_select', 'tool_select_continue'], 'outputTokens');
  const synthesisIn = sumBy(llmCalls, ['tool_answer', 'plan_synthesis'], 'inputTokens');
  const synthesisOut = sumBy(llmCalls, ['tool_answer', 'plan_synthesis'], 'outputTokens');
  const totalCalls = llmCalls.length;
  const totalLatency = llmCalls.reduce((s, r) => s + (r.latencyMs || 0), 0);
  console.log(
    `  rep ${index + 1}: calls=${totalCalls} decision(in=${decisionIn},out=${decisionOut}) ` +
      `synthesis(in=${synthesisIn},out=${synthesisOut}) llmLatencyMs=${totalLatency} wallClockMs=${rep.wallClockMs} ` +
      `usedPlan=${rep.usedPlan} pendingConfirmation=${rep.pendingConfirmation}`,
  );
  console.log(`           invoked=${JSON.stringify(rep.invocationLog)}`);
  return {
    failed: false,
    decisionIn,
    decisionOut,
    synthesisIn,
    synthesisOut,
    totalCalls,
    totalLatency,
    wallClockMs: rep.wallClockMs,
    usedPlan: rep.usedPlan,
  };
}

function avg(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function main() {
  const originalReasoningModel = config.experimentalReasoningModel;
  const originalCatalogueVariant = config.experimentalCatalogueVariant;
  const originalToolSearchEnabled = config.toolSearch.enabled;

  const appPool = new Pool({ connectionString: config.databaseUrl });
  const allSummaries = [];

  try {
    const ALL_TESTS = [...CORE_TESTS, AMBIGUOUS_TEST, PERMISSION_TEST];
    for (const test of ALL_TESTS) {
      console.log(
        `\n\n########## ${test.label}: "${test.question}" (identity=${test.identity || 'principal'}, reps=${test.reps}) ##########`,
      );
      console.log(`expected tools: ${JSON.stringify(test.expectedTools)}`);

      for (const model of MODELS) {
        console.log(
          `\n--- model: ${model.key} (experimentalReasoningModel=${JSON.stringify(model.reasoningModel)}) ---`,
        );
        // eslint-disable-next-line no-await-in-loop
        const reps = await runModelOnTest(appPool, model, test);
        const reported = reps.map((rep, i) => reportRep(rep, i));
        const okReports = reported.filter((r) => !r.failed);
        const failures = reported.filter((r) => r.failed);
        const accuracyPerRep = reps
          .filter((r) => !r.threw)
          .map((r) => summarizeAccuracy(test.expectedTools, r.invocationLog));

        const summary = {
          test: test.label,
          model: model.key,
          repsOk: okReports.length,
          repsFailed: failures.length,
          failureTypes: failures.map((f) => f.failureType),
          avgDecisionIn: avg(okReports.map((m) => m.decisionIn)),
          avgDecisionOut: avg(okReports.map((m) => m.decisionOut)),
          avgSynthesisIn: avg(okReports.map((m) => m.synthesisIn)),
          avgSynthesisOut: avg(okReports.map((m) => m.synthesisOut)),
          avgTotalCalls: avg(okReports.map((m) => m.totalCalls)),
          avgLlmLatencyMs: avg(okReports.map((m) => m.totalLatency)),
          medianWallClockMs: median(okReports.map((m) => m.wallClockMs)),
          slowestWallClockMs: okReports.length ? Math.max(...okReports.map((m) => m.wallClockMs)) : 0,
          planUsageRate: okReports.length ? okReports.filter((m) => m.usedPlan).length / okReports.length : 0,
          fullCoverageRate: accuracyPerRep.length
            ? accuracyPerRep.filter((a) => a.fullCoverage).length / accuracyPerRep.length
            : 0,
          avgRecall: avg(accuracyPerRep.map((a) => a.recall)),
          avgPrecision: avg(accuracyPerRep.map((a) => a.precision)),
        };
        summary.grandTotalTokens =
          summary.avgDecisionIn + summary.avgDecisionOut + summary.avgSynthesisIn + summary.avgSynthesisOut;
        allSummaries.push(summary);
        console.log(`  SUMMARY: ${JSON.stringify(summary, null, 2)}`);
      }
    }

    console.log('\n\n========== FINAL COMPARISON (per test) ==========');
    console.log(
      'test | model | grandTotal tok | avgCalls | medianWallMs | slowestMs | planUse | fullCoverage | recall | precision | failed/total',
    );
    allSummaries.forEach((s) => {
      const total = s.repsOk + s.repsFailed;
      console.log(
        `${s.test.padEnd(6)}| ${s.model.padEnd(17)}| ${s.grandTotalTokens.toFixed(0).padEnd(15)}| ${s.avgTotalCalls.toFixed(1).padEnd(9)}| ` +
          `${s.medianWallClockMs.toFixed(0).padEnd(13)}| ${s.slowestWallClockMs.toFixed(0).padEnd(10)}| ${(s.planUsageRate * 100).toFixed(0)}%`.padEnd(
            9,
          ) +
          `| ${(s.fullCoverageRate * 100).toFixed(0)}%`.padEnd(13) +
          `| ${s.avgRecall.toFixed(2)}   | ${s.avgPrecision.toFixed(2)}     | ${s.repsFailed}/${total}`,
      );
      if (s.failureTypes.length) console.log(`       failures: ${JSON.stringify(s.failureTypes)}`);
    });

    console.log('\n========== per-model rollup across CORE tests (Test1-3 only) ==========');
    MODELS.forEach((model) => {
      const rows = allSummaries.filter((s) => s.model === model.key && CORE_TESTS.some((t) => t.label === s.test));
      const totalReps = rows.reduce((s, r) => s + r.repsOk + r.repsFailed, 0);
      const totalFailed = rows.reduce((s, r) => s + r.repsFailed, 0);
      console.log(
        `${model.key}: avgGrandTotal=${avg(rows.map((r) => r.grandTotalTokens)).toFixed(0)} tok, ` +
          `avgFullCoverage=${(avg(rows.map((r) => r.fullCoverageRate)) * 100).toFixed(0)}%, ` +
          `avgRecall=${avg(rows.map((r) => r.avgRecall)).toFixed(2)}, ` +
          `medianWallMs=${avg(rows.map((r) => r.medianWallClockMs)).toFixed(0)}, ` +
          `failures=${totalFailed}/${totalReps}`,
      );
    });
  } finally {
    config.experimentalReasoningModel = originalReasoningModel;
    config.experimentalCatalogueVariant = originalCatalogueVariant;
    config.toolSearch.enabled = originalToolSearchEnabled;
    await appPool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
