'use strict';

// AI chat-attachment text extraction — a pure "buffer + mimeType in, plain
// text out" module, no DB/identity/audit concerns (those live in aiService.js's
// resolveChatAttachments, same separation documentExtractionService.js already
// keeps between OCR mechanics and the admission-wizard business logic that
// calls it). Distinct from documentSearchService.ingestDocument (RAG
// chunking/embedding for institutional documents) and documentExtractionService
// (OCR-first, for the admission-wizard review/extraction flow) — this module
// exists specifically to turn a fresh AI chat attachment into plain text for
// one turn's prompt, never persisted, never chunked/embedded.
//
// CLAUDE.md rule 9: every extracted string here is untrusted, human-authored
// document content — this module only ever returns text; the caller
// (aiService.buildAttachmentHint) is responsible for boundary-wrapping it
// before it ever reaches an LLM prompt. Nothing here treats extracted content
// as instructions.

const mammoth = require('mammoth');
const { PDFParse, PasswordException } = require('pdf-parse');
const ExcelJS = require('exceljs');
const PizZip = require('pizzip');
const documentExtractionService = require('./documentExtractionService');

const PDF_MIME_TYPE = 'application/pdf';
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const ODT_MIME_TYPE = 'application/vnd.oasis.opendocument.text';
const ODS_MIME_TYPE = 'application/vnd.oasis.opendocument.spreadsheet';
const PLAIN_TEXT_MIME_TYPES = new Set(['text/markdown', 'text/plain', 'text/csv']);

class DocumentTextExtractionUnsupportedTypeError extends Error {}

// A memory backstop only — the real per-turn limit is aiService.js's shared
// ATTACHMENT_TOTAL_CHAR_BUDGET, applied after every attachment in a turn has
// been extracted (this function can't know the eventual per-file share on its
// own). This just stops one pathological single file from holding an
// unbounded string in memory before that budget is ever applied.
const MAX_RAW_EXTRACTED_CHARS = 100_000;

// PDF text-first heuristic thresholds — conservative starting points, not
// exact science: a genuinely scanned/image-only PDF's embedded text layer is
// either completely empty or contains only stray artifacts (form-field
// labels, watermark text), never anything close to a real page of prose.
const MIN_TEXT_LAYER_CHARS = 20;
const MIN_AVG_CHARS_PER_PAGE = 40;

// A tighter, chat-latency-appropriate ceiling than pdfRasterizer's own
// MAX_PAGES=250 (a pure OOM safety ceiling, not a product decision — see that
// file's own comment). An interactive /ai/ask turn should never synchronously
// rasterize+OCR a 200-page scanned document; past this point, degrade
// gracefully instead of making the caller wait minutes.
const MAX_OCR_FALLBACK_PAGES = 30;

const XLSX_MAX_ROWS = 2000;
const ODS_MAX_ROWS = 2000;

// A pure memory/latency backstop, same spirit as XLSX_MAX_ROWS — an
// ordinary deck is a few dozen slides; this only bites a pathological
// upload (still well under MAX_RAW_EXTRACTED_CHARS in practice, since
// slide text is sparse compared to a prose document of the same size).
const PPTX_MAX_SLIDES = 300;

function truncateToMax(text) {
  if (typeof text !== 'string' || text.length <= MAX_RAW_EXTRACTED_CHARS) return text || '';
  return text.slice(0, MAX_RAW_EXTRACTED_CHARS);
}

// Text-first, OCR fallback — never OCR-by-default. An ordinary text-layer
// PDF is fast (no rasterization/Tesseract cost); only a genuinely
// scanned/image-only PDF pays the OCR cost, and only up to
// MAX_OCR_FALLBACK_PAGES.
async function extractPdfText(buffer, { lang } = {}) {
  let parser;
  let result;
  try {
    parser = new PDFParse({ data: buffer });
    result = await parser.getText();
  } catch (err) {
    if (err instanceof PasswordException) {
      return { text: null, failureReason: 'password_protected' };
    }
    return { text: null, failureReason: 'corrupt_or_unreadable' };
  } finally {
    if (parser) await parser.destroy();
  }

  const text = (result.pages || []).map((page) => page.text || '').join('\n\n').trim();
  const numPages = result.total || Math.max((result.pages || []).length, 1);
  const avgCharsPerPage = text.length / Math.max(numPages, 1);
  if (text.length >= MIN_TEXT_LAYER_CHARS && avgCharsPerPage >= MIN_AVG_CHARS_PER_PAGE) {
    return { text: truncateToMax(text), method: 'text_layer' };
  }

  // Empty/near-empty embedded text -> treat as scanned/image-only and fall
  // back to the existing rasterize+OCR path, but only within a chat-turn-
  // appropriate page budget.
  if (numPages > MAX_OCR_FALLBACK_PAGES) {
    return { text: null, failureReason: 'extraction_failed' };
  }
  try {
    const ocr = await documentExtractionService.runOcr(buffer, PDF_MIME_TYPE, { lang });
    return {
      text: truncateToMax(ocr.text || ''), method: 'ocr_fallback', ocrConfidence: ocr.ocrConfidence,
    };
  } catch {
    return { text: null, failureReason: 'extraction_failed' };
  }
}

