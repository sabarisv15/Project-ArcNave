'use strict';

// ARCNAVE modernization P1 (PDF D7: "container volume only — a copy of
// the database is not a backup"). Takes a real pg_dump (custom format,
// -Fc — restorable with pg_restore, includes the pgvector extension's
// data correctly unlike a plain-text dump of a vector column), writes
// it to config.documentBackupRoot (local disk, already the existing
// backup-root convention documentService uses).
//
// Local-disk only, deliberately (owner decision, 2026-08-31) — an
// off-host destination (cloud storage) was scoped and then
// intentionally dropped the same session; wiring one back in later is
// a small, isolated addition (upload the file this script already
// produces) once there's a real deploy target to protect, not a
// rewrite of this script.
//
// Run manually (`node scripts/backup-database.js`) or on a schedule
// (cron hitting this file directly — not itself a scheduler);
// scripts/restore-database.js is the other half, and MUST be run at
// least once against a real restore target before this is considered
// "a tested backup," not just "a backup that exists" (D7's own
// point).

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const config = require('../src/config');

const execFileAsync = promisify(execFile);

function timestampedFilename() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `arcnave-db-backup-${stamp}.dump`;
}

async function runPgDump(destPath) {
  // MIGRATION_DATABASE_URL (arcnave_admin) — the same role migrations
  // run as, and the only one guaranteed to see every table regardless
  // of RLS (arcnave_app, DATABASE_URL, is deliberately RLS-restricted
  // per tenant; a backup must capture every tenant's rows).
  const databaseUrl = process.env.MIGRATION_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('MIGRATION_DATABASE_URL is not set — cannot take an admin-scoped backup.');
  }
  await execFileAsync('pg_dump', ['-Fc', '-f', destPath, databaseUrl], {
    maxBuffer: 1024 * 1024 * 64,
  });
}

async function pruneOldLocalBackups(dir, keep) {
  const entries = await fs.readdir(dir);
  const backups = entries.filter((f) => f.startsWith('arcnave-db-backup-') && f.endsWith('.dump')).sort();
  const toDelete = backups.slice(0, Math.max(0, backups.length - keep));
  for (const file of toDelete) {
    // eslint-disable-next-line no-await-in-loop -- small, fixed local backup set; sequential is fine and simpler to reason about than Promise.all for a delete loop
    await fs.unlink(path.join(dir, file));
    console.log(`Pruned old local backup: ${file}`);
  }
}

async function main() {
  await fs.mkdir(config.documentBackupRoot, { recursive: true });
  const filename = timestampedFilename();
  const destPath = path.join(config.documentBackupRoot, filename);

  console.log(`Running pg_dump -> ${destPath}`);
  await runPgDump(destPath);

  const { size } = await fs.stat(destPath);
  console.log(`Backup written: ${filename} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  console.warn(
    'Local-disk only — this does not survive the host it lives on being lost. ' +
      "Off-host storage is a deliberate follow-up once a real deploy target exists (see this script's own header comment).",
  );

  await pruneOldLocalBackups(config.documentBackupRoot, config.dbBackup.localRetentionCount);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backup failed:', err);
    process.exit(1);
  });
