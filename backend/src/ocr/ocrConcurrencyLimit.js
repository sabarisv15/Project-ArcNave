'use strict';

// A minimal in-process counting semaphore — no new dependency, no
// distributed queue. Redis/BullMQ/a dedicated worker pool are
// explicitly usage-volume-gated elsewhere in this codebase (see
// CHECKPOINT.md), not built speculatively; this is the smallest real
// fix for the actual, immediate risk found in the pre-launch audit
// (F6-3): every real OCR entry point (documentExtractionService.runOcr,
// documentSearchService.js's ingestion) spawns a pdftoppm/Tesseract
// process per call with zero concurrency control — N simultaneous
// OCR-triggering requests spawn N simultaneous heavy child processes.
//
// OCR_CONCURRENCY_LIMIT = 2: deliberately modest for a single-process,
// modest-droplet deployment (CHECKPOINT.md's staged-infra notes) — OCR
// and PDF rasterization are both CPU- and memory-heavy (see
// pdfRasterizer.js's own MAX_PAGES comment for the measured per-page
// memory reasoning behind that number). 2 leaves real headroom for the
// rest of the Node process and Postgres while still letting more than
// one request make progress at once instead of fully serializing every
// document upload college-wide.

const OCR_CONCURRENCY_LIMIT = 2;

let active = 0;
const queue = [];

function release() {
  active -= 1;
  const next = queue.shift();
  if (next) {
    active += 1;
    next();
  }
}

function acquire() {
  if (active < OCR_CONCURRENCY_LIMIT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

// Runs `fn` once a slot is free; excess callers queue in-process (FIFO)
// rather than all firing their own pdftoppm/Tesseract process at once.
async function withOcrSlot(fn) {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

module.exports = { withOcrSlot, OCR_CONCURRENCY_LIMIT };
