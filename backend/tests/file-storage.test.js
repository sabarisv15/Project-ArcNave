'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('fileStorage encrypts, backs up, and restores files', async () => {
  process.env.DATABASE_URL ||= 'postgresql://x:x@localhost:5432/x';
  process.env.MIGRATION_DATABASE_URL ||= 'postgresql://x:x@localhost:5432/x';
  process.env.PLATFORM_DATABASE_URL ||= 'postgresql://x:x@localhost:5432/x';
  process.env.JWT_SECRET_KEY ||= 'x';
  process.env.PLATFORM_JWT_SECRET_KEY ||= 'y';

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arcnave-storage-'));
  const backup = await fs.mkdtemp(path.join(os.tmpdir(), 'arcnave-backup-'));
  process.env.DOCUMENT_STORAGE_ROOT = root;
  process.env.DOCUMENT_BACKUP_ROOT = backup;
  process.env.DOCUMENT_STORAGE_ENCRYPTION_KEY = 'test-storage-key';

  const fileStorage = require('../src/storage/fileStorage');
  const relativePath = 'college/student/doc/file.pdf';
  const original = Buffer.from('plain private document');

  await fileStorage.writeFile(relativePath, original);

  const stored = await fs.readFile(fileStorage.resolveAbsolutePath(relativePath));
  const backedUp = await fs.readFile(fileStorage.resolveBackupPath(relativePath));
  assert.equal(stored.equals(original), false);
  assert.ok(stored.equals(backedUp));
  assert.ok((await fileStorage.readFile(relativePath)).equals(original));

  await fs.rm(fileStorage.resolveAbsolutePath(relativePath), { force: true });
  assert.ok((await fileStorage.readFile(relativePath)).equals(original));
  assert.ok(await fs.stat(fileStorage.resolveAbsolutePath(relativePath)));
});
