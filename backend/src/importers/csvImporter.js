'use strict';

// Importer Module (BusinessRules.md Central audit log and Import/
// Export: "import and export capabilities are provided as a common
// platform service") — a pure function, the import-side mirror of the
// Generator Module (Architecture.md 2.6/ADR-008): no database access,
// no storage access, no business rules, no permissions. Takes raw
// file bytes, returns {headers, rows}; the caller (a Business Service)
// decides required/allowed fields and commits rows through its own
// repository — same "no tool contains its own business logic, that
// would create a second source of truth" reasoning AI-Governance.md §2
// gives for the Tool Registry, applied here to import parsing.
//
// Line/quote-parsing logic matches academicService.js's own
// parseCsvLine exactly (moved here, not reimplemented) — the same
// double-quote-escaping convention csvGenerator.js's own csvEscape
// produces, so a file this codebase exports can always be re-imported
// unchanged.
//
// Headers are lowercased and trimmed — the same normalization
// importTimetablePeriodsCsv's own header check already relied on
// before this module existed.

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      values.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values;
}

// Strips a UTF-8 BOM if present — csvGenerator.js's own UTF8_BOM
// prefix convention, so a file this codebase generated is parsed back
// correctly, not left with a stray character on the first header.
function parse(fileBuffer) {
  const text = fileBuffer.toString('utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = parseCsvLine(lines[0]).map((value) => value.toLowerCase());
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
  });

  return { headers, rows };
}

module.exports = { parse, parseCsvLine };
