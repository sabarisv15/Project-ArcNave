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

const OPERATIONS = new Set(['count', 'sum']);

function recordText(record) {
  return record.cells ? record.cells.join(' ') : (record.block || '');
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
  if (!filter || !filter.pattern) return 0;
  let re;
  try {
    re = new RegExp(`\\b(?:${filter.pattern})\\b`, 'g');
  } catch {
    throw new DocumentAggregateValidationError(`filter.pattern is not a valid pattern: ${JSON.stringify(filter.pattern)}`);
  }
  const matches = recordText(record).match(re);
  return matches ? matches.length : 0;
}

// records: documentTableExtractionService.extractRecords(...).records.
// groupBy: 'key' (the only grouping this slice needs — one group per
// extracted record/student; a delimited source's numeric groupBy-by-
// column-index is future work, not required by the current document
// family).
// operation: 'count' (occurrences of filter.pattern per group) or 'sum'
// (reserved for a future numeric-column source; delimited cells only,
// throws NotImplemented-style today since no current caller needs it).
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
  if (operation === 'sum') {
    throw new DocumentAggregateValidationError("operation 'sum' has no source column in this slice — not yet needed by any real caller");
  }

  return records.map((record) => ({
    key: record.key,
    serialNo: record.serialNo || null,
    regNo: record.regNo || null,
    count: matchCount(record, filter),
  }));
}

module.exports = { aggregate, DocumentAggregateValidationError };
