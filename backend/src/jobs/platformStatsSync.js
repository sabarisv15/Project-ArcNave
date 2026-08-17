'use strict';

// Platform Admin module build, Phase B (plans/tingly-marinating-
// whistle.md) — the scheduler only, no aggregation logic (see
// services/platformStatsSyncService.js for that). Kept deliberately
// thin: replacing this fixed interval with a queue/cron/distributed
// job runner later should only ever mean swapping this file, never
// touching the sync service or its repository.
//
// A plain in-process setInterval, not a persisted job queue — this
// codebase has no queue infrastructure yet, and the sync is cheap,
// idempotent (every run just re-upserts current counts), and
// tolerant of a missed tick (the Dashboard shows last-known values
// plus last_sync_status either way).

const { platformPool } = require('../db/pool');
const platformRepository = require('../repositories/platformRepository');
const platformStatsSyncService = require('../services/platformStatsSyncService');
const { logError, logInfo } = require('../logging/logger');

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function runSyncCycle() {
  const collegeIds = await platformRepository.listCollegeIds(platformPool);
  for (const collegeId of collegeIds) {
    // syncCollege already records a failure onto that college's own
    // platform_college_stats row and resolves rather than rejects —
    // this try/catch only guards against something going wrong in
    // that best-effort write itself, so one bad college can never
    // abort the loop over the rest.
    try {
      const result = await platformStatsSyncService.syncCollege(collegeId);
      if (result.status === 'error') {
        logError('platform_stats_sync_college_failed', { collegeId, error: result.error });
      }
    } catch (err) {
      logError('platform_stats_sync_unexpected_failure', { collegeId, error: err.message });
    }
  }
}

function startPlatformStatsSync() {
  const runAndLog = () => {
    runSyncCycle().catch((err) => logError('platform_stats_sync_cycle_failed', { error: err.message }));
  };

  logInfo('platform_stats_sync_started', { intervalMs: SYNC_INTERVAL_MS });
  runAndLog();
  const interval = setInterval(runAndLog, SYNC_INTERVAL_MS);
  // Don't hold the process open just for this timer — matches how a
  // background sync should behave under normal server shutdown.
  interval.unref();
  return interval;
}

module.exports = { startPlatformStatsSync, runSyncCycle };
