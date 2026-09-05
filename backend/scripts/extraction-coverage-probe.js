'use strict';

// Read-only measurement probe for Product Reasoning item 1 (table extraction
// generalisation). Builds one representative sample per attachable format,
// plus the real documents used in the 2026-08-25 sessions, and reports what
// documentTableExtractionService.extractRecords actually returns for each.
// Writes nothing, calls no LLM, touches no database.

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const PizZip = require('pizzip');

const textExtraction = require('../src/services/documentTextExtractionService');
const tableExtraction = require('../src/services/documentTableExtractionService');

const DOWNLOADS = 'C:\\Users\\HAI\\Downloads';

const ROWS = [
  ['Serial', 'RegNo', 'Name', 'Semester', 'Arrears', 'Fee'],
  ['818', '24700301', 'ANBARASAN V', '7', '2', '130'],
  ['819', '24700302', 'BHARATH K', '7', '0', '0'],
  ['820', '24700314', 'ASHWIN JOHN EDISON S', '7', '1', '65'],
];

function makeCsv() {
  return Buffer.from(ROWS.map((r) => r.join(',')).join('\n'), 'utf8');
}

function makeTsv() {
  return Buffer.from(ROWS.map((r) => r.join('\t')).join('\n'), 'utf8');
}

async function makeXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Fees');
  ROWS.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Minimal real .docx containing one w:tbl — same "write OOXML parts
// directly" approach documentService.assertValidDocxTemplate already uses
// for reading them.
function makeDocx() {
  const cell = (t) =>
    `<w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/></w:tcPr>` + `<w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
  const row = (cells) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
  const body =
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>` +
    ROWS.map(row).join('') +
    `</w:tbl><w:p><w:r><w:t>End of table</w:t></w:r></w:p>`;
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}</w:body></w:document>`;
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;
  const zip = new PizZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.folder('_rels').file('.rels', rels);
  zip.folder('word').file('document.xml', documentXml);
  return zip.generate({ type: 'nodebuffer' });
}

function report(label, mimeType, text, extra = {}) {
  const result = tableExtraction.extractRecords(text || '');
  const preview = (text || '').slice(0, 160).replace(/\n/g, '\\n');
  console.log(`\n### ${label}`);
  console.log(`  mimeType   : ${mimeType}`);
  console.log(`  textChars  : ${(text || '').length}`);
  Object.entries(extra).forEach(([k, v]) => console.log(`  ${k.padEnd(11)}: ${v}`));
  console.log(`  strategy   : ${result.strategy}`);
  console.log(`  records    : ${result.records.length}`);
  console.log(`  sections   : ${result.sections.length}`);
  console.log(`  preview    : ${preview}`);
  return result;
}

async function probeBuffer(label, buffer, mimeType) {
  const out = await textExtraction.extractPlainText(buffer, mimeType);
  return report(label, mimeType, out.text, {
    method: out.method || '-',
    failureReason: out.failureReason || '-',
  });
}

async function probeFile(label, fileName) {
  const full = path.join(DOWNLOADS, fileName);
  if (!fs.existsSync(full)) {
    console.log(`\n### ${label}\n  SKIPPED — not found at ${full}`);
    return null;
  }
  return probeBuffer(label, fs.readFileSync(full), 'application/pdf');
}

async function main() {
  console.log('Extraction coverage probe — item 1 (table extraction generalisation)');
  console.log('Same 4-row table expressed in every attachable format.');

  await probeBuffer('CSV (text/csv)', makeCsv(), 'text/csv');
  await probeBuffer('TSV as text/plain', makeTsv(), 'text/plain');
  await probeBuffer("XLSX (ARCNAVE's own extractor)", await makeXlsx(), textExtraction.XLSX_MIME_TYPE);
  await probeBuffer('DOCX with a real w:tbl', makeDocx(), textExtraction.DOCX_MIME_TYPE);

  console.log('\n--- real documents from the 2026-08-25 sessions ---');
  await probeFile('PDF: consolidated result sheet', '111_cons_result_apr2026.pdf');
  await probeFile('PDF: exam fees list', 'EXAM FEES ece(sw) III YR 7 SEM.pdf');
  await probeFile('PDF: Tally day book', 'APRDAYBOOK.pdf');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
