'use strict';

// ADL-056 live check — the part invalid-pattern-probe.js cannot cover.
//
// The probe already proves, against real document bytes, that the analysis
// path PRODUCES { status: 'invalid_pattern', ... } instead of throwing.
// What that cannot show is what the surrounding /ai/ask TURN does with it:
// whether the turn completes, and whether the model narrates the status
// acceptably instead of blaming the user's file. That needs real Gemini
// calls, which is why it lives in its own manually-triggered script rather
// than in the test suite — same discipline as ai-behavioral-suite.js.
//
// Prerequisites (identical to ai-behavioral-suite.js):
//   1. docker compose up -d db, from the repo root
//   2. gcloud auth application-default login
//   3. source .env.local.sh
//
// Run (from backend/):
//   set -a && . ./.env.local.sh && set +a && node scripts/invalid-pattern-live-turn.js
//
// Uses the SMALL exam-fees PDF rather than the 278,403-char result sheet
// on purpose: pattern validation now runs BEFORE extraction, so the
// document's own size is irrelevant to what is being checked, and the
// smaller attachment keeps a real billable turn cheap.

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

// Same reasoning as ai-behavioral-suite.js: this script is about how the
// TURN handles a tool status, not about semantic tool retrieval.
embeddingService.isAvailable = () => false;

const DOWNLOADS = 'C:\\Users\\HAI\\Downloads';
const SAMPLE = path.join(DOWNLOADS, 'EXAM FEES ece(sw) III YR 7 SEM.pdf');
const PASSWORD = 'InvalidPatternLivePass123!';

const LIVE_BAD_SECTION_PATTERN = '(?i)ELECTRONICS AND COMMUNICATION ENGINEERING \\(SANDWICH\\)|2040';

// Phrases the shipped tool description explicitly forbids — the ADL-055
// addendum records a real defect where a refusal told the user to
// re-upload a clearer copy, which is both forbidden and false.
const BLAMES_THE_USER = [
  're-upload', 'reupload', 'clearer copy', 'upload a clearer', 'document is unclear',
  'file is corrupt', 'invalid document', 'problem with your file',
];

