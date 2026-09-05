'use strict';

// Tenant-scoped storage cleanup.
//
// Three integration files write real bytes through fileStorage into the
// one shared DOCUMENT_STORAGE_ROOT (documents.test.js,
// documents-chat-attachments.test.js, reports.test.js). Each used to
// empty that root wholesale in its own t.after() — which is correct
// when a file runs alone and wrong under `node --test tests/`, where
// those files run as concurrent processes against the same directory:
// whichever finished first deleted the files the others were still
// uploading, reading back and OCR-ing, so an unrelated suite went red
// with no defect of its own. That is the cross-suite shared state
// behind the intermittent full-run failures.
//
// Every path fileStorage builds is tenant-prefixed
// (fileStorage.buildStoragePath/buildDraftStoragePath — collegeId is
// always the first segment, sanitized to alnum/dash/underscore), so
// deleting `<root>/<collegeId>` removes exactly what one file created
// and nothing another file owns. Same for the backup root, which
// mirrors the same relative paths.
//
// Deletes the collegeId subtree, never the root itself: the root is a
// Docker volume mount point (docker-compose.yml's document_storage
// volume) and can't be rmdir'd from inside the container — the reason
// the original teardowns emptied it entry-by-entry rather than removing
// it. That constraint is untouched here; only the blast radius shrinks.

const fs = require('node:fs/promises');
const path = require('node:path');
const config = require('../../src/config');

function sanitizeSegment(value) {
  return String(value == null ? '' : value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function cleanupCollegeStorage(...collegeIds) {
  const ids = collegeIds.flat().filter(Boolean).map(sanitizeSegment);
  const roots = [config.documentStorageRoot, config.documentBackupRoot].filter(Boolean);
  await Promise.all(
    roots.flatMap((root) => ids.map((id) => fs.rm(path.join(root, id), { recursive: true, force: true }))),
  );
}

module.exports = { cleanupCollegeStorage };
