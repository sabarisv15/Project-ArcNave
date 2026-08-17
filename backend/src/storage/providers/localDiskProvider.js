'use strict';

// The 'local_disk' storage provider — ARCNAVE's own default, and the
// only one implemented so far (Stage 8a / RS-GOV-013: the architecture
// below is what makes adding a real second provider, e.g. SFTP, a
// registry entry rather than a DocumentService change — see
// storageProviderRegistry.js's own comment). Everything in this file
// is the exact encrypt/dual-write/self-heal behavior fileStorage.js
// used to implement directly, moved here unchanged — no behavior
// change for any existing caller.
//
// Pure fs helpers — no DB, no business logic, no permissions.

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const config = require('../../config');

const ENCRYPTION_MAGIC = Buffer.from('ARCNAVEENC1');
const IV_BYTES = 12;
const TAG_BYTES = 16;

function resolveInside(root, relativePath) {
  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(absoluteRoot, relativePath);
  const relative = path.relative(absoluteRoot, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('storage path escapes the configured root');
  }
  return absolutePath;
}

function resolveAbsolutePath(relativePath) {
  return resolveInside(config.documentStorageRoot, relativePath);
}

function resolveBackupPath(relativePath) {
  return resolveInside(config.documentBackupRoot, relativePath);
}

function encryptionKey() {
  return crypto.createHash('sha256').update(config.documentStorageEncryptionKey).digest();
}

function encryptBuffer(buffer) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([ENCRYPTION_MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

function decryptBuffer(stored) {
  if (!stored.subarray(0, ENCRYPTION_MAGIC.length).equals(ENCRYPTION_MAGIC)) {
    return stored;
  }
  const ivStart = ENCRYPTION_MAGIC.length;
  const tagStart = ivStart + IV_BYTES;
  const dataStart = tagStart + TAG_BYTES;
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), stored.subarray(ivStart, tagStart));
  decipher.setAuthTag(stored.subarray(tagStart, dataStart));
  return Buffer.concat([decipher.update(stored.subarray(dataStart)), decipher.final()]);
}

async function writeFile(relativePath, buffer) {
  const absolutePath = resolveAbsolutePath(relativePath);
  const backupPath = resolveBackupPath(relativePath);
  const stored = encryptBuffer(buffer);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, stored);
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.writeFile(backupPath, stored);
}

async function readFile(relativePath) {
  const absolutePath = resolveAbsolutePath(relativePath);
  const backupPath = resolveBackupPath(relativePath);
  let stored;
  try {
    stored = await fs.readFile(absolutePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    stored = await fs.readFile(backupPath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, stored);
  }
  return decryptBuffer(stored);
}

async function deleteFile(relativePath) {
  const absolutePath = resolveAbsolutePath(relativePath);
  const backupPath = resolveBackupPath(relativePath);
  await Promise.all([absolutePath, backupPath].map(async (p) => {
    try {
      await fs.unlink(p);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }));
}

module.exports = {
  resolveAbsolutePath,
  resolveBackupPath,
  writeFile,
  readFile,
  deleteFile,
};
