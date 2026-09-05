'use strict';

// Pure function, no DB/storage access — same purity rule every module in
// this directory follows (ADR-008). Finds a GitHub-flavored-markdown
// pipe-table and returns it in the exact ReportModel shape
// csvGenerator.js/excelGenerator.js already consume unmodified
// ({columns: [{id, label}], rows: [{...}]}) — so an AI-authored table can
// go straight into those existing generators without a new one.

const PIPE_ROW = /^\s*\|(.+)\|\s*$/;
const SEPARATOR_CELL = /^:?-{1,}:?$/;

function splitRow(line) {
  const match = line.match(PIPE_ROW);
  const inner = match ? match[1] : line;
  return inner.split('|').map((cell) => cell.trim());
}

function isSeparatorRow(line) {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL.test(cell));
}

function slugify(label, index) {
  const slug = String(label)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || `column_${index + 1}`;
}

// Parses a table starting EXACTLY at lines[startIndex] (the header row) —
// returns null if it isn't really a table there (no separator row right
// after it), so a caller walking a document line-by-line
// (markdownDocxGenerator.js/markdownPdfGenerator.js) can tell "not a
// table here" from "a table, N lines long" without re-scanning the rest
// of the document. findFirstTable below is the whole-document
// convenience wrapper over this same primitive.
function parseTableAt(lines, startIndex) {
  if (!PIPE_ROW.test(lines[startIndex] || '') || !isSeparatorRow(lines[startIndex + 1] || '')) return null;

  const headerCells = splitRow(lines[startIndex]);
  const columns = headerCells.map((label, index) => ({ id: slugify(label, index), label }));

  const rows = [];
  let i = startIndex + 2;
  while (i < lines.length && PIPE_ROW.test(lines[i])) {
    const cells = splitRow(lines[i]);
    const row = {};
    columns.forEach((col, index) => {
      row[col.id] = cells[index] !== undefined ? cells[index] : '';
    });
    rows.push(row);
    i += 1;
  }
  return { columns, rows, endIndex: i };
}

// Whole-document convenience: the FIRST table anywhere in a markdown
// string. Returns null if none exists — callers decide how to handle
// "no table" (markdownFormatConverter.js turns this into a clear,
// user-facing error rather than emitting an empty csv/xlsx).
function findFirstTable(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const table = parseTableAt(lines, i);
    if (table) return { columns: table.columns, rows: table.rows };
  }
  return null;
}

module.exports = { parseTableAt, findFirstTable };
