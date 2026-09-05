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

const OPERATIONS = new Set(['count', 'sum', 'breakdown', 'compare']);
const FILTER_MODES = new Set(['annotate', 'include']);

// ADL-057 — the numeric half of ADR-029's "filter". A closed operator set,
// same discipline as OPERATIONS: the caller SELECTS one, it never authors
// a comparison. 'between' is inclusive at both ends.
const COMPARISON_OPERATORS = new Set(['lt', 'lte', 'gt', 'gte', 'between']);

function recordText(record) {
  return record.cells ? record.cells.join(' ') : record.block || '';
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
    throw new DocumentAggregateValidationError(
      `filter.pattern is not a valid pattern: ${JSON.stringify(filter.pattern)}`,
    );
  }
}

// A Python-style inline flag is the one uncompilable pattern actually
// measured in production (ADL-056: the model supplied "(?i)ELECTRONICS...",
// which JS RegExp rejects), so it earns a specific sentence rather than a
// generic "invalid pattern". Detection only — the pattern is still
// REJECTED, never rewritten. Stripping the flag here would be a silent
// correctness bug: filter.pattern is deliberately case-SENSITIVE (see
// matchCount's comment), so removing "(?i)" would hand the model the exact
// opposite of what it asked for, with no error. That is also why this hint
// is duplicated in documentAnalysisService rather than shared with
// sectionPattern's: the two parameters need opposite remedies, and a
// helper shared between them is precisely the defect ADL-056 identified.
const INLINE_FLAG_PATTERN = /\(\?[a-zA-Z]+\)/;

