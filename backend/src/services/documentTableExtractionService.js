'use strict';

// Structural-only table/row extraction over an already-extracted document's
// plain text (documentTextExtractionService's output) — the "Common
// Document Representation" layer from ADR-029. Deliberately carries no
// semantic field meaning (no "column 3 is a register number"): it only
// ever produces rows/cells or raw text blocks keyed by a record identifier.
// Per-question column meaning is resolved by the caller (the LLM, via
// documentAggregateService's params), never pre-learned or cached here —
// see ADR-029's "why structural-only, not semantic CDR" section.
//
// Two detector strategies, chosen by what the input text looks like — not
// a per-document-family branch. More strategies get added here as new real
// document families are encountered (ADR-029's incremental-build
// principle); this file's shape (detect -> records[]) doesn't change when
// they do.

// documentTextExtractionService's XLSX/ODS extractors already join a row's
// cells with ' | ' (extractXlsxText/extractOdsText) — genuinely delimited,
// safe to split on directly. Any text containing this marker is treated as
// pre-delimited tabular text, regardless of which extractor produced it.
const DELIMITER = ' | ';

function extractDelimitedRows(text) {
  return text
    .split('\n')
    .filter((line) => line.includes(DELIMITER))
    .map((line) => ({ key: null, cells: line.split(DELIMITER).map((c) => c.trim()) }));
}

// Roster-style detector — a line starting with a short serial number
// followed by a longer id/registration number marks the start of a new
// record (e.g. "819 25400122 ANBARASAN V ..."). This shape is common to
// any serial-numbered roster (attendance, fee, staff lists), not specific
// to examination result-sheets — but it is one specific shape, not every
// conceivable tabular layout; documents that don't start rows this way
// fall through to STRATEGY_NONE below rather than being force-fit.
const RECORD_START_PATTERN = /^(\d{1,5})\s+(\d{5,12})\b/;

// A PDF/DOCX text extraction has no reliable column delimiter (verified
// against a real result-sheet PDF this session — pdf-parse's default
// getText() joins cell text with plain spaces, indistinguishable from a
// sentence's own word-spacing). Records are therefore kept as raw text
// blocks (all lines between one record-start and the next), not split into
// cells — documentAggregateService counts pattern matches within the block
// text instead of addressing a specific column.
function extractSequentialIdRecords(text) {
  const lines = text.split('\n');
  const starts = [];
  lines.forEach((line, i) => {
    const m = RECORD_START_PATTERN.exec(line);
    if (m) starts.push({ index: i, serialNo: m[1], regNo: m[2] });
  });
  if (starts.length === 0) return null;

  const records = starts.map((start, i) => {
    const endIndex = i + 1 < starts.length ? starts[i + 1].index : lines.length;
    return {
      key: `${start.serialNo}:${start.regNo}`,
      serialNo: start.serialNo,
      regNo: start.regNo,
      block: lines.slice(start.index, endIndex).join('\n'),
    };
  });

  // Page-break continuation: a record's row is sometimes re-printed at the
  // top of the next physical page to continue the same student's
  // remaining rows (verified against real serial numbers 822/827/847 in
  // this session's source document) — merge immediately-consecutive
  // records sharing the same key rather than treating the repeat as a new
  // record.
  const merged = [];
  for (const record of records) {
    const prev = merged[merged.length - 1];
    if (prev && prev.key === record.key) {
      prev.block += `\n${record.block}`;
    } else {
      merged.push({ ...record });
    }
  }
  return merged;
}

// text: documentTextExtractionService's already-extracted plain text.
// Returns { strategy, records } — records are either { key, cells } (a
// genuinely delimited source) or { key, serialNo, regNo, block } (a
// sequential-id roster detected in free text). Returns strategy: 'none'
// with an empty records array when neither detector recognizes the text —
// callers must treat that as "not a recognized tabular layout," never
// guess a record shape.
function extractRecords(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { strategy: 'none', records: [] };
  }

  const delimited = extractDelimitedRows(text);
  if (delimited.length > 0) {
    return { strategy: 'delimited', records: delimited };
  }

  const sequential = extractSequentialIdRecords(text);
  if (sequential) {
    return { strategy: 'sequential_id', records: sequential };
  }

  return { strategy: 'none', records: [] };
}

module.exports = { extractRecords };
