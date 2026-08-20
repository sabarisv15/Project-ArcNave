'use strict';

const { appPool } = require('../db/pool');
const { registerAfterCommit } = require('../db/tenantTransaction');
const backgroundJobRepository = require('../repositories/backgroundJobRepository');

function publicJob(job) {
  return {
    id: job.id,
    college_id: job.college_id,
    name: job.name,
    status: job.status,
    error: job.error,
    created_by_user_id: job.created_by_user_id,
    created_at: job.created_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    job_type: job.job_type,
    progress: job.progress,
    result: job.result,
  };
}

// reportProgress: its own short-lived transaction, separate from
// whatever transaction/connection the handler itself is using — a
// progress tick should be visible to a polling client immediately, not
// held until the whole job's handler finishes and its own transaction
// (if any) commits.
async function reportProgress(collegeId, jobId, progress) {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    await backgroundJobRepository.updateProgress(client, jobId, progress);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function runTenantJob(collegeId, jobId, handler) {
  // Raw .query() calls below (BEGIN/COMMIT/ROLLBACK, set_config) are
  // transaction/tenant-context bootstrap plumbing, exempt from
  // CLAUDE.md rule 1 -- they establish the transaction and RLS context
  // that backgroundJobRepository's calls then run inside, not a
  // business-data bypass.
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    await backgroundJobRepository.markRunning(client, jobId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const finishClient = await appPool.connect();
  try {
    // handler's return value (if any) becomes job.result — the
    // admission-extraction handler's merged fields/conflicts/summary,
    // read back by the frontend via find(). routes/backgroundJobs.js's
    // own generic no-op handler returns undefined, same as before this
    // session's own task (markCompleted's own result param is optional).
    const result = await handler({
      reportProgress: (progress) => reportProgress(collegeId, jobId, progress),
    });
    await finishClient.query('BEGIN');
    await finishClient.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    await backgroundJobRepository.markCompleted(finishClient, jobId, result);
    await finishClient.query('COMMIT');
  } catch (err) {
    await finishClient.query('ROLLBACK').catch(() => {});
    await finishClient.query('BEGIN');
    await finishClient.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    await backgroundJobRepository.markFailed(
      finishClient,
      jobId,
      err && err.message ? err.message : 'Background job failed',
    );
    await finishClient.query('COMMIT');
  } finally {
    finishClient.release();
  }
}

async function enqueue(client, {
  collegeId, name, jobType, payload, createdByUserId,
}, handler = async () => {}) {
  const job = await backgroundJobRepository.create(client, {
    collegeId,
    name: name || 'background_job',
    createdByUserId,
    jobType,
    payload,
  });

  // Deferred until the enqueuing transaction actually commits — see
  // db/tenantTransaction.js's registerAfterCommit. Previously fired
  // immediately here, on a brand-new connection that could reach
  // Postgres before this function's own INSERT (above) was durably
  // committed, silently losing every status update on the loser side
  // of that race (markRunning/markCompleted/markFailed all match zero
  // rows against a job Postgres doesn't consider to exist yet, and none
  // of them checked that).
  registerAfterCommit(() => {
    setImmediate(async () => {
      try {
        await runTenantJob(collegeId, job.id, handler);
      } catch {
        // Status updates are best-effort; callers can still see the queued row.
      }
    });
  });

  return publicJob(job);
}

async function list(client, options) {
  const rows = await backgroundJobRepository.list(client, options);
  return rows.map(publicJob);
}

async function find(client, id) {
  const job = await backgroundJobRepository.findById(client, id);
  return job ? publicJob(job) : null;
}

module.exports = { enqueue, list, find };
