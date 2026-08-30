'use strict';

// Live, real-call test (user-requested this session) — a real, unrelated
// business PDF (a transport company's cement-ledger statement, TN02T0478,
// 1020 entries across 24 categories, GST breakdowns) attached to real
// askAgent turns, to see:
//   1. whether the right tool gets picked (or none, for Research mode)
//      for a document that has NOTHING to do with ARCNAVE's actual
//      campus-management domain — a genuine tool-confusion stress test;
//   2. real end-to-end token cost, per LLM call, for both a plain
//      "read it back" question and a real cross-category computation;
//   3. whether execute_code (sandbox) gets used, and whether it's even
//      configured in this environment;
//   4. whether Curriculum and Research mode reach the same/consistent
//      answer for the SAME question against the SAME document.
//
// documentService.downloadDocument is monkey-patched to return the real
// PDF bytes (no real DocumentService upload/S3 flow needed) — everything
// AFTER that point (text extraction, tool selection, tool execution,
// synthesis) is the real, unmodified pipeline, same technique
// tool-search-benchmark.js already uses for invokeTool interception.

const { Pool } = require('pg');
const config = require('../src/config');
const aiService = require('../src/services/aiService');
const aiToolRegistry = require('../src/services/aiToolRegistry');
const documentService = require('../src/services/documentService');

const PRINCIPAL_USER_ID = '32b4721e-e58a-4aa1-9c7d-81d5865be9b2';
const COLLEGE_ID = 'demo';
const PDF_PATH = `${__dirname}/../tmp-test-fixture.pdf`;

const QUESTIONS = [
  {
    label: 'Q1 (extraction/output)',
    text: "I've attached my transport ledger statement (TN02T0478). Can you list out every transaction category "
      + 'in it along with how many entries each category has?',
  },
  {
    // Deliberately phrased with "fee statement"/"credit and debit" —
    // finance-adjacent wording that overlaps with ARCNAVE's own campus
    // finance_status_summary tool's vocabulary, to see whether the model
    // wrongly reaches for that campus tool instead of correctly treating
    // this as a generic attached document with no campus record behind it.
    label: 'Q2 (analysis, deliberately finance-confusable wording)',
    text: 'Using the same fee statement I uploaded, what is the total IGST amount across all categories, and '
      + 'which single category contributed the most credit to that IGST total?',
  },
];

const VARIANTS = ['keywords', 'hybrid'];
const MODES = ['curriculum', 'general'];

async function withTenantClient(appPool, fn) {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [COLLEGE_ID]);
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
  return withTenantClient(appPool, async (client) => {
    const { rows } = await client.query(
      `SELECT metadata FROM audit_log
       WHERE action = 'ai_llm_call' AND college_id = $1 AND user_id = $2 AND created_at >= $3
       ORDER BY created_at ASC`,
      [COLLEGE_ID, PRINCIPAL_USER_ID, sinceIso],
    );
    return rows.map((r) => r.metadata);
  });
}

function sumTokens(rows) {
  return rows.reduce((acc, r) => {
    acc.input += r.inputTokens || 0;
    acc.output += r.outputTokens || 0;
    return acc;
  }, { input: 0, output: 0 });
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function runOneTurn(appPool, identityContext, question, mode) {
  const fs = require('fs');
  const pdfBuffer = fs.readFileSync(PDF_PATH);
  const realDownload = documentService.downloadDocument;
  documentService.downloadDocument = async () => ({
    document: {
      doc_type: documentService.CHAT_ATTACHMENT_DOC_TYPE,
      uploaded_by_user_id: identityContext.userId,
      mime_type: 'application/pdf',
      file_name: 'TN02T0478_Grouped_Statement.pdf',
    },
    buffer: pdfBuffer,
  });

  const invocationLog = [];
  const realInvokeTool = aiToolRegistry.invokeTool;
  aiToolRegistry.invokeTool = async (toolName, opts) => {
    const startedAt = Date.now();
    try {
      const result = await realInvokeTool(toolName, opts);
      invocationLog.push({ toolName, ok: true, latencyMs: Date.now() - startedAt });
      return result;
    } catch (err) {
      invocationLog.push({
        toolName, ok: false, error: err.message, latencyMs: Date.now() - startedAt,
      });
      throw err;
    }
  };

  const since = new Date();
  let result;
  let threw = null;
  try {
    result = await withTenantClient(appPool, (client) => aiService.askAgent(client, question, {
      identityContext, attachmentIds: ['fixture-1'], mode,
    }));
  } catch (err) {
    threw = err;
  } finally {
    documentService.downloadDocument = realDownload;
    aiToolRegistry.invokeTool = realInvokeTool;
  }

  const llmCalls = await fetchLlmCallRows(appPool, since.toISOString());
  return {
    result, threw, llmCalls, invocationLog,
  };
}

async function main() {
  const appPool = new Pool({ connectionString: config.databaseUrl });
  const identityContext = {
    userId: PRINCIPAL_USER_ID, role: 'principal', collegeId: COLLEGE_ID,
  };
  const originalVariant = config.experimentalCatalogueVariant;

  try {
    for (const variant of VARIANTS) {
      config.experimentalCatalogueVariant = variant;
      for (const q of QUESTIONS) {
        for (const mode of MODES) {
          console.log(`\n\n########## variant=${variant} | ${q.label} | mode=${mode} ##########`);
          console.log(`question: "${q.text}"`);
          // eslint-disable-next-line no-await-in-loop
          await sleep(3000);
          // eslint-disable-next-line no-await-in-loop
          const turn = await runOneTurn(appPool, identityContext, q.text, mode);
          if (turn.threw) {
            console.log(`THREW: ${turn.threw.name}: ${turn.threw.message}`);
            // eslint-disable-next-line no-continue
            continue;
          }
          const byPurpose = {};
          turn.llmCalls.forEach((r) => {
            byPurpose[r.purpose] = byPurpose[r.purpose] || { input: 0, output: 0, calls: 0 };
            byPurpose[r.purpose].input += r.inputTokens || 0;
            byPurpose[r.purpose].output += r.outputTokens || 0;
            byPurpose[r.purpose].calls += 1;
          });
          const total = sumTokens(turn.llmCalls);
          console.log('tools invoked:', JSON.stringify(turn.invocationLog));
          console.log('tokens by step:', JSON.stringify(byPurpose));
          console.log(`TOTAL tokens: in=${total.input} out=${total.output} sum=${total.input + total.output}`);
          console.log('toolUsed (primary):', turn.result.toolUsed);
          console.log('toolsUsed:', JSON.stringify(turn.result.toolsUsed || []));
          console.log('ANSWER:', turn.result.answer);
          if (turn.result.verification) console.log('verification:', JSON.stringify(turn.result.verification));
        }
      }
    }
  } finally {
    config.experimentalCatalogueVariant = originalVariant;
    await appPool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
