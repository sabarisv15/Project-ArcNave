'use strict';

// Root-cause isolation for the arrear-list fabrication found this
// session. analyze_document_table's own description claims it is fully
// deterministic ("the model never computes the count/sum/breakdown/
// filter itself — this tool does"). This script captures the RAW return
// value of documentAnalysisService.analyzeAttachment directly (before
// the separate synthesis LLM call reshapes it into prose/a table), to
// determine whether the fabrication already exists in the deterministic
// engine's own output, or is introduced afterward by the synthesis step
// reinterpreting correct raw data.

const { Pool } = require('pg');
const config = require('../src/config');
const aiService = require('../src/services/aiService');
const aiToolRegistry = require('../src/services/aiToolRegistry');

const ATTACHMENT_ID = 'd6e46725-401e-4192-834d-953a56fafcb6';

const QUESTION =
  'Intha document-la Serial number 818 to 872 varaikum ECE Sandwich (SW) students-oda arrear list kudu. ' +
  'ABSENT nu irundhaalum, RA (Reappear) nu irundhaalum, rendume arrear-ஆ தான் consider pannu. ' +
  'Oru student multiple semesters-la arrear vechurundha, andha maadhiri ella semesters-layum irukra arrear subjects-um ' +
  'sேர்த்து ஒரே consolidated entry-ஆ andha student-ku kudu — next student name varaikum irukra ella semester rows-um ' +
  'antha student-oda thaan, adhை ellam onnu sேர்thu kudu.';

async function main() {
  config.experimentalCatalogueVariant = 'hybrid';
  config.experimentalReasoningModel = null;
  config.toolSearch.enabled = false;

  const appPool = new Pool({ connectionString: config.databaseUrl });
  const identityContext = {
    userId: '32b4721e-e58a-4aa1-9c7d-81d5865be9b2',
    role: 'principal',
    collegeId: 'demo',
    departmentIds: [],
    departmentId: null,
    classIds: [],
    scopeLevel: 'college',
    positionAccountId: null,
  };

  const rawToolResults = [];
  const realInvoke = aiToolRegistry.invokeTool;
  aiToolRegistry.invokeTool = async (name, opts) => {
    const r = await realInvoke(name, opts);
    rawToolResults.push({ name, params: opts.params, result: r });
    return r;
  };

  const client = await appPool.connect();
  let result;
  let threw;
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', 'demo', true)");
    result = await aiService.askAgent(client, QUESTION, { identityContext, attachmentIds: [ATTACHMENT_ID] });
    await client.query('ROLLBACK'); // read-only check, no need to commit again
  } catch (err) {
    threw = err;
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    client.release();
    aiToolRegistry.invokeTool = realInvoke;
  }

  console.log("=== RAW TOOL CALL(S) — the deterministic engine's own output ===");
  console.log(JSON.stringify(rawToolResults, null, 2));
  if (threw) {
    console.log('THREW:', threw.name, threw.message);
  } else {
    console.log('\n=== FINAL SYNTHESIZED ANSWER ===');
    console.log(result.answer);
  }
  await appPool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