async function extractDocxText(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return { text: truncateToMax((result.value || '').trim()), method: 'mammoth' };
  } catch (err) {
    const message = (err && err.message) || '';
    if (/password|encrypt/i.test(message)) {
      return { text: null, failureReason: 'password_protected' };
    }
    return { text: null, failureReason: 'corrupt_or_unreadable' };
  }
}

async function extractXlsxText(buffer) {
  let workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
  } catch {
    return { text: null, failureReason: 'corrupt_or_unreadable' };
  }

  const lines = [];
  let rowsWalked = 0;
  for (const worksheet of workbook.worksheets) {
    if (rowsWalked >= XLSX_MAX_ROWS) break;
    lines.push(`# ${worksheet.name}`);
    for (let rowNumber = 1; rowNumber <= worksheet.rowCount && rowsWalked < XLSX_MAX_ROWS; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      if (row.cellCount === 0) continue; // eslint-disable-line no-continue
      const cells = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.value !== null && cell.value !== undefined) cells.push(String(cell.value));
      });
      if (cells.length > 0) lines.push(cells.join(' | '));
      rowsWalked += 1;
    }
  }
  return { text: truncateToMax(lines.join('\n')), method: 'exceljs' };
}

function extractPlainTextDirect(buffer) {
  return { text: truncateToMax(buffer.toString('utf8')), method: 'direct_text' };
}

// Minimal XML entity decoding — the only entities PPTX/ODT/ODS's own
// text runs can legally contain (real XML producers never emit numeric
// character references for these five; anything else stays as literal
// text, since this is extraction of document prose, not a general XML
// parser).
function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripXmlTags(xml) {
  return decodeXmlEntities(xml.replace(/<[^>]+>/g, '')).trim();
}

function openZip(buffer) {
  try {
    return new PizZip(buffer);
  } catch {
    return null;
  }
}

// PPTX has no plain-prose extraction library in this repo (mammoth is
// DOCX-only) — same reasoning documentService.assertValidDocxTemplate
// already established for reading OOXML parts directly via PizZip.
// Slide text lives in ppt/slides/slideN.xml as a series of <a:t> runs
// inside DrawingML text bodies; this pulls every run's text out in
// document order, per slide, without needing a full DrawingML parser
// (this is extraction for LLM context, not layout-faithful rendering).
async function extractPptxText(buffer) {
  const zip = openZip(buffer);
  if (!zip) return { text: null, failureReason: 'corrupt_or_unreadable' };

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = Number(a.match(/slide(\d+)\.xml$/)[1]);
      const numB = Number(b.match(/slide(\d+)\.xml$/)[1]);
      return numA - numB;
    });
  if (slideFiles.length === 0) return { text: null, failureReason: 'corrupt_or_unreadable' };

  try {
    const slideTexts = [];
    slideFiles.slice(0, PPTX_MAX_SLIDES).forEach((name, index) => {
      const xml = zip.file(name).asText();
      const runs = xml.match(/<a:t>([\s\S]*?)<\/a:t>/g) || [];
      const slideText = runs
        .map((run) => decodeXmlEntities(run.replace(/^<a:t>/, '').replace(/<\/a:t>$/, '')))
        .join(' ')
        .trim();
      if (slideText) slideTexts.push(`Slide ${index + 1}\n${slideText}`);
    });
    return { text: truncateToMax(slideTexts.join('\n\n')), method: 'pptx_slides' };
  } catch {
    return { text: null, failureReason: 'corrupt_or_unreadable' };
  }
}

