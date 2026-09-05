'use strict';

// ARCNAVE modernization P1 (PDF D6: "no slow-query dashboard" — query-
// stats extension + dashboard). The extension is only usable once
// pg_stat_statements is in shared_preload_libraries at server start
// (docker-compose.yml's `command:` line) — this migration's own
// CREATE EXTENSION is the SQL-side half; scripts/query-stats-report.js
// is the "dashboard" half (a report, not a hosted BI tool — see that
// script's own header for why).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
};

exports.down = (pgm) => {
  pgm.sql('DROP EXTENSION IF EXISTS pg_stat_statements');
};
