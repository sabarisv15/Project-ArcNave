'use strict';

// ADL-063 live check — required by the revised Approved Spec's Testing
// requirements before this slice is called done. Calls
// documentAnalysisService.analyzeAttachment DIRECTLY (the deterministic
// path, no LLM involved) against the real exam-fees PDF, through the real
// deployed sandbox — proving the fallback that pdfplumber-attribution-
// probe.js only proved in isolation now actually fires from inside the
// real analysis path and grants full trust (count AND sum both run, not
// just identity/count).
//
// Prerequisites: docker compose up -d db; source .env.local.sh (needs
// DATABASE_URL, MIGRATION_DATABASE_URL, SANDBOX_SERVICE_URL/TOKEN).
//
// Run (from backend/):
//   set -a && . ./.env.local.sh && set +a && node scripts/pdfplumber-fallback-live-check.js

const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const security = require('../src/security');
const config = require('../src/config');
const documentService = require('../src/services/documentService');
const documentAnalysisService = require('../src/services/documentAnalysisService');
const { seedPrincipalPosition, cleanupPositionRows } = require('../tests/helpers/positionFixtures');

const DOWNLOADS = 'C:\\Users\\HAI\\Downloads';
const SAMPLE = path.join(DOWNLOADS, 'EXAM FEES ece(sw) III YR 7 SEM.pdf');
const PASSWORD = 'PdfplumberFallbackLivePass123!';

async function seedTenant(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeId = `pfb${suffix}`;
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain, address) VALUES ($1, $1, $2, $3)',
    [collegeId, `pfbtenant${suffix}`, 'pdfplumber-fallback-live-address'],
  );
  const passwordHash = await security.hashPassword(PASSWORD);
  const userResult = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'principaluser', 'principaluser@example.com', $2, 'principal', true) RETURNING id`,
    [collegeId, passwordHash],
  );
  const userId = userResult.rows[0].id;
  await adminPool.query(
    "INSERT INTO staff (college_id, user_id, full_name) VALUES ($1, $2, 'Pdfplumber Fallback Live Principal')",
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

function report(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail !== undefined) console.log(`      ${detail}`);
  return ok;
}

async function main() {
  if (!fs.existsSync(SAMPLE)) {
    console.error(`Missing ${SAMPLE} — deliberately not in git (real student PII).`);
    process.exit(2);
  }
  if (!config.sandboxServiceUrl || !config.sandboxServiceToken) {
    console.error('SANDBOX_SERVICE_URL / SANDBOX_SERVICE_TOKEN must be set — this check needs the real sandbox.');
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

    console.log('Check 1 — count(DoB): the fallback fires, verifies, and grants full trust (not a refusal)');
    const counted = await withTenantClient(appPool, collegeId, (client) => documentAnalysisService.analyzeAttachment(
      client, { attachmentId, filter: { pattern: 'DoB' }, operation: 'count' }, identityContext,
    ));
    console.log(`      status=${counted.status} strategy=${counted.strategy} total=${counted.total} scopedCount=${counted.scopedCount}`);
    if (!report('status is ok, not a refusal', counted.status === 'ok', counted.status)) failures += 1;
    if (!report('strategy carries the _pdfplumber suffix', /_pdfplumber$/.test(counted.strategy || ''), counted.strategy)) failures += 1;
    if (!report('23 records recovered', counted.scopedCount === 23, counted.scopedCount)) failures += 1;
    if (!report('23 DoB markers counted (one per record)', counted.total === 23, counted.total)) failures += 1;

    console.log('\nCheck 2 — sum: a numeric operation beyond count also runs, not refused');
    const summed = await withTenantClient(appPool, collegeId, (client) => documentAnalysisService.analyzeAttachment(
      client, { attachmentId, filter: { pattern: '(\\d+)\\s*$' }, operation: 'sum' }, identityContext,
    ));
    console.log(`      status=${summed.status} strategy=${summed.strategy} total=${summed.total} scopedCount=${summed.scopedCount} matchedCount=${summed.matchedCount}`);
    if (!report('status is ok, not identity_required or a refusal', summed.status === 'ok', summed.status)) failures += 1;
    if (!report('sum produced a real positive total', typeof summed.total === 'number' && summed.total > 0, summed.total)) failures += 1;
  } finally {
    await cleanupTenant(adminPool, collegeId).catch((err) => console.error('cleanup failed:', err.message));
    await appPool.end();
    await adminPool.end();
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