// ODT (OpenDocument Text) — same "open the zip, read content.xml
// directly" approach as PPTX above; no ODF-parsing library exists in
// this repo either. Paragraph text lives in <text:p> elements; nested
// formatting tags (<text:span>, etc.) are stripped rather than parsed,
// since only the prose content matters for LLM context.
async function extractOdtText(buffer) {
  const zip = openZip(buffer);
  if (!zip) return { text: null, failureReason: 'corrupt_or_unreadable' };
  const contentEntry = zip.file('content.xml');
  if (!contentEntry) return { text: null, failureReason: 'corrupt_or_unreadable' };

  try {
    const xml = contentEntry.asText();
    const paragraphs = xml.match(/<text:p[^>]*>[\s\S]*?<\/text:p>/g) || [];
    const lines = paragraphs.map(stripXmlTags).filter(Boolean);
    return { text: truncateToMax(lines.join('\n')), method: 'odt_paragraphs' };
  } catch {
    return { text: null, failureReason: 'corrupt_or_unreadable' };
  }
}

// ODS (OpenDocument Spreadsheet) — same zip/content.xml approach,
// mirroring extractXlsxText's own "walk sheets/rows/cells, join with
// pipes" shape (a data dump for LLM context, not a faithful
// spreadsheet-formula reconstruction). Capped at ODS_MAX_ROWS across
// all sheets combined, same reasoning as XLSX_MAX_ROWS.
async function extractOdsText(buffer) {
  const zip = openZip(buffer);
  if (!zip) return { text: null, failureReason: 'corrupt_or_unreadable' };
  const contentEntry = zip.file('content.xml');
  if (!contentEntry) return { text: null, failureReason: 'corrupt_or_unreadable' };

  try {
    const xml = contentEntry.asText();
    const tables = xml.match(/<table:table[^>]*>[\s\S]*?<\/table:table>/g) || [];
    const lines = [];
    let rowsWalked = 0;
    for (const tableXml of tables) {
      if (rowsWalked >= ODS_MAX_ROWS) break;
      const nameMatch = tableXml.match(/table:name="([^"]*)"/);
      lines.push(`# ${nameMatch ? decodeXmlEntities(nameMatch[1]) : 'Sheet'}`);
      const rows = tableXml.match(/<table:table-row[^>]*>[\s\S]*?<\/table:table-row>/g) || [];
      for (const rowXml of rows) {
        if (rowsWalked >= ODS_MAX_ROWS) break;
        const cells = rowXml.match(/<table:table-cell[^>]*(?:\/>|>[\s\S]*?<\/table:table-cell>)/g) || [];
        const cellTexts = cells.map(stripXmlTags).filter(Boolean);
        if (cellTexts.length > 0) lines.push(cellTexts.join(' | '));
        rowsWalked += 1;
      }
    }
    return { text: truncateToMax(lines.join('\n')), method: 'ods_sheets' };
  } catch {
    return { text: null, failureReason: 'corrupt_or_unreadable' };
  }
}

// mimeType is the server-sniffed value stored on the document row
// (routes/documents.js's sniffing — never the client's declared type), same
// trust boundary every other caller of this pipeline already relies on.
async function extractPlainText(buffer, mimeType, { lang } = {}) {
  if (mimeType === PDF_MIME_TYPE) return extractPdfText(buffer, { lang });
  if (mimeType === DOCX_MIME_TYPE) return extractDocxText(buffer);
  if (mimeType === XLSX_MIME_TYPE) return extractXlsxText(buffer);
  if (mimeType === PPTX_MIME_TYPE) return extractPptxText(buffer);
  if (mimeType === ODT_MIME_TYPE) return extractOdtText(buffer);
  if (mimeType === ODS_MIME_TYPE) return extractOdsText(buffer);
  if (PLAIN_TEXT_MIME_TYPES.has(mimeType)) return extractPlainTextDirect(buffer);
  throw new DocumentTextExtractionUnsupportedTypeError(`mimeType ${JSON.stringify(mimeType)} is not supported for text extraction`);
}

module.exports = {
  DocumentTextExtractionUnsupportedTypeError,
  extractPlainText,
  PDF_MIME_TYPE,
  DOCX_MIME_TYPE,
  XLSX_MIME_TYPE,
  PPTX_MIME_TYPE,
  ODT_MIME_TYPE,
  ODS_MIME_TYPE,
  PLAIN_TEXT_MIME_TYPES,
};
