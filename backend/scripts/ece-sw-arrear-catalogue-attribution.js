'use strict';

// Attribution check: the arrear-list hallucination found in
// ece-sw-arrear-list-test.js ran with config.experimentalCatalogueVariant
// ='hybrid'. Before blaming the hybrid catalogue, isolate the variable —
// rerun the EXACT same question against the EXACT same document with
// the catalogue variant back at the production default (null/'current')
// and see whether the same fabrication happens. If it does, the bug is
// in analyze_document_table / the multimodal document path, not the
// catalogue. If it doesn't, the hybrid catalogue's shorter tool
// descriptions are implicated.

const { Pool } = require('pg');
const config = require('../src/config');
const aiService = require('../src/services/aiService');
const aiToolRegistry = require('../src/services/aiToolRegistry');

const ATTACHMENT_ID = 'd6e46725-401e-4192-834d-953a56fafcb6';

const QUESTION = 'Intha document-la Serial number 818 to 872 varaikum ECE Sandwich (SW) students-oda arrear list kudu. '
  + 'ABSENT nu irundhaalum, RA (Reappear) nu irundhaalum, rendume arrear-ஆ தான் consider pannu. '
  + 'Oru student multiple semesters-la arrear vechurundha, andha maadhiri ella semesters-layum irukra arrear subjects-um '
  + 'sேர்த்து ஒரே consolidated entry-ஆ andha student-ku kudu — next student name varaikum irukra ella semester rows-um '
  + 'antha student-oda thaan, adhை ellam onnu sேர்thu kudu.';

async function main() {
  config.experimentalCatalogueVariant = null; // production default — the ONLY thing different from the earlier run
  config.experimentalReasoningModel = null;
  config.toolSearch.enabled = false;

  const appPool = new Pool({ connectionString: config.databaseUrl });
  const identityContext = {
    userId: '32b4721e-e58a-4aa1-9c7d-81d5865be9b2', role: 'principal', collegeId: 'demo', departmentIds: [], departmentId: null, classIds: [], scopeLevel: 'college', positionAccountId: null,
  };

  const invocationLog = [];
  const realInvoke = aiToolRegistry.invokeTool;
  aiToolRegistry.invokeTool = async (name, opts) => {
    const start = Date.now();
    try {
      const r = await realInvoke(name, opts);
      invocationLog.push({ name, ok: true, ms: Date.now() - start });
      return r;
    } catch (err) {
      invocationLog.push({
        name, ok: false, ms: Date.now() - start, error: err.message,
      });
      throw err;
    }
  };

  const client = await appPool.connect();
  let result;
  let threw;
  const start = Date.now();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', 'demo', true)");
    result = await aiService.askAgent(client, QUESTION, { identityContext, attachmentIds: [ATTACHMENT_ID] });
    await client.query('COMMIT');
  } catch (err) {
    threw = err;
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    client.release();
    aiToolRegistry.invokeTool = realInvoke;
  }
  console.log('catalogueVariant used: current (production default, null)');
  console.log('wallMs:', Date.now() - start);
  console.log('invoked:', JSON.stringify(invocationLog, null, 2));
  if (threw) {
    console.log('THREW:', threw.name, threw.message);
  } else {
    console.log('toolUsed:', result.toolUsed);
    console.log('usage:', JSON.stringify(result.usage));
    console.log('ANSWER:\n', result.answer);
  }
  await appPool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
