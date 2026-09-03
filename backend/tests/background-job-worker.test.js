'use strict';

// ARCNAVE modernization P2 (4.5 / clash C8) — the worker loop
// (jobs/backgroundJobWorker.js). Real Postgres, real end-to-end: a
// 'queued' row inserted directly (bypassing backgroundJobService.enqueue's
// own setImmediate fast path, simulating the exact case this loop exists
// for — a job whose fast dispatch never happened at all) is picked up,
// run, and marked completed by one poll cycle. Same fixture pattern
// background-jobs.test.js already uses.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const security = require('../src/security');
const backgroundJobRepository = require('../src/repositories/backgroundJobRepository');
const backgroundJobHandlers = require('../src/services/backgroundJobHandlers');
const backgroundJobWorker = require('../src/jobs/backgroundJobWorker');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'BackgroundJobWorkerTestPass123!';

async function seedTenant(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeId = `bjw${suffix}`;
  const subdomain = `bjwtenant${suffix}`;
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)', [
    collegeId,
    subdomain,
  ]);
  const passwordHash = await security.hashPassword(PASSWORD);
  const userResult = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'principaluser', 'principaluser@example.com', $2, 'principal', true) RETURNING id`,
    [collegeId, passwordHash],
  );
  return { collegeId, userId: userResult.rows[0].id };
}

async function cleanupTenant(adminPool, collegeId) {
  await adminPool.query('DELETE FROM background_jobs WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [collegeId]);
}

// A queued row inserted directly via the repository, with app.current_tenant
// set for the duration — mirrors exactly the row shape enqueue() itself
// produces, just without its own setImmediate dispatch ever running.
async function insertQueuedJob(adminPool, { collegeId, userId, jobType, payload }) {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    const job = await backgroundJobRepository.create(client, {
      collegeId,
      name: jobType,
      createdByUserId: userId,
      jobType,
      payload,
    });
    await client.query('COMMIT');
    return job;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function readJob(adminPool, collegeId, jobId) {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    const job = await backgroundJobRepository.findById(client, jobId);
    await client.query('COMMIT');
    return job;
  } finally {
    client.release();
  }
}

test('backgroundJobWorker.runPollCycle', async (t) => {
  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const tenant = await seedTenant(adminPool);

  t.after(async () => {
    await cleanupTenant(adminPool, tenant.collegeId).catch(() => {});
    await adminPool.end();
  });

  await t.test(
    'a queued job whose job_type has a registered handler is claimed, run, and marked completed',
    async () => {
      const jobType = `test_worker_${crypto.randomUUID().slice(0, 8)}`;
      let handlerCalledWith;
      backgroundJobHandlers.registerHandler(jobType, async (job) => {
        handlerCalledWith = job;
        return { echoed: job.payload };
      });

      const job = await insertQueuedJob(adminPool, {
        collegeId: tenant.collegeId,
        userId: tenant.userId,
        jobType,
        payload: { hello: 'world' },
      });
      assert.equal(job.status, 'queued');

      await backgroundJobWorker.runPollCycle();

      const finished = await readJob(adminPool, tenant.collegeId, job.id);
      assert.equal(finished.status, 'completed');
      assert.equal(finished.progress, 100);
      assert.deepEqual(finished.result, { echoed: { hello: 'world' } });
      assert.ok(handlerCalledWith, 'the registered handler was actually invoked');
      assert.equal(handlerCalledWith.id, job.id);
      assert.deepEqual(handlerCalledWith.payload, { hello: 'world' });
    },
  );

  await t.test('a queued job whose handler throws is marked failed, not left running forever', async () => {
    const jobType = `test_worker_fail_${crypto.randomUUID().slice(0, 8)}`;
    backgroundJobHandlers.registerHandler(jobType, async () => {
      throw new Error('deliberate failure for this test');
    });

    const job = await insertQueuedJob(adminPool, {
      collegeId: tenant.collegeId,
      userId: tenant.userId,
      jobType,
      payload: null,
    });

    await backgroundJobWorker.runPollCycle();

    const finished = await readJob(adminPool, tenant.collegeId, job.id);
    assert.equal(finished.status, 'failed');
    assert.equal(finished.error, 'deliberate failure for this test');
  });

  await t.test('a queued job whose job_type has NO registered handler is left untouched, still queued', async () => {
    const job = await insertQueuedJob(adminPool, {
      collegeId: tenant.collegeId,
      userId: tenant.userId,
      jobType: `unregistered_${crypto.randomUUID().slice(0, 8)}`,
      payload: null,
    });

    await backgroundJobWorker.runPollCycle();

    const stillQueued = await readJob(adminPool, tenant.collegeId, job.id);
    assert.equal(stillQueued.status, 'queued');
  });
});
