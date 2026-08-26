// F15 live retest, cap 2 (bka/90-appendix/consumer-adaptation-flags.md).
//
// The first live session (f12-live-tool-probe.js) found the model spend
// its only tool call (cap 1) on list_skills and then tell the user it
// had no data, despite the document being attached. Two fixes landed:
// (1) list_skills/describe_skill/decide_output_format/decide_image_route/
// describe_diagram_constraints/capability_search are now exempt from the
// tool-call BUDGET (they still run, still audit, still count toward
// toolsUsed — see BUDGET_EXEMPT_LOOKUP_TOOLS in aiService.js), so a
// lookup no longer eats the turn's only real tool call. (2) This script
// additionally raises the OBSERVATION-only cap to 2, matching the exact
// "observation only, item 3 territory" pattern
// identity-pattern-live-turn.js already established — NOT a change to
// config.js's own default, which stays 1 pending its own design pass.
//
// Exemption alone gets the model to list_skills THEN
// analyze_document_table (2 real tool uses, only 1 of which is
// budgeted) — but building the actual xlsx needs a THIRD budgeted call
// (execute_code, fed the analyze_document_table result). This script
// measures whether cap 2 is enough, or whether the honest answer is
// "still not in one turn even after the exemption."
//
// Prerequisites: run inside the app container (docker compose exec
// app node scripts/f15-cap2-live-retest.js) — same as
// f12-live-tool-probe.js, reuses the local sandbox wiring from F2.
// Makes real, billable Gemini calls.

'use strict';

const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const security = require('../src/security');
const config = require('../src/config');
const aiService = require('../src/services/aiService');
const documentService = require('../src/services/documentService');
const embeddingService = require('../src/services/embeddingService');
const { seedPrincipalPosition, cleanupPositionRows } = require('../tests/helpers/positionFixtures');

embeddingService.isAvailable = () => false;

const RESULT_SHEET = path.join(__dirname, '..', 'tmp-inspect.pdf');
const PASSWORD = 'F15Cap2LiveRetestPass123!';
const QUESTION = 'Can you give me an Excel file breaking down the arrears in the ECE Sandwich section, with a formula-based total?';

async function seedTenant(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeId = `f15${suffix}`;
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain, address) VALUES ($1, $1, $2, $3)',
    [collegeId, `f15tenant${suffix}`, 'f15-cap2-retest-address'],
  );
  const passwordHash = await security.hashPassword(PASSWORD);
  const userResult = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'principaluser', 'principaluser@example.com', $2, 'principal', true) RETURNING id`,
    [collegeId, passwordHash],
  );
  const userId = userResult.rows[0].id;
  await adminPool.query(
    "INSERT INTO staff (college_id, user_id, full_name) VALUES ($1, $2, 'F15 Cap2 Retest Principal')",
    [collegeId, userId],
  );
  await seedPrincipalPosition(adminPool, { collegeId, userId });
  return { collegeId, userId };
}

async function cleanupTenant(adminPool, collegeId) {
  await adminPool.query('DELETE FROM platform_college_stats WHERE college_id = $1', [collegeId]).catch(() => {});
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

async function main() {
  if (!fs.existsSync(RESULT_SHEET)) {
    console.error(`Missing ${RESULT_SHEET} — copy the result-sheet PDF to backend/tmp-inspect.pdf first (not in git, real PII).`);
    process.exit(2);
  }

  const adminPool = new Pool({ connectionString: config.migrationDatabaseUrl });
  const appPool = new Pool({ connectionString: config.databaseUrl });
  const { collegeId, userId } = await seedTenant(adminPool);
  const identityContext = { userId, role: 'principal', collegeId };

  const originalCap = config.maxToolCallsPerTurn;
  config.maxToolCallsPerTurn = 2; // OBSERVATION ONLY — not config.js's own default.

  try {
    const attachment = await withTenantClient(appPool, collegeId, (client) => documentService.uploadChatAttachment(
      client,
      {
        collegeId, fileName: '111_cons_result_apr2026.pdf', mimeType: 'application/pdf', fileBuffer: fs.readFileSync(RESULT_SHEET),
      },
      { actorUserId: userId },
    ));
    const attachmentId = attachment.id || (attachment.document && attachment.document.id);
    console.log(`Seeded tenant ${collegeId}, attachment ${attachmentId}, maxToolCallsPerTurn=${config.maxToolCallsPerTurn}`);
    console.log(`Q: ${QUESTION}`);

    let turn;
    try {
      turn = await withTenantClient(appPool, collegeId, (client) => aiService.askAgent(
        client, QUESTION, { identityContext, attachmentIds: [attachmentId] },
      ));
    } catch (err) {
      turn = { error: err };
    }

    if (turn.error) {
      console.log(`THREW ${turn.error.name}: ${turn.error.message}`);
    } else {
      console.log(`toolsUsed: ${JSON.stringify(turn.toolsUsed || turn.toolUsed)}`);
      console.log(`documentCoverageIncomplete: ${turn.documentCoverageIncomplete}`);
      console.log(`answer (first 800 chars): ${(turn.answer || '').slice(0, 800)}`);
    }
  } finally {
    config.maxToolCallsPerTurn = originalCap;
    await cleanupTenant(adminPool, collegeId).catch((err) => console.error('cleanup failed:', err.message));
    await appPool.end();
    await adminPool.end();
  }
}

main().catch((err) => {
  console.error('FATAL:', err.stack);
  process.exit(1);
});
