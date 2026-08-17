'use strict';

// Platform Admin module build, Phase A (plan: "Platform Admin — full
// module build", plans/tingly-marinating-whistle.md). Cross-tenant
// dashboard stats (Active Users, background-job health) can't be read
// directly by the platform role — arcnave_platform is deliberately
// granted zero access to tenant tables (users, background_jobs, ...),
// a real data-isolation boundary, not an oversight. Instead each
// tenant college pushes its own aggregate counts into this
// platform-visible summary table on a timer (see the Phase B sync
// service/job). The trust direction stays tenant -> platform-table,
// never platform -> tenant-table: this table only ever carries
// aggregate counts, never raw tenant records.
//
// One row per college, keyed by college_id (not a synthetic id) since
// this is a genuine upsert target — the sync job always writes
// exactly one current-state row per college, never an append-only
// history.
//
// last_sync_status/last_sync_error let the Dashboard report rollup
// health itself (a sync that's failing is worth surfacing), not just
// display whatever counts happen to be sitting there from a stale run.
//
// No RLS: this table is conceptually platform-visible aggregate data,
// not per-tenant-scoped tenant data — the write path (the sync
// service) explicitly scopes every UPDATE by college_id at the
// application layer, which is sufficient since no row here contains
// anything more sensitive than a count.
//
// Grants are directional like principal_invitations': arcnave_platform
// only ever reads (SELECT); arcnave_app is the sole writer
// (INSERT/UPDATE, via the tenant-side sync service), and gets no wider
// access than this one table — the only crack in the tenant/platform
// separation, deliberately narrow.

const APP_ROLE = 'arcnave_app';
const PLATFORM_ROLE = 'arcnave_platform';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE platform_college_stats (
        college_id           TEXT PRIMARY KEY REFERENCES colleges(college_id),
        active_users_count   INTEGER NOT NULL DEFAULT 0,
        students_count       INTEGER NOT NULL DEFAULT 0,
        staff_count          INTEGER NOT NULL DEFAULT 0,
        background_jobs_ok   BOOLEAN NOT NULL DEFAULT true,
        jobs_checked_at      TIMESTAMPTZ,
        last_sync_status     TEXT NOT NULL DEFAULT 'pending',
        last_sync_error      TEXT,
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`GRANT SELECT ON platform_college_stats TO ${PLATFORM_ROLE}`);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON platform_college_stats TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS platform_college_stats');
};
