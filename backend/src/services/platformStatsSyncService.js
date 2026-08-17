'use strict';

// Platform Admin module build, Phase B (plans/tingly-marinating-
// whistle.md) — pure aggregation/orchestration logic for the tenant ->
// platform stats rollup, deliberately kept separate from the scheduler
// (jobs/platformStatsSync.js) that calls it. Keeping the two apart
// means the fixed interval can be swapped for a queue/cron/distributed
// job runner later without touching this file — the scheduler only
// ever calls syncCollege(collegeId).
//
// syncCollege never throws past its own boundary: a failure to collect
// one college's tenant-side counts (a locked table, a transient
// connection error) is recorded as last_sync_status='error' on that
// college's platform_college_stats row, not allowed to abort the
// scheduler's loop over every other college.

const { appPool } = require('../db/pool');
const platformStatsRepository = require('../repositories/platformStatsRepository');

// Runs inside its own short transaction so app.current_tenant (set
// with the third `true` arg, i.e. transaction-local) is guaranteed
// cleared when the connection is released back to the pool — the same
// discipline openTenantTransaction enforces for a normal request.
async function collectWithTenantContext(collegeId) {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    const counts = await platformStatsRepository.collectTenantCounts(client);
    await client.query('COMMIT');
    return counts;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function syncCollege(collegeId) {
  try {
    const counts = await collectWithTenantContext(collegeId);
    await platformStatsRepository.upsertCollegeStats(appPool, collegeId, counts);
    return { collegeId, status: 'ok' };
  } catch (err) {
    await platformStatsRepository.recordSyncError(appPool, collegeId, err.message);
    return { collegeId, status: 'error', error: err.message };
  }
}

module.exports = { syncCollege };
