// F12 live check — exercise more of the 18 new tools that have never
// been selected by a real model (bka/90-appendix/consumer-adaptation-flags.md
// #f12). Uses the real result-sheet PDF (111_cons_result_apr2026.pdf,
// the same 278,403-char/400-page/1603-record document every ADL-055
// measurement in this project is anchored to) as a real attachment,
// asking natural questions shaped to make the model reach for
// execute_code+saveAs (the xlsx gate, only unit/synthetic-tested so
// far), capability_search/capability_explain, and present_diagram
// (previously only tested with a deliberately-bad gradient fill).
//
// Does not rig tool selection — the model picks; this only records
// what it picked and whether the turn completed cleanly.
//
// Prerequisites: docker compose up -d db/app; real Gemini/Vertex
// credentials; SANDBOX_SERVICE_URL pointed at a reachable sandbox
// (local Docker or Cloud Run). Makes real, billable Gemini calls.
//
// Run (inside the app container):
//   node scripts/f12-live-tool-probe.js

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

// Run inside the app container (docker compose exec app ...), where the
// real Gemini ADC, DB, and SANDBOX_SERVICE_URL (host.docker.internal, see
// F2) are already wired — unlike the other scripts/*-live-turn.js probes,
// which run natively on the Windows host. The PDF is copied to backend/
// (bind-mounted into the container) rather than read from the host's
// Downloads path directly, since the container can't see the host
// filesystem outside that mount.
const RESULT_SHEET = path.join(__dirname, '..', 'tmp-inspect.pdf');
const PASSWORD = 'F12LiveToolProbePass123!';

const QUESTIONS = [
  'Can you give me an Excel file breaking down the arrears in the ECE Sandwich section, with a formula-based total?',
  'What can you help me with when it comes to student marks and attendance? List your real capabilities.',
  'Show me a diagram summarizing the arrears situation in the ECE Sandwich section.',
];

async function seedTenant(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeId = `f12${suffix}`;
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain, address) VALUES ($1, $1, $2, $3)', [
    collegeId,
    `f12tenant${suffix}`,
    'f12-live-probe-address',
  ]);
  const passwordHash = await security.hashPassword(PASSWORD);
  const userResult = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'principaluser', 'principaluser@example.com', $2, 'principal', true) RETURNING id`,
    [collegeId, passwordHash],
  );
  const userId = userResult.rows[0].id;
  await adminPool.query(
    "INSERT INTO staff (college_id, user_id, full_name) VALUES ($1, $2, 'F12 Live Probe Principal')",
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

function reportTurn(label, question, turn) {
  console.log(`\n=== ${label} ===`);
  console.log(`Q: ${question}`);
  if (turn.error) {
    console.log(`THREW ${turn.error.name}: ${turn.error.message}`);
    return;
  }
  console.log(`toolsUsed: ${JSON.stringify(turn.toolsUsed || turn.toolUsed)}`);
  console.log(`answer (first 500 chars): ${(turn.answer || '').slice(0, 500)}`);
}

async function main() {
  if (!fs.existsSync(RESULT_SHEET)) {
    console.error(`Missing ${RESULT_SHEET} — deliberately not in git (real student PII).`);
    process.exit(2);
  }

  const adminPool = new Pool({ connectionString: config.migrationDatabaseUrl });
  const appPool = new Pool({ connectionString: config.databaseUrl });
  const { collegeId, userId } = await seedTenant(adminPool);
  const identityContext = { userId, role: 'principal', collegeId };

  try {
    const attachment = await withTenantClient(appPool, collegeId, (client) =>
      documentService.uploadChatAttachment(
        client,
        {
          collegeId,
          fileName: '111_cons_result_apr2026.pdf',
          mimeType: 'application/pdf',
          fileBuffer: fs.readFileSync(RESULT_SHEET),
        },
        { actorUserId: userId },
      ),
    );
    const attachmentId = attachment.id || (attachment.document && attachment.document.id);
    console.log(`Seeded tenant ${collegeId}, attachment ${attachmentId}`);

    for (let i = 0; i < QUESTIONS.length; i += 1) {
      const question = QUESTIONS[i];
      // Q2 (capability question) deliberately has no attachment — it's not
      // a document question, and attaching one would just distract the
      // model's tool choice.
      const attachmentIds = i === 1 ? [] : [attachmentId];
      let turn;
      try {
        turn = await withTenantClient(appPool, collegeId, (client) =>
          aiService.askAgent(client, question, { identityContext, attachmentIds }),
        );
      } catch (err) {
        turn = { error: err };
      }
      reportTurn(`Turn ${i + 1}`, question, turn);
    }
  } finally {
    await cleanupTenant(adminPool, collegeId).catch((err) => console.error('cleanup failed:', err.message));
    await appPool.end();
    await adminPool.end();
  }
}

main().catch((err) => {
  console.error('FATAL:', err.stack);
  process.exit(1);
});
