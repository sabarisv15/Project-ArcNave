'use strict';

// Query mechanics for reading `colleges` (joined with the Phase B
// rollup table `platform_college_stats`) for the Platform Admin
// Organizations screen. Platform Admin module build, Phase C
// (plans/tingly-marinating-whistle.md). Write-side (createCollege)
// stays in platformRepository.js, unchanged — this file only adds the
// list/search read path platformRepository.js never needed before.
//
// The entity/table stays `colleges` here and throughout the backend —
// "Organizations" is frontend UI copy only, not a rename of the
// underlying model.

async function listColleges(pool, { limit = 20, offset = 0, search } = {}) {
  const params = [limit, offset];
  let where = '';
  if (search) {
    params.push(`%${search}%`);
    where = 'WHERE c.name ILIKE $3 OR c.college_id ILIKE $3';
  }

  const result = await pool.query(
    `SELECT
       c.college_id, c.name, c.subdomain, c.subscription_status, c.provisioning_status, c.created_at,
       c.level1_position_title, c.level3_position_title, c.storage_tier,
       s.active_users_count, s.students_count, s.staff_count, s.departments_count,
       s.background_jobs_ok, s.last_sync_status, s.last_sync_error, s.updated_at AS stats_updated_at
     FROM colleges c
     LEFT JOIN platform_college_stats s ON s.college_id = c.college_id
     ${where}
     ORDER BY c.created_at DESC
     LIMIT $1 OFFSET $2`,
    params,
  );
  return result.rows;
}

// RS-GOV-010's provisioning_status lifecycle, counted for the
// Organizations page's stat row. Zero-filled for every known status
// (not just the ones present) so the frontend never has to guess a
// missing key is zero vs. not-yet-loaded.
const PROVISIONING_STATUSES = ['provisioning', 'ready', 'active', 'suspended', 'archived', 'cancelled'];

async function countByProvisioningStatus(pool) {
  const result = await pool.query(
    'SELECT provisioning_status, count(*)::int AS count FROM colleges GROUP BY provisioning_status',
  );
  const counts = Object.fromEntries(PROVISIONING_STATUSES.map((status) => [status, 0]));
  result.rows.forEach((row) => {
    counts[row.provisioning_status] = row.count;
  });
  return counts;
}

// Dashboard summary building blocks (Phase C) — small, focused counts
// rather than folding into one large query, so each stays readable and
// independently testable.
async function countColleges(pool) {
  const result = await pool.query('SELECT count(*)::int AS count FROM colleges');
  return result.rows[0].count;
}

// Dashboard stat card sub-line (Figma parity pass) — "+N this week"
// under Institutions.
async function countNewThisWeek(pool) {
  const result = await pool.query(
    "SELECT count(*)::int AS count FROM colleges WHERE created_at >= now() - interval '7 days'",
  );
  return result.rows[0].count;
}

async function countTrialColleges(pool) {
  const result = await pool.query("SELECT count(*)::int AS count FROM colleges WHERE subscription_status = 'trial'");
  return result.rows[0].count;
}

// Dashboard stat card sub-line — "N expire this week" under Trial
// Colleges. Backed by trial_ends_at (30-day fixed window from
// creation, set/cleared in platformRepository's createCollege/
// updateCollege).
async function countTrialCollegesExpiringSoon(pool) {
  const result = await pool.query(
    `SELECT count(*)::int AS count FROM colleges
     WHERE subscription_status = 'trial' AND trial_ends_at IS NOT NULL
       AND trial_ends_at <= now() + interval '7 days'`,
  );
  return result.rows[0].count;
}

async function recentColleges(pool, { limit = 5 } = {}) {
  const result = await pool.query(
    `SELECT college_id, name, subdomain, subscription_status, created_at
     FROM colleges ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows;
}

// Organizations page stat row (Figma parity pass): Total / Active /
// Active Profiles (sum of active_users_count across active colleges
// only — a suspended or archived college's leftover stats-row count
// shouldn't inflate this) / Suspended, in one query rather than four
// round trips.
async function getOrganizationsSummary(pool) {
  const result = await pool.query(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (WHERE c.provisioning_status = 'active')::int AS active,
       count(*) FILTER (WHERE c.provisioning_status = 'suspended')::int AS suspended,
       coalesce(sum(s.active_users_count) FILTER (WHERE c.provisioning_status = 'active'), 0)::int AS active_profiles
     FROM colleges c
     LEFT JOIN platform_college_stats s ON s.college_id = c.college_id`,
  );
  return result.rows[0];
}

module.exports = {
  listColleges,
  countColleges,
  countTrialColleges,
  countTrialCollegesExpiringSoon,
  countNewThisWeek,
  recentColleges,
  countByProvisioningStatus,
  getOrganizationsSummary,
};
