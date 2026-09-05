'use strict';

// ARCNAVE modernization P2 (4.5 / clash C8) — the worker loop.
// background_jobs itself and enqueue()'s own setImmediate dispatch
// (backgroundJobService.js) already existed; what was missing is
// exactly what this file adds: a job enqueued today only ever runs if
// the SAME process that created it is still alive at the moment its
// setImmediate callback fires — nothing could pick a job back up if
// that dispatch was lost (a synchronous throw before the handler ever
// starts, or the process restarting between enqueue and the next
// tick). It would just sit at status='queued' forever with nothing
// scheduled to run it.
//
// Same "least disruptive option, no new infrastructure" resolution
// clash C8 recorded: a plain in-process setInterval poll, the same
// shape jobs/platformStatsSync.js already established (cross-tenant
// college enumeration via platformRepository.listCollegeIds, one
// tenant-scoped connection per college, tolerant of a missed tick) —
// not a distributed queue, not multiple worker processes (this
// deployment is still one server process; C8's own resolution: "only
// add feature-switch and gradual-rollout tools if the plan moves to
// multiple server processes").
//
// Purely additive safety net, not a replacement for the existing fast
// path: enqueue()'s own immediate setImmediate dispatch is unchanged
// and already completes a normal job within the same tick. This loop
// only ever finds a 'queued' row when that fast dispatch never ran at
// all — a genuinely stuck job, not merely a slow one — because
// claimQueuedJobs atomically flips status to 'running' the instant
// something is actually in flight, the same transition the fast path's
// own markRunning already makes almost immediately after enqueue.
//
// A job can only be picked up here if its job_type has a registered
// handler (backgroundJobHandlers.js) — a caller-supplied closure (e.g.
// studentAdmissionDraftService's own admission_extraction handler
// today) has no persisted form this loop could resume with, by
// definition. Converting a specific feature to a payload-driven,
// registry-resolvable handler so it becomes resumable here too is its
// own separate, scoped follow-up — not attempted in this pass.

const { appPool, platformPool } = require('../db/pool');
const platformRepository = require('../repositories/platformRepository');
const backgroundJobRepository = require('../repositories/backgroundJobRepository');
const backgroundJobHandlers = require('../services/backgroundJobHandlers');
const backgroundJobService = require('../services/backgroundJobService');
const { logError, logInfo } = require('../logging/logger');

const POLL_INTERVAL_MS = 10 * 1000; // 10 seconds
const CLAIM_LIMIT_PER_COLLEGE = 5;

async function claimAndRunForCollege(collegeId, jobTypes) {
  const client = await appPool.connect();
  let claimed;
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    claimed = await backgroundJobRepository.claimQueuedJobs(client, jobTypes, CLAIM_LIMIT_PER_COLLEGE);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  for (const job of claimed) {
    const handler = backgroundJobHandlers.getHandler(job.job_type);
    // Defensive only — claimQueuedJobs' own job_type = ANY($1) filter
    // already guarantees this, using the exact same registered-types
    // list this function was called with.
    if (!handler) continue;
    logInfo('background_job_worker_resuming', { collegeId, jobId: job.id, jobType: job.job_type });
    // eslint-disable-next-line no-await-in-loop
    await backgroundJobService.runClaimedJob(collegeId, job.id, () => handler(job));
  }
}

async function runPollCycle() {
  const jobTypes = backgroundJobHandlers.listRegisteredJobTypes();
  // Nothing this loop is able to run yet — skip the whole cross-tenant
  // scan rather than paying for it on every tick for zero possible
  // result. Becomes real the moment any caller registers a handler.
  if (jobTypes.length === 0) return;

  const collegeIds = await platformRepository.listCollegeIds(platformPool);
  for (const collegeId of collegeIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await claimAndRunForCollege(collegeId, jobTypes);
    } catch (err) {
      logError('background_job_worker_college_failed', { collegeId, error: err.message });
    }
  }
}

function startBackgroundJobWorker() {
  const runAndLog = () => {
    runPollCycle().catch((err) => logError('background_job_worker_cycle_failed', { error: err.message }));
  };

  logInfo('background_job_worker_started', { intervalMs: POLL_INTERVAL_MS });
  const interval = setInterval(runAndLog, POLL_INTERVAL_MS);
  // Don't hold the process open just for this timer — matches how
  // jobs/platformStatsSync.js's own interval behaves under normal
  // server shutdown.
  interval.unref();
  return interval;
}

module.exports = { startBackgroundJobWorker, runPollCycle };
