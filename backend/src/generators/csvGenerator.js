'use strict';

// Generator Module (Architecture.md 2.6 / ADR-008): a pure function.
// No database access, no storage access, no business rules, no
// permissions — takes a ReportModel ({title, columns, rows}),
// returns bytes. Never calls DocumentService or Storage directly
// (ADR-008's own Consequences) — ReportService does that after
// getting bytes back from here.
//
// Quoting/BOM match frontend/src/components/CsvExportModal.jsx's own
// convention (the one real CSV-export precedent in this codebase):
// every value double-quoted with internal quotes doubled, and a UTF-8
// BOM prefix for Excel compatibility — so a report generated here
// looks like the same kind of file that modal already produces
// client-side, not a new one invented from scratch.
//
// Excel/Word generators are still deferred until a real screen needs
// them; pdfGenerator.js (ADR-019) is the second format now built.
//
// generate() is async (trivially — no real async work happens) so
// reportService.js can await this and pdfGenerator.generate
// identically regardless of format: pdfkit is stream-based and has no
// synchronous "give me the bytes now" API, so the Generator Module's
// contract is Promise<Buffer> across formats, not just this one.

const UTF8_BOM = '﻿';

function csvEscape(value) {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function generate(reportModel) {
  const { columns, rows } = reportModel;
  const lines = [columns.map((c) => csvEscape(c.label)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c.id])).join(','));
  }
  return Buffer.from(UTF8_BOM + lines.join('\n'), 'utf8');
}

module.exports = { generate };
