# Migration safety rails

ARCNAVE modernization P1 (PDF D5). Three rules, now enforced or
demonstrated rather than just stated:

1. **A short `lock_timeout` is automatic.** `scripts/migrate.js` sets
   `PGOPTIONS='-c lock_timeout=5000'` (5s, override via
   `MIGRATION_LOCK_TIMEOUT_MS`) before running any migration — a
   migration that can't acquire its lock quickly fails loudly instead
   of piling up live traffic behind it in Postgres's lock queue.
   `statement_timeout` is deliberately left unbounded: a real backfill
   can legitimately run for minutes once it has the lock.

2. **Build indexes with `CONCURRENTLY`, not a blocking `CREATE INDEX`.**
   See `1788172292000_tenant-column-indexes.js` for the pattern:
   `pgm.noTransaction()` (required — `CONCURRENTLY` cannot run inside a
   transaction block at all) + `IF NOT EXISTS` (idempotent against a
   partial prior run, since a non-transactional migration can't be
   cleanly rolled back by node-pg-migrate itself if one statement
   fails partway through).

3. **A column change that could lock a large table gets split into
   separate migrations**, not one `ALTER TABLE`:
   - Adding a NOT NULL column: add it nullable first (fast, metadata-only
     since Postgres 11+), backfill in batches in application code or a
     separate script (never a single unbounded `UPDATE`), then a
     follow-up migration adds the `NOT NULL` constraint (`ALTER TABLE
     ... ALTER COLUMN ... SET NOT NULL` still needs a table scan, but a
     much shorter one against already-backfilled data, and can itself
     be preceded by an unvalidated `CHECK` constraint + a separate
     `VALIDATE CONSTRAINT` to avoid holding the strong lock for the
     scan at all — see Postgres's own docs on `ALTER TABLE ... VALIDATE
     CONSTRAINT`).
   - Changing a column's type: add the new column, dual-write, backfill,
     cut over reads, drop the old column — never an in-place
     `ALTER COLUMN ... TYPE` on a large, live table.
   - No existing migration in this repo has needed this pattern yet
     (no table here is large/live enough for it to have mattered) —
     this is the rule for the next one that does, not a retrofit of
     history.