// The precondition that keeps an LLM-supplied pattern from ending a whole
// /ai/ask turn as an HTTP 500 (ADL-056). Returns null when the pattern is
// absent or compiles, or a human-readable reason when it does not — never
// throws.
//
// Deliberately implemented by calling compilePattern rather than by
// re-deriving the same `\b(?:...)\b` construction: two copies of that
// template could drift, and a pattern that validated here but threw there
// would reintroduce the exact 500 this exists to remove. compilePattern
// itself keeps its throw, which is now reachable only by a direct caller
// of aggregate() that skipped this check — a programming error, not model
// input.
function validateFilterPattern(filter) {
  if (!filter || !filter.pattern) return null;
  try {
    compilePattern(filter);
    return null;
  } catch {
    const shown = JSON.stringify(filter.pattern);
    const flagNote = INLINE_FLAG_PATTERN.test(filter.pattern)
      ? ' JavaScript does not support inline flags such as (?i). Note that filter.pattern is matched' +
        ' case-sensitively by design — supply the exact casing you need, or an alternation like "RA|ra".'
      : '';
    return `filter.pattern is not valid JavaScript regular expression syntax: ${shown}.${flagNote}`;
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
  // 'compare' is a member of the closed vocabulary (that is what
  // RS-AIG-018 cares about) but not of THIS function: it returns a
  // filtered payload with its own deterministic counts, not one annotated
  // row per record, so it has its own entry point rather than a fourth
  // branch whose return shape disagrees with the other three.
  if (operation === 'compare') {
    throw new DocumentAggregateValidationError(
      "operation 'compare' has its own entry point — call compareRecords, not aggregate",
    );
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
        key: record.key,
        serialNo: record.serialNo || null,
        regNo: record.regNo || null,
        breakdown,
        total,
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
// compare — ADL-057 / ai-chat-document-numeric-comparison-approved-spec.md.
//
// "Which day-book entries are below ₹5000?" was inexpressible: filter.pattern
// can SELECT text and sum can TOTAL it, but nothing could test a number
// against a threshold. This adds that, and — critically — adds it over the
// record's own ROW TEXT, never a cell index.
//
// That distinction is the whole reason this ships while column-indexed
// groupBy does not. ADL-055's addendum states the boundary from measurement:
// the Tally day book's source omits empty cells rather than emitting
// consecutive tabs, so a row with no debit amount arrives with 5 cells
// against a 6-column header — "row-text pattern matching is unaffected;
// column-indexed groupBy is not". This operation sits on the safe side of
// that line by construction, not by a caveat.

// The one normalisation permitted anywhere on this path, and deliberately
// scoped to compare alone. Currency separators and a rupee prefix are
// presentation, not value — "5,000" and "₹5,000" are the same number, and a
// threshold question is unanswerable if they are not.
//
// This is NUMERIC parsing, not regex-dialect normalisation, so ADL-056's
// "no normalisation anywhere" rule is about a different thing and is not
// weakened: the caller's pattern is still rejected verbatim if it does not
// compile, and is never rewritten.
//
// Note the consequence, recorded rather than fixed: matchSum above does NOT
// strip separators, so `sum` and `compare` parse "1,234" differently. sum is
// shipped and verified; changing it in a slice that did not measure it is
// the mid-implementation scope expansion the Product Reasoning workflow
// forbids. It is an OUT OF SCOPE item in this slice's own spec.
const CURRENCY_PREFIX = /^[\s₹]*(?:Rs\.?)?\s*/i;
const PLAIN_NUMBER = /^[+-]?\d+(?:\.\d+)?$/;

// null rather than 0 for unparseable text — the same rule matchSum already
// states: a match whose text is not a number is SKIPPED, never coerced to
// zero. A coerced zero is a silently wrong answer to a threshold question
// ("below ₹5000" would match every unreadable row).
function parseNumeric(text) {
  const cleaned = String(text).replace(CURRENCY_PREFIX, '').replace(/,/g, '').trim();
  if (!PLAIN_NUMBER.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function passesComparison(value, comparison) {
  switch (comparison.operator) {
    case 'lt':
      return value < comparison.value;
    case 'lte':
      return value <= comparison.value;
    case 'gt':
      return value > comparison.value;
    case 'gte':
      return value >= comparison.value;
    case 'between':
      return value >= comparison.value && value <= comparison.upperValue;
    default:
      return false;
  }
}

function validateComparison(comparison) {
  if (!comparison || typeof comparison !== 'object') {
    throw new DocumentAggregateValidationError("comparison is required when operation is 'compare'");
  }
  if (!COMPARISON_OPERATORS.has(comparison.operator)) {
    throw new DocumentAggregateValidationError(
      `comparison.operator must be one of ${[...COMPARISON_OPERATORS].join(', ')}`,
    );
  }
  if (typeof comparison.value !== 'number' || !Number.isFinite(comparison.value)) {
    throw new DocumentAggregateValidationError('comparison.value must be a finite number');
  }
  const isBetween = comparison.operator === 'between';
  const hasUpper = comparison.upperValue !== undefined && comparison.upperValue !== null;
  if (
    isBetween &&
    (!hasUpper || typeof comparison.upperValue !== 'number' || !Number.isFinite(comparison.upperValue))
  ) {
    throw new DocumentAggregateValidationError(
      "comparison.upperValue must be a finite number when comparison.operator is 'between'",
    );
  }
  // Rejected rather than ignored on the other four: an upperValue that
  // silently does nothing looks to the caller like a range it never got.
  if (!isBetween && hasUpper) {
    throw new DocumentAggregateValidationError(
      "comparison.upperValue is only valid when comparison.operator is 'between'",
    );
  }
}

// identityPattern's own compile step. Deliberately NOT routed through
// compilePattern or documentAnalysisService's compileSectionPattern — see
// INLINE_FLAG_PATTERN's comment above for why sharing pattern handling
// across these parameters is the defect ADL-056 identified. This one
// compiles plainly: no word-boundary wrapping (it extracts a name, not a
// token) and no 'i' flag (predictable beats convenient — the caller can
// supply casing or an alternation).
function compileIdentityPattern(identityPattern) {
  if (!identityPattern) return { regex: null };
  try {
    return { regex: new RegExp(identityPattern) };
  } catch {
    const shown = JSON.stringify(identityPattern);
    const flagNote = INLINE_FLAG_PATTERN.test(identityPattern)
      ? ' JavaScript does not support inline flags such as (?i). identityPattern is matched case-sensitively;' +
        ' supply the exact casing you need, or an alternation.'
      : '';
    return { reason: `identityPattern is not valid JavaScript regular expression syntax: ${shown}.${flagNote}` };
  }
}

// Extracted with a NON-global regex so exec carries no lastIndex state
// between records — a stateful match here would make a row's identity
// depend on which rows preceded it.
function extractIdentity(record, identityRe) {
  if (!identityRe) return null;
  const m = identityRe.exec(recordText(record));
  if (!m) return null;
  return m[1] !== undefined ? m[1] : m[0];
}

// Returns the full payload the tool hands back for operation 'compare' —
// rows plus the deterministic counts, computed in ONE pass so the two can
// never disagree about the same record set.
//
// Why this does not go through summarize(), despite computing the same
// shape: summarize derives `matched` as `rowValue(row) > 0`, which is
// correct for count/sum (where a zero means "nothing matched") and WRONG
// here. A comparison result of exactly 0, or a negative one (a day book
// credit), is a legitimately passing row that summarize would silently drop
// from both the count and the sample. It would also report scopedCount as
// the number of PASSING rows rather than the number considered, because
// compare only ever hands it an already-filtered set. Both are corrections
// to this slice's own Approved Spec, which claimed "summarize needs nothing
// else"; recorded in the ADL-057 addendum rather than papered over.
function compareRecords(records, { filter, comparison, identityPattern, sampleSize = DEFAULT_SAMPLE_SIZE } = {}) {
  if (!Array.isArray(records)) {
    throw new DocumentAggregateValidationError('records must be an array');
  }
  validateComparison(comparison);
  const mode = (filter && filter.mode) || 'include';
  if (mode !== 'include') {
    throw new DocumentAggregateValidationError("filter.mode must be 'include' when operation is 'compare'");
  }

  const re = compilePattern(filter);
  if (!re) {
    throw new DocumentAggregateValidationError("filter.pattern is required when operation is 'compare'");
  }

  const rows = [];
  let unmatchedRows = 0;
  let nonNumericRows = 0;
  let multiMatchRows = 0;
  let rowsWithoutIdentity = 0;

  for (const record of records) {
    const text = recordText(record);
    re.lastIndex = 0;
    const matches = [...text.matchAll(re)];
    if (matches.length === 0) {
      unmatchedRows += 1;
      continue;
    }
    // The FIRST match, matching matchSum's own capture rule. A pattern that
    // matches several numbers in one row is ambiguous for a threshold
    // question, so the count below makes that visible instead of letting
    // the choice of "first" pass unremarked.
    if (matches.length > 1) multiMatchRows += 1;
    const first = matches[0];
    const value = parseNumeric(first[1] !== undefined ? first[1] : first[0]);
    if (value === null) {
      nonNumericRows += 1;
      continue;
    }
    if (!passesComparison(value, comparison)) continue;

    const identity = extractIdentity(record, identityPattern);
    if (identityPattern && identity === null) rowsWithoutIdentity += 1;
    rows.push({
      key: record.key || null,
      serialNo: record.serialNo || null,
      regNo: record.regNo || null,
      identity,
      value,
    });
  }

  const sample = rows.slice(0, sampleSize);
  return {
    // Rounded to kill binary floating-point accumulation noise, nothing
    // more: summing 153 real day-book amounts produced
    // 337884.76999999996 for a figure whose true value is 337884.77, and
    // handing that to a model to narrate invites an answer that looks
    // wrong to the user. Six decimal places is far beyond any currency
    // precision, so no legitimate value is altered — only the artifact.
    total: Math.round(rows.reduce((sum, row) => sum + row.value, 0) * 1e6) / 1e6,
    matchedCount: rows.length,
    scopedCount: records.length,
    sample,
    sampleShown: sample.length,
    sampleOmitted: rows.length - sample.length,
    unmatchedRows,
    nonNumericRows,
    multiMatchRows,
    rowsWithoutIdentity,
  };
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
  return [...totals.entries()].sort((a, b) => a[0] - b[0]).map(([semester, count]) => ({ semester, count }));
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
  aggregate,
  summarize,
  compareRecords,
  validateFilterPattern,
  compileIdentityPattern,
  validateComparison,
  OPERATIONS,
  COMPARISON_OPERATORS,
  DEFAULT_SAMPLE_SIZE,
  DocumentAggregateValidationError,
};
