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
function execFileAsync(command, args) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(command, args, (err, stdout, stderr) => {
      if (err) reject(err); else resolve({ stdout, stderr });
    });
  });
}

class PdfRasterizationError extends Error {}

// -r 200: 200 DPI — high enough for Tesseract to read ordinary printed
// text reliably without producing unreasonably large PNGs per page.
const RASTER_DPI = '200';

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
      await execFileAsync('pdftoppm', ['-png', '-r', RASTER_DPI, inputPath, outputPrefix]);
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

module.exports = { PdfRasterizationError, rasterizePdfToImages };
