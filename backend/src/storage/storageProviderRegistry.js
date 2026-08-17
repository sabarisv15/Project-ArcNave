'use strict';

// Stage 8a / RS-GOV-013: "a college MAY instead point at its own
// storage" — this registry is the one place that decision resolves to
// real code. Today it holds exactly one provider (local_disk); adding
// a real second one (SFTP, Azure, S3) is adding a module here that
// implements the same {writeFile, readFile, deleteFile} contract as
// localDiskProvider.js and a new entry in PROVIDERS below — never a
// change to fileStorage.js's dispatch logic or to documentService.js
// (ADR-009/CLAUDE.md rule 2 — DocumentService's sole ownership of file
// storage is unaffected either way, it still only ever talks to
// fileStorage.js).
//
// Every provider must implement:
//   writeFile(relativePath, buffer) -> Promise<void>
//   readFile(relativePath) -> Promise<Buffer>
//   deleteFile(relativePath) -> Promise<void>
// Encryption-at-rest, backup/self-heal, and path-traversal guarding are
// each provider's own concern (RS-DAT-005's "encryption at rest" is
// host/volume-level by default, but a provider MAY still choose to
// encrypt in transit/at rest itself, as local_disk already does).

const localDiskProvider = require('./providers/localDiskProvider');

const DEFAULT_PROVIDER_NAME = 'local_disk';

const PROVIDERS = {
  local_disk: localDiskProvider,
};

// getConfiguration({category: 'storage'}) named a provider this
// registry has never heard of (a typo, or a name from a future
// ARCNAVE version this install hasn't been upgraded to yet) — never
// silently falls back to local_disk, that would resubmit the exact
// "value nobody reads" mistake storage_tier was.
class StorageProviderNotAvailableError extends Error {}

function getProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new StorageProviderNotAvailableError(`storage provider ${JSON.stringify(name)} is not available`);
  }
  return provider;
}

function listProviderNames() {
  return Object.keys(PROVIDERS);
}

module.exports = {
  DEFAULT_PROVIDER_NAME,
  StorageProviderNotAvailableError,
  getProvider,
  listProviderNames,
};
