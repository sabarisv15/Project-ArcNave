'use strict';

// Generator Module (ADR-008): a pure function, no DB/storage access.
// Distinct from pdfGenerator.js — that one always renders one fixed-grid
// ReportModel table, landscape, for Module 7's tabular reports. This
// renders free-text AI-authored markdown as a normal portrait reading
// document, letting pdfkit's own text-flow handle wrapping/pagination for
// prose (no manual y-tracking needed there, unlike pdfGenerator.js's
// fixed-grid case) — an embedded pipe-table still uses a small fixed-grid
// draw, reusing pdfGenerator.js's own column-width approach.
//
// Visual design (this round, same as markdownDocxGenerator.js's own
// comment): a colored title banner, left-accent-bar section headings, a
// styled table header/alternating rows, and page-number footers —
// documentTheme.js's palette (from frontend/src/index.css), not a copy of
// any reference tool's own colors.

const PDFDocument = require('pdfkit');
const { parseTableAt } = require('./markdownTableParser');
const { HEX } = require('./documentTheme');

const PAGE_MARGIN = 50;
const TABLE_ROW_HEIGHT = 18;
const TOP_MARGIN = 50;

function hex(h) {
  return `#${h}`;
}

function drawTitleBanner(doc, title) {
  const bannerHeight = 70;
  doc.rect(0, 0, doc.page.width, bannerHeight).fill(hex(HEX.accent));
  doc
    .fillColor('white')
    .fontSize(20)
    .font('Helvetica-Bold')
    .text(title, PAGE_MARGIN, 26, { width: doc.page.width - PAGE_MARGIN * 2 });
  doc.y = bannerHeight + 24;
  doc.fillColor(hex(HEX.inkSoft));
}

function drawHeading(doc, text, level) {
  const sizes = { 1: 16, 2: 13, 3: 11.5 };
  doc.moveDown(level === 1 ? 0.6 : 0.9);
  const y = doc.y;
  if (level > 1) {
    // Left accent bar — same "colored section marker" role as
    // markdownDocxGenerator.js's border-left treatment.
    doc.rect(PAGE_MARGIN, y, 3, sizes[level] + 6).fill(hex(HEX.accent));
  }
  doc
    .fillColor(hex(HEX.ink))
    .fontSize(sizes[level])
    .font('Helvetica-Bold')
    .text(text, PAGE_MARGIN + (level > 1 ? 12 : 0), y, {
      width: doc.page.width - PAGE_MARGIN * 2 - (level > 1 ? 12 : 0),
    });
  doc.moveDown(0.4);
  doc.fillColor(hex(HEX.inkSoft)).fontSize(10.5).font('Helvetica');
}

function drawTable(doc, columns, rows) {
  const pageWidth = doc.page.width - PAGE_MARGIN * 2;
  const columnWidth = pageWidth / columns.length;

  doc.moveDown(0.4);
  let y = doc.y;

  doc.rect(PAGE_MARGIN, y, pageWidth, TABLE_ROW_HEIGHT).fill(hex(HEX.accent));
  doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
  columns.forEach((c, i) =>
    doc.text(c.label, PAGE_MARGIN + 4 + i * columnWidth, y + 5, {
      width: columnWidth - 8,
      ellipsis: true,
      lineBreak: false,
    }),
  );
  y += TABLE_ROW_HEIGHT;

  doc.font('Helvetica').fontSize(9);
  rows.forEach((row, rowIndex) => {
    if (y > doc.page.height - PAGE_MARGIN - TABLE_ROW_HEIGHT) {
      doc.addPage();
      y = TOP_MARGIN;
    }
    if (rowIndex % 2 === 1) {
      doc.rect(PAGE_MARGIN, y, pageWidth, TABLE_ROW_HEIGHT).fill(hex(HEX.accentSoft));
    }
    doc.fillColor(hex(HEX.inkSoft));
    columns.forEach((c, i) => {
      const value = row[c.id];
      doc.text(value === undefined || value === null ? '' : String(value), PAGE_MARGIN + 4 + i * columnWidth, y + 5, {
        width: columnWidth - 8,
        ellipsis: true,
        lineBreak: false,
      });
    });
    y += TABLE_ROW_HEIGHT;
  });
  doc.y = y + 10;
  doc.fillColor(hex(HEX.inkSoft)).font('Helvetica').fontSize(10.5);
}

// Page-number footer — pdfkit has no per-page callback, so this runs once
// at the end over every already-generated page (bufferPages: true below
// keeps every page addressable via switchToPage until doc.end() actually
// flushes them).
function drawPageNumbers(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const label = `${i + 1} of ${range.count}`;
    doc
      .fontSize(8.5)
      .fillColor(hex(HEX.inkMuted))
      .font('Helvetica')
      .text(label, 0, doc.page.height - 30, { align: 'center', width: doc.page.width });
  }
}

async function generate({ title, markdown }) {
  const lines = String(markdown || '').split(/\r?\n/);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: PAGE_MARGIN,
      size: 'A4',
      bufferPages: true,
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawTitleBanner(doc, title);

    let i = 0;
    while (i < lines.length) {
      const table = parseTableAt(lines, i);
      if (table) {
        drawTable(doc, table.columns, table.rows);
        i = table.endIndex;
        continue; // eslint-disable-line no-continue
      }

      const line = lines[i];
      const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
      if (headingMatch) {
        drawHeading(doc, headingMatch[2], headingMatch[1].length);
      } else if (line.trim()) {
        doc.text(line);
        doc.moveDown(0.3);
      } else {
        doc.moveDown(0.2);
      }
      i += 1;
    }

    drawPageNumbers(doc);
    doc.end();
  });
}

module.exports = { generate };
