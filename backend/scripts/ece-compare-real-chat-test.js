'use strict';

// Ad-hoc real product test (not part of Priority 3's formal validation
// harness) — user asked ARCNAVE's real AI chat, via a real uploaded
// document, to compare ECE vs ECE(Sandwich) results and produce Excel
// + PDF reports. Runs with the hybrid catalogue candidate engaged
// (config.experimentalCatalogueVariant='hybrid'), Gemini reasoning,
// Tool Search off — same isolated-variable discipline as every other
// script this session. This is a REAL commit (not rolled back) since
// the user wants the generated report artifacts to actually exist
// afterward.

const fs = require('fs');
const { Pool } = require('pg');
const config = require('../src/config');
const aiService = require('../src/services/aiService');
const documentService = require('../src/services/documentService');
const aiToolRegistry = require('../src/services/aiToolRegistry');

const SOURCE_PDF = '/tmp/ece-compare-source.pdf';

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

  const invocationLog = [];
  const realInvoke = aiToolRegistry.invokeTool;
  aiToolRegistry.invokeTool = async (name, opts) => {
    const start = Date.now();
    try {
      const r = await realInvoke(name, opts);
      invocationLog.push({
        name,
        ok: true,
        ms: Date.now() - start,
      });
      return r;
    } catch (err) {
      invocationLog.push({
        name,
        ok: false,
        ms: Date.now() - start,
        error: err.message,
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
    const attachment = await documentService.uploadChatAttachment(
      client,
      {
        collegeId: 'demo',
        fileName: '111_cons_result_apr2026.pdf',
        mimeType: 'application/pdf',
        fileBuffer: fs.readFileSync(SOURCE_PDF),
      },
      { actorUserId: identityContext.userId },
    );
    const attachmentId = attachment.id || (attachment.document && attachment.document.id);
    console.log('attachmentId:', attachmentId);
    result = await aiService.askAgent(client, 'ECE SW and ECE result ah compare pani, Excel and PDF la report kudu', {
      identityContext,
      attachmentIds: [attachmentId],
    });
    await client.query('COMMIT');
  } catch (err) {
    threw = err;
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    client.release();
    aiToolRegistry.invokeTool = realInvoke;
    config.experimentalCatalogueVariant = null;
  }
  console.log('wallMs:', Date.now() - start);
  console.log('invoked:', JSON.stringify(invocationLog, null, 2));
  if (threw) {
    console.log('THREW:', threw.name, threw.message);
    console.log(threw.stack);
  } else {
    console.log('FULL RESULT:', JSON.stringify(result, null, 2));
  }
  await appPool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
