'use strict';

// ARCNAVE modernization P1 (PDF D6: "no slow-query dashboard" — query-
// stats extension + dashboard). Deliberately a plain report script,
// not a hosted Grafana/BI stack — standing up a new always-on service
// is real infrastructure the owner hasn't asked for yet, and
// pg_stat_statements' own view already has everything this needs.
// Run it whenever ("node scripts/query-stats-report.js"), or wire it
// into an ops cron that mails/logs the output — the point is the data
// is now queryable and readable, not that it lives behind a
// permanent new dashboard URL.

const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    const { rows: slowest } = await client.query(`
      SELECT
        query,
        calls,
        round(total_exec_time::numeric, 1) AS total_ms,
        round(mean_exec_time::numeric, 2) AS mean_ms,
        round((100 * total_exec_time / sum(total_exec_time) OVER ())::numeric, 1) AS pct_of_total_time
      FROM pg_stat_statements
      WHERE query NOT ILIKE '%pg_stat_statements%'
      ORDER BY total_exec_time DESC
      LIMIT 20
    `);

    const { rows: mostFrequent } = await client.query(`
      SELECT query, calls, round(mean_exec_time::numeric, 2) AS mean_ms
      FROM pg_stat_statements
      WHERE query NOT ILIKE '%pg_stat_statements%'
      ORDER BY calls DESC
      LIMIT 10
    `);

    console.log('=== Top 20 queries by total time (cumulative cost) ===');
    for (const row of slowest) {
      console.log(`${row.pct_of_total_time}%\t${row.calls} calls\t${row.mean_ms}ms avg\t${row.query.slice(0, 100)}`);
    }

    console.log('\n=== Top 10 most-frequently-called queries ===');
    for (const row of mostFrequent) {
      console.log(`${row.calls} calls\t${row.mean_ms}ms avg\t${row.query.slice(0, 100)}`);
    }

    if (slowest.length === 0) {
      console.log(
        'No rows yet — pg_stat_statements only accumulates stats for queries actually run since the ' +
          'extension was enabled (or the last pg_stat_statements_reset()). Run the app / test suite first.',
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Query stats report failed:', err);
  process.exit(1);
});
