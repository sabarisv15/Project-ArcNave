'use strict';

// Live check: does the model actually choose run_workflow_plan for a
// compound question, and does a single-tool question stay single-tool?
// Requested directly by the user to verify tool-SELECTION behaviour with
// real Gemini calls against the real seeded 'demo' college data — not
// static code-reading. Nothing here is mocked except a thin observation
// wrapper around aiToolRegistry.invokeTool, purely to print which tool(s)
// actually ran; the real handler still executes.
//
// Prerequisites: docker compose up -d db; npm run migrate;
// db/seed-test-data.sql already loaded; source .env.local.sh.
// Makes real, billable Gemini calls (3 turns).
//
// Run (from backend/):
//   set -a && . ./.env.local.sh && set +a && node scripts/workflow-plan-tool-selection-probe.js

const { Pool } = require('pg');
const config = require('../src/config');
const aiService = require('../src/services/aiService');
const aiToolRegistry = require('../src/services/aiToolRegistry');

const PRINCIPAL_USER_ID = '32b4721e-e58a-4aa1-9c7d-81d5865be9b2';
const COLLEGE_ID = 'demo';
// Real seeded class name — the user's own questions said "CSE II"; the
// demo seed's actual class is "3rd Sem \xb7 CSE-A" (the one class with
// Approved timetable, real attendance sessions and real fee_payments
// rows). Substituted so the model has something real to resolve against
// rather than confounding "did it pick the right tool" with "did it find
// a class that doesn't exist."
const CLASS_NAME = '3rd Sem · CSE-A';

const QUESTIONS = [
  {
    label: 'Test 1 — Simple (single operation)',
    question: `${CLASS_NAME} attendance percentage enna?`,
  },
  {
    label: 'Test 2 — Two operations',
    question: `${CLASS_NAME} low attendance students matrum avanga fee status kudu.`,
  },
  {
    label: 'Test 3 — Three operations',
    question: `${CLASS_NAME} low attendance students, fee pending students, attendance summary moonrayum kudu.`,
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

async function main() {
  const appPool = new Pool({ connectionString: config.databaseUrl });
  const identityContext = { userId: PRINCIPAL_USER_ID, role: 'principal', collegeId: COLLEGE_ID };

  // Observation only — records which real tools actually got invoked and
  // in what order, per turn. The real invokeTool/handler/Business Service
  // path still runs unchanged.
  const invocationLog = [];
  const realInvokeTool = aiToolRegistry.invokeTool;
  // Real signature (confirmed against aiService.js:740):
  // aiToolRegistry.invokeTool(toolName, { client, identityContext, params })
  aiToolRegistry.invokeTool = async (toolName, opts) => {
    const result = await realInvokeTool(toolName, opts);
    invocationLog.push({ toolName, params: opts && opts.params });
    return result;
  };

  try {
    for (const { label, question } of QUESTIONS) {
      invocationLog.length = 0;
      console.log(`\n=== ${label} ===`);
      console.log(`Question: ${question}`);
      let result;
      try {
        // eslint-disable-next-line no-await-in-loop
        result = await withTenantClient(appPool, COLLEGE_ID, (client) =>
          aiService.askAgent(client, question, { identityContext }),
        );
      } catch (err) {
        console.log(`THREW ${err.name}: ${err.message}`);
        continue; // eslint-disable-line no-continue
      }

      console.log(`toolUsed (top-level decision.type): ${JSON.stringify(result.toolUsed)}`);
      if (result.plan) {
        console.log(`plan steps (executeWorkflowPlan's own record):`);
        result.plan.forEach((p, i) => console.log(`  ${i + 1}. ${p.toolName} (recordCount=${p.recordCount})`));
      }
      if (result.pendingConfirmation) {
        console.log(
          `PENDING CONFIRMATION (turn paused before executing): ${JSON.stringify(result.pendingConfirmation)}`,
        );
      }
      console.log(
        `Real tools invoked this turn (observed via invokeTool wrapper): ${invocationLog.length === 0 ? 'NONE' : ''}`,
      );
      invocationLog.forEach((c, i) => console.log(`  ${i + 1}. ${c.toolName} params=${JSON.stringify(c.params)}`));
      console.log(`answer: ${(result.answer || '').slice(0, 500)}`);
    }
  } finally {
    aiToolRegistry.invokeTool = realInvokeTool;
    await appPool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
