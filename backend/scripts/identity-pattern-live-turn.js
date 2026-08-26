'use strict';

// ADL-057 open-risk live check — can the MODEL write a usable
// identityPattern?
//
// The identityPattern design (the §15 decision) rests on an assumption the
// slice's own probe called into question: writing a good pattern by hand
// took three attempts, and the naive version returned "Apr" for every row
// (from the date "1-Apr-25") while still looking like a pass.
// `rowsWithoutIdentity` catches a pattern that matches NOTHING; it does not
// catch one that matches the WRONG thing.
//
// This script does not rig the answer. It asks the natural question and
// RECORDS what the model chose:
//   - did it pick operation 'compare' at all?
//   - did it supply identityPattern, or take identity_required?
//   - are the identities it produced actually distinguishing?
//
// analyzeAttachment is WRAPPED, not stubbed — the real path runs; the
// wrapper only records the params it was called with.
//
// Prerequisites: docker compose up -d db; gcloud auth application-default
// login; source .env.local.sh. Makes real, billable Gemini calls.
//
// Run (from backend/):
//   set -a && . ./.env.local.sh && set +a && node scripts/identity-pattern-live-turn.js

const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const security = require('../src/security');
const config = require('../src/config');
const aiService = require('../src/services/aiService');
const documentService = require('../src/services/documentService');
const documentAnalysisService = require('../src/services/documentAnalysisService');
const embeddingService = require('../src/services/embeddingService');
const { seedPrincipalPosition, cleanupPositionRows } = require('../tests/helpers/positionFixtures');

embeddingService.isAvailable = () => false;

const DOWNLOADS = 'C:\\Users\\HAI\\Downloads';
const DAYBOOK = path.join(DOWNLOADS, 'APRDAYBOOK.pdf');
const PASSWORD = 'IdentityPatternLivePass123!';

const QUESTION = 'In the attached day book, which entries are below 5000? List them with the party name.';

async function seedTenant(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeId = `idp${suffix}`;
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain, address) VALUES ($1, $1, $2, $3)',
    [collegeId, `idptenant${suffix}`, 'identity-pattern-live-address'],
  );
  const passwordHash = await security.hashPassword(PASSWORD);
  const userResult = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'principaluser', 'principaluser@example.com', $2, 'principal', true) RETURNING id`,
    [collegeId, passwordHash],
  );
  const userId = userResult.rows[0].id;
  await adminPool.query(
    "INSERT INTO staff (college_id, user_id, full_name) VALUES ($1, $2, 'Identity Pattern Live Principal')",
    [collegeId, userId],
  );
  await seedPrincipalPosition(adminPool, { collegeId, userId });
  return { collegeId, userId };
}

async function cleanupTenant(adminPool, collegeId) {
  await adminPool.query('DELETE FROM artifacts WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM documents WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM notifications WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [collegeId]);
  await cleanupPositionRows(adminPool, collegeId);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [collegeId]);
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

// Judged the same way the probe judges its own pattern: a non-null
// identity is not the same as a useful one, and the degenerate failure is
// one constant repeated across every row.
function judgeIdentities(result) {
  if (!result || result.status !== 'ok' || !Array.isArray(result.sample)) return null;
  const named = result.sample.filter((r) => r.identity);
  const distinct = new Set(named.map((r) => r.identity));
  return {
    rows: result.sample.length,
    named: named.length,
    distinct: distinct.size,
    examples: [...distinct].slice(0, 5),
  };
}

async function runTurn(appPool, collegeId, identityContext, attachmentId, cap, calls) {
  const original = config.maxToolCallsPerTurn;
  config.maxToolCallsPerTurn = cap;
  calls.length = 0;
  try {
    return await withTenantClient(appPool, collegeId, (client) => aiService.askAgent(
      client, QUESTION, { identityContext, attachmentIds: [attachmentId] },
    ));
  } catch (err) {
    return { error: err };
  } finally {
    config.maxToolCallsPerTurn = original;
  }
}

function reportTurn(label, turn, calls) {
  console.log(`\n=== ${label} ===`);
  if (turn.error) {
    console.log(`THREW ${turn.error.name}: ${turn.error.message}`);
    return;
  }
  console.log(`toolsUsed: ${JSON.stringify(turn.toolsUsed || turn.toolUsed)}`);
  if (calls.length === 0) {
    console.log('The model never called analyze_document_table.');
  }
  calls.forEach((call, i) => {
    console.log(`  call ${i + 1}:`);
    console.log(`    operation      : ${JSON.stringify(call.params.operation)}`);
    console.log(`    filter.pattern : ${JSON.stringify(call.params.filter && call.params.filter.pattern)}`);
    console.log(`    comparison     : ${JSON.stringify(call.params.comparison)}`);
    console.log(`    identityPattern: ${JSON.stringify(call.params.identityPattern)}`);
    console.log(`    -> status      : ${call.result && call.result.status}`);
    const judged = judgeIdentities(call.result);
    if (judged) {
      console.log(`    -> matched ${call.result.matchedCount} of ${call.result.scopedCount}, total ${call.result.total}`);
      console.log(`    -> identities: ${judged.named}/${judged.rows} named, ${judged.distinct} distinct`);
      console.log(`    -> examples  : ${JSON.stringify(judged.examples)}`);
    }
  });
  console.log(`answer: ${(turn.answer || '').slice(0, 600)}`);
}

async function main() {
  if (!fs.existsSync(DAYBOOK)) {
    console.error(`Missing ${DAYBOOK} — deliberately not in git (real PII).`);
    process.exit(2);
  }

  const adminPool = new Pool({ connectionString: config.migrationDatabaseUrl });
  const appPool = new Pool({ connectionString: config.databaseUrl });
  const { collegeId, userId } = await seedTenant(adminPool);
  const identityContext = { userId, role: 'principal', collegeId };

  // Observation, not substitution: the real implementation still runs.
  const calls = [];
  const realAnalyze = documentAnalysisService.analyzeAttachment;
  documentAnalysisService.analyzeAttachment = async (client, params, actor) => {
    const result = await realAnalyze(client, params, actor);
    calls.push({ params, result });
    return result;
  };

  try {
    const attachment = await withTenantClient(appPool, collegeId, (client) => documentService.uploadChatAttachment(
      client,
      {
        collegeId, fileName: 'APRDAYBOOK.pdf', mimeType: 'application/pdf', fileBuffer: fs.readFileSync(DAYBOOK),
      },
      { actorUserId: userId },
    ));
    const attachmentId = attachment.id || (attachment.document && attachment.document.id);
    console.log(`Seeded tenant ${collegeId}, attachment ${attachmentId}`);
    console.log(`Question: ${QUESTION}`);

    // Turn A — the real default. One tool call, no chance to retry.
    const turnA = await runTurn(appPool, collegeId, identityContext, attachmentId, 1, calls);
    reportTurn('Turn A — maxToolCallsPerTurn = 1 (production default)', turnA, calls.slice());

    // Turn B — cap raised for OBSERVATION only, the way
    // ai-behavioral-suite.js scopes its own category K. This is not a
    // change to the product: it answers whether identity_required is
    // recoverable at all once queued item 3 raises the cap.
    const turnB = await runTurn(appPool, collegeId, identityContext, attachmentId, 3, calls);
    reportTurn('Turn B — maxToolCallsPerTurn = 3 (observation only, item 3 territory)', turnB, calls.slice());
  } finally {
    documentAnalysisService.analyzeAttachment = realAnalyze;
    await cleanupTenant(adminPool, collegeId).catch((err) => console.error('cleanup failed:', err.message));
    await appPool.end();
    await adminPool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
