'use strict';

// Generator Module (Architecture.md 2.6 / ADR-008): a pure function.
// No database access, no storage access, no business rules, no
// permissions — same ReportModel ({title, columns, rows}) contract as
// csvGenerator.js/pdfGenerator.js, XLSX bytes instead.
//
// Library: exceljs — TechStack.md's named gap ("Node equivalent of
// openpyxl ... not chosen yet") is exceljs by exactly the criteria
// ADR-017/019 already used for storage/PDF: pure JS, no native
// compilation step, the standard choice for writing .xlsx from Node.
// No ADR: this is the expected default, not a deviation to justify
// (contrast pdfkit, which had real alternatives weighed — ADR-019).
//
// One flagged, accepted gap: exceljs@4.4.0 (latest) depends on a
// `uuid` version with a moderate advisory (GHSA-w5hq-g745-h8pq,
// missing bounds check when a caller passes uuid v3/v5/v6 an explicit
// buffer). exceljs doesn't expose or call uuid that way internally —
// low practical risk — and `npm audit fix --force` only offers
// downgrading to exceljs@3.4.0, a worse outcome. Not fixed here,
// flagged instead (see .ai/RESULT.md).
//
// sheet.columns' `key` maps each column id straight onto ReportModel
// rows' own keys (buildStudentExportReportModel's rows are already
// {roll_no, full_name, ...} objects) — no separate row-shaping step
// needed here, unlike csvGenerator/pdfGenerator, which each pull
// row[c.id] by hand.

const ExcelJS = require('exceljs');

async function generate(reportModel) {
  const { title, columns, rows } = reportModel;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet((title || 'Report').slice(0, 31)); // Excel's own 31-char sheet-name limit
  sheet.columns = columns.map((c) => ({ header: c.label, key: c.id, width: 18 }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRows(rows);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = { generate };
