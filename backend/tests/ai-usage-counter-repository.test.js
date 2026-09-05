'use strict';

// Repository-level coverage for ai_usage_counters (ARCNAVE modernization
// P2, PDF D4) — real Postgres via MIGRATION_DATABASE_URL, same fixture
// pattern position-account-invitation-repository.test.js already uses.
// aiUsageCounterRepository.js is pure SQL mechanics (INSERT ... ON
// CONFLICT DO UPDATE increment + a PK read) — this proves the actual
// increment/read round-trip against a real table, not a mocked one.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const aiUsageCounterRepository = require('../src/repositories/aiUsageCounterRepository');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;

async function seedCollege(pool) {
  const collegeId = `auc${crypto.randomUUID().slice(0, 8)}`;
  await pool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $1)', [collegeId]);
  return collegeId;
}

async function cleanup(pool, collegeId) {
  await pool.query('DELETE FROM ai_usage_counters WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM colleges WHERE college_id = $1', [collegeId]);
}

test('aiUsageCounterRepository', async (t) => {
  const pool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const collegeId = await seedCollege(pool);
  const periodMonth = new Date(Date.UTC(2026, 8, 1));
  const otherPeriodMonth = new Date(Date.UTC(2026, 9, 1));

  t.after(async () => {
    await cleanup(pool, collegeId);
    await pool.end();
  });

  await t.test('getUsage on a period with no rows yet returns zeroes, not an error', async () => {
    const usage = await aiUsageCounterRepository.getUsage(pool, collegeId, periodMonth);
    assert.deepEqual(usage, { tokensUsed: 0, callCount: 0 });
  });

  await t.test('incrementUsage on a fresh (college, period) row INSERTs the initial values', async () => {
    await aiUsageCounterRepository.incrementUsage(pool, collegeId, periodMonth, { tokensDelta: 150, callsDelta: 1 });
    const usage = await aiUsageCounterRepository.getUsage(pool, collegeId, periodMonth);
    assert.deepEqual(usage, { tokensUsed: 150, callCount: 1 });
  });

  await t.test(
    'a second incrementUsage on the SAME (college, period) adds to the existing row, never replaces it',
    async () => {
      await aiUsageCounterRepository.incrementUsage(pool, collegeId, periodMonth, { tokensDelta: 50, callsDelta: 1 });
      const usage = await aiUsageCounterRepository.getUsage(pool, collegeId, periodMonth);
      assert.deepEqual(usage, { tokensUsed: 200, callCount: 2 });
    },
  );

  await t.test('a different period_month for the same college is a fully independent row', async () => {
    await aiUsageCounterRepository.incrementUsage(pool, collegeId, otherPeriodMonth, {
      tokensDelta: 999,
      callsDelta: 3,
    });
    const thisMonth = await aiUsageCounterRepository.getUsage(pool, collegeId, periodMonth);
    const otherMonth = await aiUsageCounterRepository.getUsage(pool, collegeId, otherPeriodMonth);
    assert.deepEqual(thisMonth, { tokensUsed: 200, callCount: 2 });
    assert.deepEqual(otherMonth, { tokensUsed: 999, callCount: 3 });
  });

  await t.test(
    'a zero-token increment (usage genuinely unknown for that call) still increments call_count',
    async () => {
      const before = await aiUsageCounterRepository.getUsage(pool, collegeId, periodMonth);
      await aiUsageCounterRepository.incrementUsage(pool, collegeId, periodMonth, { tokensDelta: 0, callsDelta: 1 });
      const after = await aiUsageCounterRepository.getUsage(pool, collegeId, periodMonth);
      assert.equal(after.tokensUsed, before.tokensUsed);
      assert.equal(after.callCount, before.callCount + 1);
    },
  );
});
