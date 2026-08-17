'use strict';

// Query mechanics for the tenant -> platform stats rollup (Platform
// Admin module build, Phase B: plans/tingly-marinating-whistle.md).
// Two distinct halves live in this one file because they're two sides
// of the same rollup, not because they share a table:
//
// - collectTenantCounts reads tenant-owned tables (users/students/
//   staff/background_jobs) through a connection that already has
//   app.current_tenant set for one college — RLS-scoped, same as
//   every other tenant read in this codebase, not a bypass.
// - upsertCollegeStats / recordSyncError write the platform-owned
//   `platform_college_stats` table, which has no RLS and is written
//   outside of any tenant transaction.
//
// No business logic here — see services/platformStatsSyncService.js
// for the orchestration and error handling.

async function collectTenantCounts(client) {
  // Sequential, not Promise.all — a single pg Client processes
  // queries one at a time; issuing several concurrently on the same
  // client is invalid (and triggers a pg deprecation warning at
  // runtime), not just a style preference.
  const usersResult = await client.query('SELECT count(*)::int AS count FROM users WHERE is_active = true');
  const studentsResult = await client.query('SELECT count(*)::int AS count FROM students');
  const staffResult = await client.query('SELECT count(*)::int AS count FROM staff');
  const departmentsResult = await client.query('SELECT count(*)::int AS count FROM departments');
  const failedJobsResult = await client.query(
    "SELECT count(*)::int AS count FROM background_jobs WHERE status = 'failed' AND created_at > now() - interval '24 hours'",
  );

  return {
    activeUsersCount: usersResult.rows[0].count,
    studentsCount: studentsResult.rows[0].count,
    staffCount: staffResult.rows[0].count,
    departmentsCount: departmentsResult.rows[0].count,
    backgroundJobsOk: failedJobsResult.rows[0].count === 0,
  };
}

async function upsertCollegeStats(pool, collegeId, {
  activeUsersCount, studentsCount, staffCount, departmentsCount, backgroundJobsOk,
}) {
  await pool.query(
    `INSERT INTO platform_college_stats
       (college_id, active_users_count, students_count, staff_count, departments_count, background_jobs_ok,
        jobs_checked_at, last_sync_status, last_sync_error, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now(), 'ok', NULL, now())
     ON CONFLICT (college_id) DO UPDATE SET
       active_users_count = EXCLUDED.active_users_count,
       students_count = EXCLUDED.students_count,
       staff_count = EXCLUDED.staff_count,
       departments_count = EXCLUDED.departments_count,
       background_jobs_ok = EXCLUDED.background_jobs_ok,
       jobs_checked_at = EXCLUDED.jobs_checked_at,
       last_sync_status = EXCLUDED.last_sync_status,
       last_sync_error = EXCLUDED.last_sync_error,
       updated_at = EXCLUDED.updated_at`,
    [collegeId, activeUsersCount, studentsCount, staffCount, departmentsCount, backgroundJobsOk],
  );
}

// A failed sync attempt only flips the status/error fields — it
// deliberately leaves the previous counts in place (via the ON
// CONFLICT branch) rather than zeroing them out, so the Dashboard
// keeps showing the last known-good numbers alongside the fact that
// the most recent sync failed, instead of a misleading drop to zero.
async function recordSyncError(pool, collegeId, errorMessage) {
  await pool.query(
    `INSERT INTO platform_college_stats (college_id, last_sync_status, last_sync_error, updated_at)
     VALUES ($1, 'error', $2, now())
     ON CONFLICT (college_id) DO UPDATE SET
       last_sync_status = 'error',
       last_sync_error = EXCLUDED.last_sync_error,
       updated_at = now()`,
    [collegeId, errorMessage],
  );
}

// Dashboard summary building blocks (Phase C) — reads of the Phase B
// rollup table only, no tenant-table access (this pool is
// platformPool, which has no grant on users/students/staff/
// background_jobs — only SELECT on platform_college_stats itself).
async function sumActiveUsers(pool) {
  const result = await pool.query('SELECT COALESCE(sum(active_users_count), 0)::int AS total FROM platform_college_stats');
  return result.rows[0].total;
}

// "Healthy" means every synced college's last attempt succeeded and
// reported no recent job failures — a single overall boolean plus the
// count of colleges currently flagged unhealthy, for the Dashboard's
// System Health panel.
async function systemHealthSummary(pool) {
  const result = await pool.query(
    `SELECT
       count(*) FILTER (WHERE last_sync_status != 'ok' OR background_jobs_ok = false)::int AS unhealthy_count,
       count(*)::int AS total_count
     FROM platform_college_stats`,
  );
  const { unhealthy_count: unhealthyCount, total_count: totalCount } = result.rows[0];
  return { healthy: unhealthyCount === 0, unhealthyCount, totalCount };
}

module.exports = {
  collectTenantCounts, upsertCollegeStats, recordSyncError, sumActiveUsers, systemHealthSummary,
};
