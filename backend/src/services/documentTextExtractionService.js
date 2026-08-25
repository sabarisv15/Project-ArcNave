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
const { Readable } = require('stream');
const documentExtractionService = require('./documentExtractionService');

const PDF_MIME_TYPE = 'application/pdf';
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const ODT_MIME_TYPE = 'application/vnd.oasis.opendocument.text';
const ODS_MIME_TYPE = 'application/vnd.oasis.opendocument.spreadsheet';
const CSV_MIME_TYPE = 'text/csv';
// Kept listing text/csv so callers' existing "is this a plain-text type I
// can attach?" checks are unchanged — extractPlainText below now routes it
// to a real CSV parser rather than to extractPlainTextDirect, but it is
// still a plain-text upload as far as every caller is concerned.
const PLAIN_TEXT_MIME_TYPES = new Set(['text/markdown', 'text/plain', CSV_MIME_TYPE]);

class DocumentTextExtractionUnsupportedTypeError extends Error {}

// A memory backstop only — the real per-turn limit is aiService.js's shared
// ATTACHMENT_TOTAL_CHAR_BUDGET, applied after every attachment in a turn has
// been extracted (this function can't know the eventual per-file share on its
// own). This just stops one pathological single file from holding an
// unbounded string in memory before that budget is ever applied. Sized for
// Gemini's 1M-token context window (~4 chars/token) — see
// ATTACHMENT_TOTAL_CHAR_BUDGET's comment for the full per-provider caveat.
const MAX_RAW_EXTRACTED_CHARS = 1_000_000;

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
    // pages: exposed so a caller (aiService's native-vs-text cost
    // decision) can estimate Gemini's native PDF-vision token cost
    // (~flat per page) without re-parsing the PDF itself.
    return { text: truncateToMax(text), method: 'text_layer', pages: numPages };
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

// mammoth.extractRawText flattens a table cell into its own paragraph, so a
// six-column row arrives as six separate lines and the 2D structure is gone
// before any table detector can see it — measured, and the reason a DOCX
// containing a real table yielded strategy 'none'. It cannot be recovered
// downstream; it has to not be lost here.
//
// convertToHtml keeps <table>/<tr>/<td>, so table rows are emitted joined
// with ' | ' (the same shape extractXlsxText produces) and consumed by the
// existing "delimited" strategy unchanged. The HTML is converted to text
// here rather than handed on — this pipeline's contract is plain text, and
// the CDR stays structural-only either way (ADR-029): a cell boundary is
// structure, not a semantic field label.
const DOCX_TABLE_MARKER = /<w:tbl[\s>]/;

function docxHasTable(buffer) {
  const zip = openZip(buffer);
  if (!zip) return false;
  const entry = zip.file('word/document.xml');
  if (!entry) return false;
  try {
    return DOCX_TABLE_MARKER.test(entry.asText());
  } catch {
    return false;
  }
}

function htmlToLines(html) {
  const lines = [];
  // Tables first, then the prose between/around them, each in document
  // order — a single pass over the top-level blocks mammoth emits.
  const blocks = html.split(/(<table[\s\S]*?<\/table>)/);
  blocks.forEach((block) => {
    if (!block) return;
    if (block.startsWith('<table')) {
      const rows = block.match(/<tr[\s\S]*?<\/tr>/g) || [];
      rows.forEach((rowHtml) => {
        const cells = (rowHtml.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || [])
          .map((cellHtml) => stripXmlTags(cellHtml).replace(/\s+/g, ' ').trim());
        if (cells.some((c) => c !== '')) lines.push(cells.join(' | '));
      });
      return;
    }
    const paragraphs = block.match(/<p[\s\S]*?<\/p>/g) || [];
    paragraphs.forEach((paragraphHtml) => {
      const text = stripXmlTags(paragraphHtml).replace(/[ \t]+/g, ' ').trim();
      if (text) lines.push(text);
    });
  });
  return lines;
}

async function extractDocxText(buffer) {
  try {
    // A DOCX with no table at all takes the original path untouched, so
    // ordinary prose documents produce byte-identical output to before
    // this change — the table work can only ever affect documents that
    // actually have a table.
    if (!docxHasTable(buffer)) {
      const raw = await mammoth.extractRawText({ buffer });
      return { text: truncateToMax((raw.value || '').trim()), method: 'mammoth' };
    }
    const result = await mammoth.convertToHtml({ buffer });
    const lines = htmlToLines(result.value || '');
    if (lines.length === 0) {
      const raw = await mammoth.extractRawText({ buffer });
      return { text: truncateToMax((raw.value || '').trim()), method: 'mammoth' };
    }
    return { text: truncateToMax(lines.join('\n')), method: 'mammoth_tables' };
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

// CSV goes through a real CSV parser, not a line/comma split, and comes out
// in exactly the same ' | '-joined row shape extractXlsxText produces — so
// documentTableExtractionService's existing "delimited" strategy consumes
// it with no change at all. Before this, text/csv fell through to
// extractPlainTextDirect and every CSV attachment reached that detector as
// undelimited prose, yielding strategy 'none' and no deterministic
// analysis whatsoever.
//
// Parsed rather than split because a comma inside a quoted cell
// ("ANBARASAN V, Jr.") is a real, ordinary case that a split silently gets
// wrong, and getting a cell boundary wrong here means getting a count
// wrong later. ExcelJS is already this file's XLSX dependency, so this
// adds no new package and reuses a parser already trusted for the same job.
async function extractCsvText(buffer) {
  let worksheet;
  try {
    const workbook = new ExcelJS.Workbook();
    worksheet = await workbook.csv.read(Readable.from([buffer.toString('utf8')]));
  } catch {
    // Never worse than the previous behaviour: an unparseable CSV still
    // reaches the caller as its own raw text rather than as a failure.
    return extractPlainTextDirect(buffer);
  }
  if (!worksheet) return extractPlainTextDirect(buffer);

  const lines = [];
  let rowsWalked = 0;
  worksheet.eachRow((row) => {
    if (rowsWalked >= XLSX_MAX_ROWS) return;
    const cells = [];
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.value !== null && cell.value !== undefined) cells.push(String(cell.value));
    });
    if (cells.length > 0) lines.push(cells.join(' | '));
    rowsWalked += 1;
  });
  if (lines.length === 0) return extractPlainTextDirect(buffer);
  return { text: truncateToMax(lines.join('\n')), method: 'exceljs_csv' };
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
  if (mimeType === CSV_MIME_TYPE) return extractCsvText(buffer);
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
  CSV_MIME_TYPE,
  PLAIN_TEXT_MIME_TYPES,
};
