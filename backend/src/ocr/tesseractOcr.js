'use strict';

// A pure function, same restraint as generators/templateMerger.js/
// csvGenerator.js etc (Architecture.md 2.6 / ADR-008): no database
// access, no storage access, no business rules, no permissions. Wraps
// tesseract.js's own recognize() call — the one place this codebase
// knows Tesseract's specific API shape, so a future OCR engine swap
// means changing this file alone, same "provider-specific shape lives
// only in this file" convention services/aiProviders/nim.js already
// follows for its own vendor.
//
// Image mime types only (png/jpeg/bmp/tiff) — tesseract.js recognizes
// raster images directly; it has no built-in PDF page rasterizer, and
// this project has no PDF-to-image dependency installed (adding one
// — poppler/ImageMagick-backed — is a real, separate piece of new
// infrastructure, not something to bolt on silently here). A PDF
// upload is therefore still refused by documentSearchService.js's own
// mime-type gate, a real flagged gap, not silently mis-OCR'd.

const Tesseract = require('tesseract.js');

class OcrExtractionError extends Error {}

// lang defaults to 'eng' (this function's own prior behavior, unchanged
// for every existing caller that doesn't pass one) — Tesseract's own
// '+'-joined syntax (e.g. 'eng+tam') selects multiple language packs.
// documentExtractionService.js resolves the configured language via
// ConfigurationService before calling this; passing a second language
// here is a one-line change, but Tesseract.js fetches any traineddata
// it doesn't already have from its own CDN at runtime (no langPath/
// TESSDATA_PREFIX bundling configured anywhere in this repo) — a real
// deployment dependency (network access, or pre-bundled trained data),
// not something this function can guarantee on its own.
//
// result.data.confidence (0-100, Tesseract's own average word
// confidence) is now returned alongside the text — previously computed
// by Tesseract on every call but discarded; documentExtractionService's
// overallConfidence formula needs it.
async function extractTextFromImage(buffer, lang = 'eng') {
  let result;
  try {
    result = await Tesseract.recognize(buffer, lang);
  } catch (err) {
    throw new OcrExtractionError(`Tesseract OCR failed: ${err.message}`);
  }
  const text = result && result.data && typeof result.data.text === 'string' ? result.data.text : '';
  const confidence = result && result.data && typeof result.data.confidence === 'number' ? result.data.confidence : 0;
  return { text: text.trim(), confidence };
}

module.exports = { OcrExtractionError, extractTextFromImage };
