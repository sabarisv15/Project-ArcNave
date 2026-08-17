'use strict';

// Generator Module (Architecture.md 2.6 / ADR-008): a pure function.
// No database access, no storage access, no business rules, no
// permissions — same ReportModel ({title, columns, rows}) contract as
// csvGenerator.js/pdfGenerator.js/excelGenerator.js, DOCX bytes
// instead.
//
// Library: docx — matches TechStack.md's named gap ("Node equivalent
// of python-docx") by the same pure-JS/no-native-deps criteria
// ADR-017/019/excelGenerator.js already used. The expected default,
// not a deviation with real alternatives weighed — no ADR, same
// treatment excelGenerator.js's exceljs choice got.
//
// Unlike pdfGenerator.js, no manual column-width/pagination math: a
// docx Table wraps and paginates on its own when opened in Word, so
// student_export's 22 columns don't need the landscape/small-font
// workaround the PDF generator needed.

const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType } = require('docx');

function textCell(text, bold) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: text === null || text === undefined ? '' : String(text), bold })] })],
  });
}

async function generate(reportModel) {
  const { title, columns, rows } = reportModel;

  const headerRow = new TableRow({ children: columns.map((c) => textCell(c.label, true)) });
  const dataRows = rows.map((row) => new TableRow({ children: columns.map((c) => textCell(row[c.id], false)) }));

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
        table,
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}

module.exports = { generate };
