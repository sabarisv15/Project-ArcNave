'use strict';

// Storage dispatch layer for DocumentService (ADR-017; Stage 8a /
// RS-GOV-013 — was local-disk-only, now a thin dispatcher over
// storageProviderRegistry.js). No DB, no business logic, no
// permissions — same as before. Used only by documentService.js:
// ADR-009 gives DocumentService sole ownership of file storage, so
// nothing else in this codebase may require this module.
//
// Paths are always tenant-prefixed (Architecture.md 2.9) and never
// trust caller-supplied segments verbatim — sanitizeFileName strips
// anything that isn't alnum/dot/dash/underscore from the file name
// itself, and sanitizePathSegment strips anything that isn't
// alnum/dash/underscore from every OTHER segment (collegeId, studentId,
// docType, draftId), closing the directory-traversal door
// (`../../etc/passwd`-style names, or a `docType` crafted to land
// inside a DIFFERENT tenant's own collegeId prefix) at the one place
// paths are built, not relied on elsewhere. Path-building stays
// provider-agnostic (every provider stores at the same relative path
// shape) — only writeFile/readFile/deleteFile dispatch to a specific
// provider.
//
// providerName is optional and defaults to the registry's own
// DEFAULT_PROVIDER_NAME ('local_disk') — every caller that doesn't yet
// resolve a per-college provider (the draft-admission-document path;
// see documentService.js's own comment on why that path stays DB-free)
// keeps working unchanged. A caller that DOES have a DB client/collegeId
// in scope (documentService.js's real-document read/write paths)
// resolves the college's actual configured provider first and passes
// it through.

const path = require('path');
const crypto = require('crypto');
const storageProviderRegistry = require('./storageProviderRegistry');

function sanitizeFileName(fileName) {
  const base = path.basename(fileName || 'file');
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

// Every OTHER path segment (collegeId, studentId, docType, draftId) is a
// single directory name, never a nested path — unlike fileName, it has
// no legitimate reason to contain '.', '/', or '\', so those (and
// anything else outside alnum/dash/underscore) are stripped outright
// rather than escaped. This is what actually closes the
// directory-traversal door this file's header comment already claimed
// was closed: sanitizeFileName alone never protected these segments,
// and path.posix.join happily collapses a caller-supplied
// '../../otherCollegeId' segment into a path that lands OUTSIDE the
// caller's own collegeId prefix (still inside the storage root, so
// localDiskProvider's resolveInside never sees it — a same-root,
// cross-tenant write). Falls back to a fixed, harmless literal rather
// than throwing: every call site already validates these fields are
// present before calling in (documentService.js's own "required"
// checks), so an empty result here only happens if a caller's own
// value sanitizes to nothing (e.g. a value that was ONLY '../' — most
// likely an attack attempt, not a legitimate empty field), and a fixed
// literal segment is a safer default than surfacing the raw error.
function sanitizePathSegment(value, fallback) {
  const cleaned = String(value == null ? '' : value).replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned || fallback;
}

// {collegeId}/{studentId}/{docType}/{timestamp}-{random}-{fileName} —
// the timestamp+random pair guarantees two versions of the same
// doc_type never collide on disk (documentRepository has no unique
// constraint blocking multiple uploads of the same type; storage_path
// must be equally collision-free, or the second upload would
// overwrite the first version's bytes on disk while the DB still had
// two distinct rows pointing at the same now-corrupted file).
//
// studentId is optional (documents.student_id is nullable as of
// 1752800000000, for non-student files like generated reports) — a
// missing studentId uses a fixed 'shared' path segment instead of
// path.posix.join silently coercing undefined to the string
// "undefined".
function buildStoragePath({ collegeId, studentId, docType, fileName }) {
  const unique = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  return path.posix.join(
    sanitizePathSegment(collegeId, 'college'),
    sanitizePathSegment(studentId, 'shared'),
    sanitizePathSegment(docType, 'unknown'),
    `${unique}-${sanitizeFileName(fileName)}`,
  );
}

// Create Student admission wizard — draft documents live under
// {collegeId}/drafts/{draftId}/{docType}/... instead of the student-scoped
// path buildStoragePath builds, since no real studentId exists yet at
// upload time (documentService.js's own comment: student_id is immutable
// once a real `documents` row is created, so a draft never gets one of
// those rows — see storeDraftAdmissionDocument). Same collision-free
// timestamp+random suffix as buildStoragePath.
function buildDraftStoragePath({ collegeId, draftId, docType, fileName }) {
  const unique = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  return path.posix.join(
    sanitizePathSegment(collegeId, 'college'),
    'drafts',
    sanitizePathSegment(draftId, 'draft'),
    sanitizePathSegment(docType, 'unknown'),
    `${unique}-${sanitizeFileName(fileName)}`,
  );
}

// resolveAbsolutePath/resolveBackupPath are local_disk-specific
// concepts (no other provider has "a path on this host") — kept here
// only as a passthrough to the default provider, for
// file-storage.test.js's existing direct assertions against on-disk
// bytes. Not part of the provider contract; a future non-local
// provider has no equivalent and doesn't need one.
function resolveAbsolutePath(relativePath) {
  return storageProviderRegistry.getProvider(storageProviderRegistry.DEFAULT_PROVIDER_NAME)
    .resolveAbsolutePath(relativePath);
}

function resolveBackupPath(relativePath) {
  return storageProviderRegistry.getProvider(storageProviderRegistry.DEFAULT_PROVIDER_NAME)
    .resolveBackupPath(relativePath);
}

async function writeFile(relativePath, buffer, { providerName = storageProviderRegistry.DEFAULT_PROVIDER_NAME } = {}) {
  return storageProviderRegistry.getProvider(providerName).writeFile(relativePath, buffer);
}

async function readFile(relativePath, { providerName = storageProviderRegistry.DEFAULT_PROVIDER_NAME } = {}) {
  return storageProviderRegistry.getProvider(providerName).readFile(relativePath);
}

// Draft-only: a real `documents` row's bytes are NEVER deleted (this
// file's own header comment — retention) even when the row is
// soft-deleted. A draft is different — it can be genuinely abandoned
// before it ever becomes a real document, so this is the one place a
// hard file delete is legitimate.
async function deleteFile(relativePath, { providerName = storageProviderRegistry.DEFAULT_PROVIDER_NAME } = {}) {
  return storageProviderRegistry.getProvider(providerName).deleteFile(relativePath);
}

module.exports = {
  buildStoragePath,
  buildDraftStoragePath,
  resolveAbsolutePath,
  resolveBackupPath,
  writeFile,
  readFile,
  deleteFile,
};
