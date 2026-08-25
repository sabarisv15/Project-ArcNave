'use strict';

// Fixed, enumerated aggregate operations over documentTableExtractionService's
// records — ADR-029's "Deterministic Analysis" step. This is the whole
// reason RS-AIG-018 is satisfiable here at all: the operation vocabulary is
// closed (filter/group/count/sum, nothing else), so an AI tool call can
// only ever select one of these four, never author or execute arbitrary
// logic. Per-question semantic meaning (which pattern means "arrear," which
// column is "the student") is supplied by the caller as plain data
// (params), never as code.

class DocumentAggregateValidationError extends Error {}

const OPERATIONS = new Set(['count', 'sum', 'breakdown']);
const FILTER_MODES = new Set(['annotate', 'include']);

function recordText(record) {
  return record.cells ? record.cells.join(' ') : (record.block || '');
}

// filter.pattern is always word-boundary-wrapped and applied with the
// global flag so every occurrence in a record's text is visited — a plain
// RegExp string, never evaluated as code. Shared by matchCount/matchSum so
// both operations see identical matches for the same pattern, just reduced
// differently (occurrence count vs. captured-number total).
function compilePattern(filter) {
  if (!filter || !filter.pattern) return null;
  try {
    return new RegExp(`\\b(?:${filter.pattern})\\b`, 'g');
  } catch {
    throw new DocumentAggregateValidationError(`filter.pattern is not a valid pattern: ${JSON.stringify(filter.pattern)}`);
  }
}

// filter: { pattern } — a plain substring/regex the caller supplies to
// select which occurrences within a record count toward its result (e.g.
// "RA|Absent RA" for an arrear count). Matched case-sensitively against
// the record's own text — never evaluated as code, only as a RegExp
// pattern string. Always word-boundary-wrapped: caught live in this
// slice's own tests — "RA" without \b matches as a plain substring
// inside an ordinary student name like "ANBARASAN", turning the name
// itself into a false arrear. A caller-supplied pattern that already
// wants substring matching has no way to opt out of this, which is the
// intended, safer default for a grade-code-style token count.
function matchCount(record, filter) {
  const re = compilePattern(filter);
  if (!re) return 0;
  const matches = recordText(record).match(re);
  return matches ? matches.length : 0;
}

// sum: adds up a number per match rather than counting matches — the
// number is the pattern's own first capturing group when it has one (e.g.
// "Total Arrears\\s*:?\\s*(\\d+)" sums the captured arrear figure), or the
// whole match text when it doesn't (a pattern that already only matches
// digits, e.g. "\\d+"). A match whose captured/matched text isn't a plain
// number is skipped rather than coerced to 0 — a caller-supplied pattern
// still only ever selects existing document text, never computes anything
// itself.
function matchSum(record, filter) {
  const re = compilePattern(filter);
  if (!re) return 0;
  const text = recordText(record);
  let total = 0;
  let match = re.exec(text);
  while (match !== null) {
    const numeric = match[1] !== undefined ? match[1] : match[0];
    const n = Number(numeric);
    if (!Number.isNaN(n)) total += n;
    match = re.exec(text);
  }
  return total;
}

// A live comparison against a direct Gemini upload of the same result
// sheet surfaced a real gap: matchCount/matchSum reduce a whole record to
// one number, so a per-semester breakdown ("Sem 2: 2, Sem 3: 1, Sem 4:
// 1") the raw document text genuinely contains never reached the model —
// it only ever saw the record's final total. Rather than expose that raw
// block text to the model (which would make every per-semester number an
// unverified LLM claim, weakening RS-AIG-018/019's guarantee), this is a
// third deterministic reduction, same closed-vocabulary discipline as
// count/sum: split a record's text on its own semester markers (a DTE
// mark-sheet convention — "<semester number> R<4-digit regulation year>",
// e.g. "3 R2023") and count filter.pattern matches within each semester's
// own span. Still a plain regex, still no code execution — it just
// produces one number per semester instead of one number per record.
const SEMESTER_MARKER_PATTERN = /(\d{1,2})\s+R\d{4}\b/g;

function matchBreakdown(record, filter) {
  const text = recordText(record);
  const markers = [...text.matchAll(SEMESTER_MARKER_PATTERN)];
  if (markers.length === 0) return [];
  const re = compilePattern(filter);
  return markers.map((marker, i) => {
    const start = marker.index;
    const end = i + 1 < markers.length ? markers[i + 1].index : text.length;
    const span = text.slice(start, end);
    const matches = re ? span.match(re) : null;
    return { semester: Number(marker[1]), count: matches ? matches.length : 0 };
  });
}

