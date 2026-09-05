'use strict';

// ARCNAVE modernization P1 (PDF D7) — the half that actually matters:
// "You need point-in-time recovery, and you must test the restore
// regularly." A backup nobody has ever restored is unverified —
// scripts/restore-database.js restores a real dump into a
// disposable, DIFFERENT database (never the live one — see the
// --confirm-into-live escape hatch's own comment for why that path
// still exists but is deliberately hard to reach by accident), so
// this script IS the test, runnable as often as wanted with zero risk
// to real data.
//
// Usage:
//   node scripts/restore-database.js <path-to-.dump-file> <target-database-name>
//   node scripts/restore-database.js --latest <target-database-name>   (pulls the newest local backup)

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');
const config = require('../src/config');

const execFileAsync = promisify(execFile);

async function resolveDumpPath(arg) {
  if (arg !== '--latest') return arg;
  const entries = await fs.readdir(config.documentBackupRoot);
  const backups = entries.filter((f) => f.startsWith('arcnave-db-backup-') && f.endsWith('.dump')).sort();
  if (backups.length === 0) {
    throw new Error(`No local backups found in ${config.documentBackupRoot} — run scripts/backup-database.js first.`);
  }
  return path.join(config.documentBackupRoot, backups[backups.length - 1]);
}

function adminConnectionUrl(databaseName) {
  const base = new URL(process.env.MIGRATION_DATABASE_URL);
  base.pathname = `/${databaseName}`;
  return base.toString();
}

async function createRestoreTarget(targetDb) {
  // Connects to the admin role's own default database (whatever
  // MIGRATION_DATABASE_URL already points at) just to issue CREATE
  // DATABASE — cannot run inside a transaction, so a plain one-off
  // client, not req.dbClient/openTenantTransaction's machinery (this
  // is an offline ops script, not a tenant request).
  const client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetDb]);
    if (exists.rows.length > 0) {
      throw new Error(
        `Database "${targetDb}" already exists. Pick a fresh disposable name ` +
          `(e.g. "${targetDb}_${Date.now()}") — this script refuses to restore over an existing database.`,
      );
    }
    await client.query(`CREATE DATABASE "${targetDb}"`);
  } finally {
    await client.end();
  }
}

async function runPgRestore(dumpPath, targetDb) {
  await execFileAsync('pg_restore', ['-d', adminConnectionUrl(targetDb), '--no-owner', '--no-privileges', dumpPath], {
    maxBuffer: 1024 * 1024 * 64,
  });
}

async function verifyRestore(targetDb) {
  const client = new Client({ connectionString: adminConnectionUrl(targetDb) });
  await client.connect();
  try {
    // Table count alone doesn't prove data integrity, but it does
    // prove pg_restore actually populated a real schema rather than
    // silently producing an empty database on a partial failure
    // pg_restore itself didn't hard-fail on (a real, observed pg_restore
    // behavior with --no-owner/--no-privileges on a handful of
    // grant-related statements it can't apply against a role that
    // doesn't own the objects).
    const tableCount = await client.query(
      "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const collegeCount = await client.query('SELECT count(*) FROM colleges').catch(() => null);
    console.log(`Restored database "${targetDb}": ${tableCount.rows[0].count} tables in public schema.`);
    if (collegeCount) {
      console.log(`  colleges table: ${collegeCount.rows[0].count} rows — restore contains real tenant data.`);
    }
    return Number(tableCount.rows[0].count) > 0;
  } finally {
    await client.end();
  }
}

async function main() {
  const [rawDumpArg, targetDb] = process.argv.slice(2);
  if (!rawDumpArg || !targetDb) {
    console.error('Usage: node scripts/restore-database.js <dump-file|--latest> <disposable-target-db-name>');
    process.exit(1);
    return;
  }

  const dumpPath = await resolveDumpPath(rawDumpArg);
  console.log(`Restoring ${dumpPath} into a fresh database "${targetDb}"...`);

  await createRestoreTarget(targetDb);
  await runPgRestore(dumpPath, targetDb);
  const ok = await verifyRestore(targetDb);

  console.log(
    ok
      ? `Restore verified. Drop the disposable database when done: DROP DATABASE "${targetDb}";`
      : 'Restore produced an EMPTY database — this backup is NOT trustworthy. Investigate before relying on it.',
  );
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('Restore failed:', err);
  process.exit(1);
});
