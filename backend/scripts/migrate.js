'use strict';

// Programmatic node-pg-migrate invocation rather than the bare CLI,
// so the migration connection string comes from MIGRATION_DATABASE_URL
// explicitly (arcnave_admin) — the CLI's default env var is
// DATABASE_URL, which in this project is deliberately the
// least-privilege arcnave_app runtime connection instead. Using the
// programmatic API sidesteps having to rely on a CLI flag name to get
// that redirection right.

const { runner } = require('node-pg-migrate');

// ARCNAVE modernization P1 (PDF D5: "safe-lock timeout as the first
// line"). A migration's ALTER TABLE/etc. has to wait in Postgres's own
// lock queue behind whatever already holds a conflicting lock on that
// table — and once queued, it ALSO blocks every later query (including
// plain SELECTs) that arrives behind it, for as long as the wait takes
// (a well-known "lock queue pile-up" failure mode, not hypothetical).
// A short lock_timeout makes the migration fail fast and loudly
// instead of silently piling up the app's live traffic behind it —
// exactly the "first line of defense" D5 names. statement_timeout is
// deliberately left at node-pg-migrate's own default (0/unlimited):
// a real backfill migration can legitimately run for minutes once it
// HAS the lock; only the WAIT to acquire the lock is bounded here.
// PGOPTIONS is a real libpq mechanism node-postgres passes straight
// through to the connection startup — set before `runner()` opens its
// own connection below, so every DDL statement in every migration
// inherits it with no per-migration boilerplate.
process.env.PGOPTIONS =
  `${process.env.PGOPTIONS || ''} -c lock_timeout=${process.env.MIGRATION_LOCK_TIMEOUT_MS || '5000'}`.trim();

const direction = process.argv[2] || 'up';

// `down` defaults to reverting just the last-applied migration, not
// the whole schema — an unbounded `down` count previously took a
// single "revert the new migration" call all the way back to an empty
// database. `up` stays unbounded: applying every pending migration is
// the safe, expected default there.
const count = direction === 'down' ? 1 : Infinity;

runner({
  databaseUrl: process.env.MIGRATION_DATABASE_URL,
  dir: 'migrations',
  direction,
  migrationsTable: 'pgmigrations',
  count,
  log: (msg) => console.log(msg),
})
  .then(() => {
    console.log(`Migrations (${direction}) complete.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