// records: documentTableExtractionService.extractRecords(...).records.
// groupBy: 'key' (the only grouping this slice needs — one group per
// extracted record/student; a delimited source's numeric groupBy-by-
// column-index is future work, not required by the current document
// family).
// operation: 'count' (occurrences of filter.pattern per group), 'sum'
// (total of the numbers filter.pattern captures/matches per group), or
// 'breakdown' (per-semester counts within a group — see
// SEMESTER_MARKER_PATTERN's own comment above).
// filter.mode: 'annotate' (default — every record, each carrying its own
// count/sum/breakdown) or 'include' (only records whose count/sum/
// breakdown-total is non-zero, i.e. an actual filtered list rather than
// every record annotated with a mostly-zero column) — still a
// deterministic reduction over the same per-record value, never a second
// class of computation.
function aggregate(records, { groupBy = 'key', filter, operation = 'count' } = {}) {
  if (!Array.isArray(records)) {
    throw new DocumentAggregateValidationError('records must be an array');
  }
  if (!OPERATIONS.has(operation)) {
    throw new DocumentAggregateValidationError(`operation must be one of ${[...OPERATIONS].join(', ')}`);
  }
  if (groupBy !== 'key') {
    throw new DocumentAggregateValidationError("groupBy must be 'key' in this slice");
  }
  const mode = (filter && filter.mode) || 'annotate';
  if (!FILTER_MODES.has(mode)) {
    throw new DocumentAggregateValidationError(`filter.mode must be one of ${[...FILTER_MODES].join(', ')}`);
  }

  if (operation === 'breakdown') {
    const annotated = records.map((record) => {
      const breakdown = matchBreakdown(record, filter);
      const total = breakdown.reduce((sum, entry) => sum + entry.count, 0);
      return {
        key: record.key, serialNo: record.serialNo || null, regNo: record.regNo || null, breakdown, total,
      };
    });
    return mode === 'include' ? annotated.filter((row) => row.total > 0) : annotated;
  }

  const reduce = operation === 'sum' ? matchSum : matchCount;
  const valueKey = operation === 'sum' ? 'sum' : 'count';

  const annotated = records.map((record) => ({
    key: record.key,
    serialNo: record.serialNo || null,
    regNo: record.regNo || null,
    [valueKey]: reduce(record, filter),
  }));

  return mode === 'include' ? annotated.filter((row) => row[valueKey] > 0) : annotated;
}

// ---------------------------------------------------------------------------
// summarize — the deterministic CROSS-RECORD reduction, per
// ai-chat-document-analysis-payload-bounds-approved-spec.md.
//
// aggregate() above computes a value PER RECORD and stops there. Nothing in
// this service ever reduced across records, so the actual answer to "how
// many arrears altogether" was left for the LLM to obtain by adding up
// thousands of rows it had been handed — the exact arithmetic ADR-029 and
// this service exist to take away from the model. summarize() closes that:
// the total is computed here, deterministically, and the rows themselves
// stop being the answer.
//
// This is a reduction over the values aggregate() already produced, not a
// new operation: ADR-029's enumerated vocabulary (filter/group/count/sum)
// is unchanged, and RS-AIG-018/ADL-036 ("never a general-purpose execution
// capability") are untouched.
//
// Default sample size is 100 rather than a smaller round number for a
// specific reason: the prior slice's own verified ground-truth ranges are
// 55 records (serial 818-872) and 41 (serial 1133-1173), so a caller asking
// the documented "consolidate serial X to Y" question still receives every
// matching row, exactly as before this change. The cap only ever engages on
// result sets larger than any range that spec contemplated.
const DEFAULT_SAMPLE_SIZE = 100;

// A row's value is whichever key aggregate() produced for the operation
// that ran: `total` for breakdown (already the per-record rollup), `sum`
// for sum, `count` for count. Read positionally rather than by re-deriving
// the operation, so summarize() can never disagree with what aggregate()
// actually returned.
function rowValue(row) {
  if (!row || typeof row !== 'object') return 0;
  if (typeof row.total === 'number') return row.total;
  if (typeof row.sum === 'number') return row.sum;
  if (typeof row.count === 'number') return row.count;
  return 0;
}

// Per-semester rollup across records, for operation 'breakdown' only —
// the cross-record counterpart of each row's own `breakdown` array. Absent
// for count/sum, never an empty array, so a caller can't mistake "this
// operation has no semester dimension" for "every semester was zero".
function rollupBySemester(rows) {
  const totals = new Map();
  for (const row of rows) {
    if (!row || !Array.isArray(row.breakdown)) continue;
    for (const entry of row.breakdown) {
      totals.set(entry.semester, (totals.get(entry.semester) || 0) + entry.count);
    }
  }
  if (totals.size === 0) return undefined;
  return [...totals.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([semester, count]) => ({ semester, count }));
}

// Returns the shape the AI tool actually hands to the model: the
// deterministic answer first, a bounded sample of the underlying rows
// second. `sampleOmitted` is always present and always truthful — an
// unlabelled partial list is a wrong answer, not a shorter one, so the
// caller can state "showing N of M" rather than silently truncating.
function summarize(rows, { sampleSize = DEFAULT_SAMPLE_SIZE } = {}) {
  if (!Array.isArray(rows)) {
    throw new DocumentAggregateValidationError('rows must be an array');
  }
  const scopedCount = rows.length;
  const matched = rows.filter((row) => rowValue(row) > 0);
  const total = rows.reduce((sum, row) => sum + rowValue(row), 0);
  // Sampled from the MATCHED rows, not from every scoped row: in the
  // default 'annotate' mode most rows are zeros, and a sample of zeros
  // would spend the whole budget saying nothing. 'include' mode has
  // already filtered to the same set, so both modes sample identically.
  const sample = matched.slice(0, sampleSize);
  return {
    total,
    matchedCount: matched.length,
    scopedCount,
    bySemester: rollupBySemester(rows),
    sample,
    sampleShown: sample.length,
    sampleOmitted: matched.length - sample.length,
  };
}

module.exports = {
  aggregate, summarize, DEFAULT_SAMPLE_SIZE, DocumentAggregateValidationError,
};
