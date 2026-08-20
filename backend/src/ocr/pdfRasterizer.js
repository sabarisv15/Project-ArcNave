'use strict';

// A pure function, same restraint as ocr/tesseractOcr.js/
// generators/templateMerger.js (Architecture.md 2.6 / ADR-008): no
// database access, no business rules, no permissions. The one place
// this codebase knows poppler-utils' pdftoppm CLI shape — a system
// dependency (see backend/Dockerfile), not an npm package, since no
// pure-JS pdftoppm equivalent exists that doesn't itself wrap the same
// native binary.
//
// Storage discipline: this function DOES touch the filesystem (a temp
// dir under os.tmpdir(), never config.documentStorageRoot), but only
// as a scratch workspace for pdftoppm's own file-based CLI contract
// (it has no stdin/stdout streaming mode for multi-page output) —
// never DocumentService's permanent storage, and never anything this
// file itself decides to keep. The temp dir is always removed in a
// `finally`, success or failure, so no rasterized intermediate ever
// outlives this one call. CLAUDE.md rule 2 (DocumentService is the
// sole owner of persisted files) is untouched: nothing produced here
// is ever written to permanent storage by this function — a caller
// (documentSearchService.js) only ever reads the returned buffers into
// memory for OCR, never persists them itself either.
//
// execFile, not exec: argv is passed as a real array, never
// shell-interpolated — the input is a caller-supplied PDF buffer
// written to a path THIS function generates (crypto-random temp dir
// name), never a caller-supplied path or filename, so there is no
// injection surface here to begin with, but execFile is still the
// correct default over a shell string.

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

// A hand-written Promise wrapper, deliberately NOT util.promisify(
// childProcess.execFile): Node's built-in execFile carries its own
// [util.promisify.custom] symbol, which promisify prefers over the
// plain callback form — and that symbol's value is a closure over the
// REAL native execFile, bypassing any t.mock.method replacement on the
// childProcess.execFile property entirely (confirmed the hard way: a
// mocked test still spawned a real pdftoppm process and failed with
// ENOENT). Calling childProcess.execFile(...) directly here, as a live
// property lookup, is what actually makes this mockable the same way
// every other dependency in this codebase already is.
function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(command, args, options, (err, stdout, stderr) => {
      if (err) reject(err); else resolve({ stdout, stderr });
    });
  });
}

class PdfRasterizationError extends Error {}

// -r 200: 200 DPI — high enough for Tesseract to read ordinary printed
// text reliably without producing unreasonably large PNGs per page.
const RASTER_DPI = '200';

// Pre-launch audit finding (P1): pdftoppm ran with no timeout and no
// page-count ceiling — a hung/malformed PDF could block this call
// forever while holding a pooled DB connection (see
// db/tenantTransaction.js's own idle_in_transaction_session_timeout,
// set to 90s specifically to sit above this 60s so Postgres never
// kills that connection out from under a still-legitimately-running
// rasterization), and rasterizePdfToImages holds every page's PNG
// buffer in memory simultaneously (see the loop below), so an
// unbounded page count is an unbounded memory footprint.
//
// EXEC_TIMEOUT_MS: 60s — generous above any real single-document
// rasterization (poppler processes a typical multi-page document in
// well under a second per page), tight enough that a hung/malformed
// PDF is reclaimed within one request's realistic patience budget.
//
// MAX_PAGES: a conservative TECHNICAL SAFETY CEILING against
// out-of-memory, not a product decision about how many pages a real
// document may have — that decision needs real evidence this
// pre-launch pass doesn't have (see the audit's own review comment:
// "protect the server first, then choose the product limit from
// evidence"). The number itself IS evidence-based, not guessed:
// measured directly against this exact pdftoppm/poppler build (`docker
// run gstack-app:latest`) at RASTER_DPI=200 — a single A4 page with
// dense mixed text/shape content (a reasonable proxy for a busy
// document, not a sparse one) rasterized to ~650KB as a PNG. A
// maximally adversarial/photographic page could compress far less
// well; the mathematical ceiling for any 200 DPI A4 PNG is
// 1654x2339x3 bytes =~ 11.6MB raw (PNG cannot exceed uncompressed
// size). Budgeting 3MB/page — comfortably above the measured
// mixed-content figure, comfortably below the raw ceiling, matching
// the commonly-cited range for real full-color document scans — against
// an 750MB peak-memory budget for ONE rasterization call (leaving
// headroom on a modest droplet for the OCR_CONCURRENCY_LIMIT=2 worth of
// simultaneous calls plus the rest of the Node process and Postgres)
// gives 750/3 =~ 250 pages, rounded down to a clean number.
const EXEC_TIMEOUT_MS = 60_000;
const MAX_PAGES = 250;

function pageNumberFromFileName(fileName) {
  const match = fileName.match(/-(\d+)\.png$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

// Returns one PNG Buffer per page, in page order. Never writes
// anything outside its own temp dir, and always removes that temp dir
// before returning or throwing.
async function rasterizePdfToImages(pdfBuffer) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arcnave-pdf-ocr-'));
  try {
    const inputPath = path.join(tempDir, `${crypto.randomBytes(8).toString('hex')}.pdf`);
    await fs.writeFile(inputPath, pdfBuffer);
    const outputPrefix = path.join(tempDir, 'page');

    try {
      // -l MAX_PAGES: stop producing pages past the safety ceiling
      // rather than erroring — a document under the ceiling is
      // completely unaffected; one over it simply gets its first
      // MAX_PAGES pages processed instead of hanging the process or
      // exhausting memory, same "truncate the worst case, don't crash"
      // reasoning the repository-level LIMITs elsewhere in this
      // codebase already use.
      await execFileAsync(
        'pdftoppm',
        ['-png', '-r', RASTER_DPI, '-l', String(MAX_PAGES), inputPath, outputPrefix],
        { timeout: EXEC_TIMEOUT_MS },
      );
    } catch (err) {
      throw new PdfRasterizationError(`pdftoppm failed: ${err.message}`);
    }

    const fileNames = (await fs.readdir(tempDir))
      .filter((name) => name.endsWith('.png'))
      .sort((a, b) => pageNumberFromFileName(a) - pageNumberFromFileName(b));

    if (fileNames.length === 0) {
      throw new PdfRasterizationError('pdftoppm produced no page images — the PDF may be empty or corrupt');
    }

    const pages = [];
    for (const fileName of fileNames) {
      // eslint-disable-next-line no-await-in-loop
      pages.push(await fs.readFile(path.join(tempDir, fileName)));
    }
    return pages;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  PdfRasterizationError, rasterizePdfToImages, EXEC_TIMEOUT_MS, MAX_PAGES,
};
