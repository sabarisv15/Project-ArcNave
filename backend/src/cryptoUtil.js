'use strict';

// Generic reversible encryption for short secrets-at-rest (e.g. a
// per-college AI provider api_key in college_ai_config). Deliberately
// NOT reusing fileStorage.js's own encryptBuffer/decryptBuffer: those
// are private to that file, and CLAUDE.md rule 2 makes DocumentService
// the sole owner of file storage — reaching into them here would blur
// that ownership boundary for a concern (one short string, not a file)
// that was never file storage's. Same algorithm (AES-256-GCM) and the
// same key-derivation approach (sha256 of a configured passphrase),
// reusing config.documentStorageEncryptionKey as the key material
// since it's already this app's one at-rest-encryption secret —
// provisioning a second one would be an unrequested new secret, not a
// real security improvement.

const crypto = require('crypto');
const config = require('./config');

const IV_BYTES = 12;
const TAG_BYTES = 16;

function encryptionKey() {
  return crypto.createHash('sha256').update(config.documentStorageEncryptionKey).digest();
}

function encryptSecret(plainText) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

function decryptSecret(stored) {
  const buffer = Buffer.from(stored, 'base64');
  const iv = buffer.subarray(0, IV_BYTES);
  const tag = buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const data = buffer.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