async function seedTenant(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeId = `inv${suffix}`;
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain, address) VALUES ($1, $1, $2, $3)',
    [collegeId, `invtenant${suffix}`, 'invalid-pattern-live-address'],
  );
  const passwordHash = await security.hashPassword(PASSWORD);
  const userResult = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'principaluser', 'principaluser@example.com', $2, 'principal', true) RETURNING id`,
    [collegeId, passwordHash],
  );
  const userId = userResult.rows[0].id;
  await adminPool.query(
    "INSERT INTO staff (college_id, user_id, full_name) VALUES ($1, $2, 'Invalid Pattern Live Principal')",
    [collegeId, userId],
  );
  await seedPrincipalPosition(adminPool, { collegeId, userId });
  return { collegeId, userId };
}

async function cleanupTenant(adminPool, collegeId) {
  // artifacts -> documents -> users, the order ai-behavioral-suite.js's
  // own comment records two live runs getting wrong in opposite ways.
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

function report(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  return ok;
}

async function main() {
  if (!fs.existsSync(SAMPLE)) {
    console.error(`Missing ${SAMPLE} — deliberately not in git (real student PII).`);
    process.exit(2);
  }

  const adminPool = new Pool({ connectionString: config.migrationDatabaseUrl });
  const appPool = new Pool({ connectionString: config.databaseUrl });
  const { collegeId, userId } = await seedTenant(adminPool);
  const identityContext = { userId, role: 'principal', collegeId };
  let failures = 0;

  try {
    const attachment = await withTenantClient(appPool, collegeId, (client) => documentService.uploadChatAttachment(
      client,
      {
        collegeId,
        fileName: 'EXAM FEES ece(sw) III YR 7 SEM.pdf',
        mimeType: 'application/pdf',
        fileBuffer: fs.readFileSync(SAMPLE),
      },
      { actorUserId: userId },
    ));
    const attachmentId = attachment.id || (attachment.document && attachment.document.id);
    console.log(`Seeded tenant ${collegeId}, attachment ${attachmentId}\n`);

    // --- Check 1: a genuinely live turn, model free to do as it likes.
    // The question NAMES the bad pattern, which is the only way to make a
    // nondeterministic model reproduce a nondeterministic bug on demand.
    // Whether it complies is itself the finding — reported either way,
    // never retried until it looks good.
    console.log('Check 1 — live turn, question names the bad pattern');
    let turn1;
    try {
      turn1 = await withTenantClient(appPool, collegeId, (client) => aiService.askAgent(
        client,
        'Analyse the attached document. Use analyze_document_table with sectionPattern set to exactly '
        + `${LIVE_BAD_SECTION_PATTERN} and filter pattern RA, operation count. Tell me what happens.`,
        { identityContext, attachmentIds: [attachmentId] },
      ));
      if (!report('the turn completed without throwing (no HTTP 500)', true)) failures += 1;
    } catch (err) {
      report('the turn completed without throwing (no HTTP 500)', false, `threw ${err.name}: ${err.message}`);
      failures += 1;
      turn1 = null;
    }
    if (turn1) {
      const answered = typeof turn1.answer === 'string' && turn1.answer.trim().length > 0;
      if (!report('the turn produced a non-empty answer', answered)) failures += 1;
      console.log(`      toolsUsed: ${JSON.stringify(turn1.toolsUsed || turn1.toolUsed)}`);
      console.log(`      answer: ${(turn1.answer || '').slice(0, 700)}`);
    }

    // --- Check 2: the narration itself, made deterministic.
    // Only the TOOL RESULT is stubbed, and it is stubbed to the exact
    // object the real path returns (verified against real bytes by
    // invalid-pattern-probe.js). Everything else — the decision call, the
    // tool-use loop, the answer call — is the real live pipeline. This
    // isolates the one thing check 1 cannot guarantee: that when the
    // status DOES occur, the model explains it and does not blame the
    // user's file.
    console.log('\nCheck 2 — narration of the status, tool result stubbed to the real object');
    const realStatus = {
      status: 'invalid_pattern',
      parameter: 'sectionPattern',
      reason: 'sectionPattern is not valid JavaScript regular expression syntax: '
        + `${JSON.stringify(LIVE_BAD_SECTION_PATTERN)}. JavaScript does not support inline flags such as (?i), `
        + 'and sectionPattern is already matched case-insensitively, so that flag is not needed here.',
    };
    const originalAnalyze = documentAnalysisService.analyzeAttachment;
    documentAnalysisService.analyzeAttachment = async () => realStatus;
    let turn2;
    try {
      turn2 = await withTenantClient(appPool, collegeId, (client) => aiService.askAgent(
        client,
        'How many arrears are there in the ECE Sandwich section of the attached document?',
        { identityContext, attachmentIds: [attachmentId] },
      ));
      if (!report('the turn completed without throwing', true)) failures += 1;
    } catch (err) {
      report('the turn completed without throwing', false, `threw ${err.name}: ${err.message}`);
      failures += 1;
      turn2 = null;
    } finally {
      documentAnalysisService.analyzeAttachment = originalAnalyze;
    }
    if (turn2) {
      const answer = turn2.answer || '';
      if (!report('the turn produced a non-empty answer', answer.trim().length > 0)) failures += 1;
      const blames = BLAMES_THE_USER.filter((p) => answer.toLowerCase().includes(p));
      if (!report('the answer does not blame the user\'s file', blames.length === 0, blames.join(', '))) failures += 1;
      console.log(`      toolsUsed: ${JSON.stringify(turn2.toolsUsed || turn2.toolUsed)}`);
      console.log(`      answer: ${answer.slice(0, 700)}`);
    }
  } finally {
    await cleanupTenant(adminPool, collegeId).catch((err) => console.error('cleanup failed:', err.message));
    await appPool.end();
    await adminPool.end();
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
