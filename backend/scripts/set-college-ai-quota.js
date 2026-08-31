'use strict';

// Operator script — set a college's monthly AI token quota (the
// `configurations` row category 'ai_quota', {monthlyTokenQuota}). Used to
// widen a demo/test college's ceiling for a deliberate, time-boxed live
// measurement session and then restore it, per the pattern
// bka/70-checkpoint/CURRENT-STATE.md already documents ("temporarily
// raised ... and reverted both times"). Not wired into the app; a manual,
// audited maintenance action.
//
// Usage (inside the app container):
//   node scripts/set-college-ai-quota.js <collegeId> <monthlyTokenQuota>
//   node scripts/set-college-ai-quota.js demo 500000000      # widen
//   node scripts/set-college-ai-quota.js demo 2000000        # restore platform default

const { Pool } = require('pg');
const configurationService = require('../src/services/configurationService');

const OPERATOR_USER_ID = '32b4721e-e58a-4aa1-9c7d-81d5865be9b2'; // demo principal, for the audit row

async function main() {
  const [collegeId, quotaRaw] = process.argv.slice(2);
  const quota = Number(quotaRaw);
  if (!collegeId || !Number.isInteger(quota) || quota < 0) {
    throw new Error('usage: set-college-ai-quota.js <collegeId> <monthlyTokenQuota:int>=0>');
  }
  const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    const current = await configurationService.getConfiguration(client, { collegeId, category: 'ai_quota' });
    const expectedVersion = current ? current.version : null;
    const prev = current && current.configuration ? current.configuration.monthlyTokenQuota : null;
    const row = await configurationService.setConfiguration(client, {
      collegeId,
      category: 'ai_quota',
      configuration: { monthlyTokenQuota: quota },
      expectedVersion,
      userId: OPERATOR_USER_ID,
    });
    await client.query('COMMIT');
    console.log(
      JSON.stringify({ collegeId, previousMonthlyTokenQuota: prev, newMonthlyTokenQuota: quota, version: row.version }),
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
