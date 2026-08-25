'use strict';

// Unit tests for documentTextExtractionService.js — real extraction against
// real, minimal PDF/DOCX/XLSX buffers generated in-test (via pdfkit/docx/
// exceljs, all already dependencies), never live HTTP/DB. Focused on:
// correction 1 (PDF text-first, OCR fallback only for a genuinely empty text
// layer, mocked so no real Tesseract run is needed here), the per-format
// dispatch, and the unsupported-type rejection.

const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph } = require('docx');
const ExcelJS = require('exceljs');
const PizZip = require('pizzip');
const documentTextExtractionService = require('../src/services/documentTextExtractionService');
const { extractRecords } = require('../src/services/documentTableExtractionService');
const documentExtractionService = require('../src/services/documentExtractionService');

function buildPdfBuffer(text) {
  return new Promise((resolve) => {
    const chunks = [];
    const doc = new PDFDocument();
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    if (text) doc.text(text);
    doc.end();
  });
}

async function buildDocxBuffer(text) {
  const doc = new Document({ sections: [{ children: [new Paragraph(text)] }] });
  return Packer.toBuffer(doc);
}

async function buildXlsxBuffer(rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');
  rows.forEach((row) => worksheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// Minimal but real OOXML/ODF zip containers — mirrors the exact internal
// parts extractPptxText/extractOdtText/extractOdsText actually read
// (ppt/slides/slideN.xml's <a:t> runs, content.xml's <text:p>/
// <table:table-cell> elements), not full valid Office/ODF documents.
function buildPptxBuffer(slideTexts) {
  const zip = new PizZip();
  zip.file('ppt/presentation.xml', '<presentation/>');
  slideTexts.forEach((text, index) => {
    zip.file(
      `ppt/slides/slide${index + 1}.xml`,
      `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
  });
  return zip.generate({ type: 'nodebuffer' });
}

function buildOdtBuffer(paragraphs) {
  const zip = new PizZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text');
  const body = paragraphs.map((p) => `<text:p>${p}</text:p>`).join('');
  zip.file('content.xml', `<office:document-content><office:body><office:text>${body}</office:text></office:body></office:document-content>`);
  return zip.generate({ type: 'nodebuffer' });
}

function buildOdsBuffer(sheetName, rows) {
  const zip = new PizZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.spreadsheet');
  const rowsXml = rows.map((row) => {
    const cells = row.map((value) => `<table:table-cell><text:p>${value}</text:p></table:table-cell>`).join('');
    return `<table:table-row>${cells}</table:table-row>`;
  }).join('');
  zip.file(
    'content.xml',
    `<office:document-content><office:body><office:spreadsheet><table:table table:name="${sheetName}">${rowsXml}</table:table></office:spreadsheet></office:body></office:document-content>`,
  );
  return zip.generate({ type: 'nodebuffer' });
}

test('extractPlainText: an ordinary text-layer PDF is extracted via the fast text_layer path, never touching OCR', async (t) => {
  const runOcrMock = t.mock.method(documentExtractionService, 'runOcr', async () => {
    throw new Error('runOcr must never be called for a real text-layer PDF');
  });
  const buffer = await buildPdfBuffer('This is a real text-layer PDF with plenty of readable characters per page.');
  const result = await documentTextExtractionService.extractPlainText(buffer, documentTextExtractionService.PDF_MIME_TYPE);
  assert.equal(result.method, 'text_layer');
  assert.match(result.text, /real text-layer PDF/);
  assert.equal(runOcrMock.mock.calls.length, 0);
});

test('extractPlainText: correction 1 — a PDF with an empty/near-empty text layer (e.g. scanned) falls back to OCR, mocked here to avoid a real Tesseract run', async (t) => {
  t.mock.method(documentExtractionService, 'runOcr', async () => ({ text: 'OCR-recovered text.', ocrConfidence: 91 }));
  const blankBuffer = await buildPdfBuffer(null); // no .text() call -> empty embedded text layer
  const result = await documentTextExtractionService.extractPlainText(blankBuffer, documentTextExtractionService.PDF_MIME_TYPE);
  assert.equal(result.method, 'ocr_fallback');
  assert.equal(result.text, 'OCR-recovered text.');
});

test('extractPlainText: a corrupt/non-PDF buffer claimed as application/pdf degrades to corrupt_or_unreadable, never throws', async () => {
  const result = await documentTextExtractionService.extractPlainText(Buffer.from('not a real pdf'), documentTextExtractionService.PDF_MIME_TYPE);
  assert.equal(result.text, null);
  assert.equal(result.failureReason, 'corrupt_or_unreadable');
});

test('extractPlainText: a real DOCX is extracted via mammoth', async () => {
  const buffer = await buildDocxBuffer('Hello from a real docx document.');
  const result = await documentTextExtractionService.extractPlainText(buffer, documentTextExtractionService.DOCX_MIME_TYPE);
  assert.equal(result.method, 'mammoth');
  assert.equal(result.text, 'Hello from a real docx document.');
});

test('extractPlainText: a corrupt DOCX degrades to corrupt_or_unreadable, never throws', async () => {
  const result = await documentTextExtractionService.extractPlainText(Buffer.from('not a real docx'), documentTextExtractionService.DOCX_MIME_TYPE);
  assert.equal(result.text, null);
  assert.equal(result.failureReason, 'corrupt_or_unreadable');
});

test('extractPlainText: a real XLSX is extracted via exceljs, sheet name + cells joined into readable lines', async () => {
  const buffer = await buildXlsxBuffer([['name', 'marks'], ['Ravi', 92], ['Meena', 88]]);
  const result = await documentTextExtractionService.extractPlainText(buffer, documentTextExtractionService.XLSX_MIME_TYPE);
  assert.equal(result.method, 'exceljs');
  assert.match(result.text, /Sheet1/);
  assert.match(result.text, /Ravi \| 92/);
  assert.match(result.text, /Meena \| 88/);
});

test('extractPlainText: a corrupt XLSX degrades to corrupt_or_unreadable, never throws', async () => {
  const result = await documentTextExtractionService.extractPlainText(Buffer.from('not a real xlsx'), documentTextExtractionService.XLSX_MIME_TYPE);
  assert.equal(result.text, null);
  assert.equal(result.failureReason, 'corrupt_or_unreadable');
});

test('extractPlainText: a real PPTX has its slide text runs extracted in slide order', async () => {
  const buffer = buildPptxBuffer(['First slide text.', 'Second slide text.']);
  const result = await documentTextExtractionService.extractPlainText(buffer, documentTextExtractionService.PPTX_MIME_TYPE);
  assert.equal(result.method, 'pptx_slides');
  assert.match(result.text, /Slide 1\nFirst slide text\./);
  assert.match(result.text, /Slide 2\nSecond slide text\./);
});

test('extractPlainText: a corrupt/non-PPTX buffer degrades to corrupt_or_unreadable, never throws', async () => {
  const result = await documentTextExtractionService.extractPlainText(Buffer.from('not a real pptx'), documentTextExtractionService.PPTX_MIME_TYPE);
  assert.equal(result.text, null);
  assert.equal(result.failureReason, 'corrupt_or_unreadable');
});

test('extractPlainText: a real ODT has its paragraphs extracted, joined by newline', async () => {
  const buffer = buildOdtBuffer(['Paragraph one.', 'Paragraph two.']);
  const result = await documentTextExtractionService.extractPlainText(buffer, documentTextExtractionService.ODT_MIME_TYPE);
  assert.equal(result.method, 'odt_paragraphs');
  assert.equal(result.text, 'Paragraph one.\nParagraph two.');
});

test('extractPlainText: a corrupt/non-ODT buffer degrades to corrupt_or_unreadable, never throws', async () => {
  const result = await documentTextExtractionService.extractPlainText(Buffer.from('not a real odt'), documentTextExtractionService.ODT_MIME_TYPE);
  assert.equal(result.text, null);
  assert.equal(result.failureReason, 'corrupt_or_unreadable');
});

test('extractPlainText: a real ODS has its sheet name + cells joined into readable lines', async () => {
  const buffer = buildOdsBuffer('Sheet1', [['name', 'marks'], ['Ravi', '92'], ['Meena', '88']]);
  const result = await documentTextExtractionService.extractPlainText(buffer, documentTextExtractionService.ODS_MIME_TYPE);
  assert.equal(result.method, 'ods_sheets');
  assert.match(result.text, /Sheet1/);
  assert.match(result.text, /Ravi \| 92/);
  assert.match(result.text, /Meena \| 88/);
});

test('extractPlainText: a corrupt/non-ODS buffer degrades to corrupt_or_unreadable, never throws', async () => {
  const result = await documentTextExtractionService.extractPlainText(Buffer.from('not a real ods'), documentTextExtractionService.ODS_MIME_TYPE);
  assert.equal(result.text, null);
  assert.equal(result.failureReason, 'corrupt_or_unreadable');
});

// csv is deliberately no longer in this set's behaviour — it is still a
// PLAIN_TEXT_MIME_TYPES member (callers' "can I attach this?" checks are
// unchanged) but extractPlainText now routes it to a real CSV parser, so
// that a CSV attachment reaches documentTableExtractionService as a table
// instead of as undelimited prose. See the csv test below.
test('extractPlainText: markdown/plain pass through as direct UTF-8 text, no library involved', async () => {
  for (const mimeType of ['text/markdown', 'text/plain']) {
    // eslint-disable-next-line no-await-in-loop
    const result = await documentTextExtractionService.extractPlainText(Buffer.from('raw content here', 'utf8'), mimeType);
    assert.equal(result.method, 'direct_text');
    assert.equal(result.text, 'raw content here');
  }
});

test('extractPlainText: an unsupported mime type throws DocumentTextExtractionUnsupportedTypeError', async () => {
  await assert.rejects(
    () => documentTextExtractionService.extractPlainText(Buffer.from('x'), 'application/zip'),
    documentTextExtractionService.DocumentTextExtractionUnsupportedTypeError,
  );
});

test.after(() => {
  mock.restoreAll();
});

// --- Item 1: csv/docx table coverage -----------------------------------
// (ai-chat-document-extraction-trust-and-formats-approved-spec.md)

test('extractPlainText: csv is parsed as a table, not raw text, and reaches the delimited strategy', async () => {
  const csv = 'Serial,RegNo,Name,Arrears\n818,24700301,ANBARASAN V,2\n819,24700302,BHARATH K,0\n';
  const result = await documentTextExtractionService.extractPlainText(
    Buffer.from(csv, 'utf8'), documentTextExtractionService.CSV_MIME_TYPE,
  );
  assert.equal(result.method, 'exceljs_csv');
  assert.equal(result.text.split('\n')[0], 'Serial | RegNo | Name | Arrears');
  // The whole point: it now detects as a table rather than as prose.
  const detected = extractRecords(result.text);
  assert.equal(detected.strategy, 'delimited');
  assert.equal(detected.records.length, 3);
});

test('extractPlainText: a comma inside a quoted csv cell is not a cell boundary', async () => {
  const csv = 'RegNo,Name,Fee\n24700301,"ANBARASAN V, Jr.",625\n';
  const result = await documentTextExtractionService.extractPlainText(
    Buffer.from(csv, 'utf8'), documentTextExtractionService.CSV_MIME_TYPE,
  );
  const cells = extractRecords(result.text).records[1].cells;
  assert.deepEqual(cells, ['24700301', 'ANBARASAN V, Jr.', '625']);
});

// mammoth.extractRawText flattens every table cell into its own paragraph,
// so before this change a docx table reached extractRecords as undelimited
// prose and produced strategy 'none'. Structure has to survive extraction;
// it cannot be recovered downstream.
function docxWithTable(rows, trailingProse) {
  const cell = (t) => `<w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
  const table = `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${
    rows.map((r) => `<w:tr>${r.map(cell).join('')}</w:tr>`).join('')}</w:tbl>`;
  const prose = trailingProse ? `<w:p><w:r><w:t>${trailingProse}</w:t></w:r></w:p>` : '';
  return docxBuffer(`${table}${prose}`);
}

function docxProseOnly(paragraphs) {
  return docxBuffer(paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join(''));
}

function docxBuffer(bodyXml) {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>');
  zip.folder('_rels').file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>');
  zip.folder('word').file('document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${bodyXml}</w:body></w:document>`);
  return zip.generate({ type: 'nodebuffer' });
}

test('extractPlainText: a docx table keeps its row/cell structure', async () => {
  const buffer = docxWithTable([
    ['Serial', 'RegNo', 'Name', 'Arrears'],
    ['818', '24700301', 'ANBARASAN V', '2'],
    ['819', '24700302', 'BHARATH K', '0'],
  ], 'End of table');
  const result = await documentTextExtractionService.extractPlainText(
    buffer, documentTextExtractionService.DOCX_MIME_TYPE,
  );
  assert.equal(result.method, 'mammoth_tables');
  const detected = extractRecords(result.text);
  assert.equal(detected.strategy, 'delimited');
  assert.equal(detected.records.length, 3);
  assert.deepEqual(detected.records[1].cells, ['818', '24700301', 'ANBARASAN V', '2']);
});

// The table work must be unable to affect ordinary prose documents at all
// — a docx with no w:tbl takes the original extractRawText path untouched.
test('extractPlainText: a prose-only docx is unchanged by the table handling', async () => {
  const buffer = docxProseOnly(['First paragraph.', 'Second paragraph.']);
  const result = await documentTextExtractionService.extractPlainText(
    buffer, documentTextExtractionService.DOCX_MIME_TYPE,
  );
  assert.equal(result.method, 'mammoth');
  assert.equal(result.text, 'First paragraph.\n\nSecond paragraph.');
});
