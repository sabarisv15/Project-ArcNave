'use strict';

// Generator Module (Architecture.md 2.6 / ADR-008): a pure function.
// No database access, no storage access, no business rules, no
// permissions — same ReportModel ({title, columns, rows}) contract as
// csvGenerator.js, PDF bytes instead of CSV bytes. Library choice
// (pdfkit) justified in ADR-019.
//
// pdfkit is stream-based, so generate() returns Promise<Buffer>, not
// a plain Buffer — csvGenerator.generate was made async too so
// reportService.js can await either generator identically.
//
// Draws its own fixed-width-column grid manually (pdfkit has no
// built-in table layout) — landscape A4, small font, because
// student_export's 22 columns don't fit portrait at a readable size.
// Not a general "any number of columns" solution; fine for the one
// report type that exists today (see ADR-019's Consequences).

const PDFDocument = require('pdfkit');

const PAGE_MARGIN = 30;
const HEADER_FONT_SIZE = 8;
const ROW_FONT_SIZE = 7;
const ROW_HEIGHT = 16;

function drawRow(doc, values, x0, y, columnWidth, fontSize, bold) {
  doc.fontSize(fontSize).font(bold ? 'Helvetica-Bold' : 'Helvetica');
  values.forEach((value, i) => {
    doc.text(value === null || value === undefined ? '' : String(value), x0 + i * columnWidth, y, {
      width: columnWidth - 4,
      ellipsis: true,
      lineBreak: false,
    });
  });
}

async function generate(reportModel) {
  const { title, columns, rows } = reportModel;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4', layout: 'landscape' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - PAGE_MARGIN * 2;
    const columnWidth = pageWidth / columns.length;

    doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.moveDown();

    let y = doc.y;
    drawRow(doc, columns.map((c) => c.label), PAGE_MARGIN, y, columnWidth, HEADER_FONT_SIZE, true);
    y += ROW_HEIGHT;
    doc.moveTo(PAGE_MARGIN, y - 4).lineTo(doc.page.width - PAGE_MARGIN, y - 4).stroke();

    for (const row of rows) {
      if (y > doc.page.height - PAGE_MARGIN - ROW_HEIGHT) {
        doc.addPage();
        y = PAGE_MARGIN;
      }
      drawRow(doc, columns.map((c) => row[c.id]), PAGE_MARGIN, y, columnWidth, ROW_FONT_SIZE, false);
      y += ROW_HEIGHT;
    }

    doc.end();
  });
}

module.exports = { generate };
