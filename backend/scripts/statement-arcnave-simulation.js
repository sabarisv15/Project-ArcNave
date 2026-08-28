'use strict';

// What would ARCNAVE's analyze_document_table actually return for this
// statement? Reproduces documentAnalysisService.analyzeAttachment's logic
// after the ownership/download step (which needs a DB row this file has no
// reason to create) — same services, same order, same statuses.
// Read-only, no LLM, no DB.

const fs = require('fs');
const path = require('path');

const tableExtraction = require('../src/services/documentTableExtractionService');
const aggregate = require('../src/services/documentAggregateService');

const TEXT = fs.readFileSync(path.join(__dirname, 'statement-extracted.txt'), 'utf8');

function analyze(text, { filter, operation = 'count', comparison, identityPattern } = {}) {
  const reason = aggregate.validateFilterPattern(filter);
  if (reason) return { status: 'invalid_pattern', parameter: 'filter.pattern', reason };
  const {
    strategy, records, sections, coverage,
  } = tableExtraction.extractRecords(text);
  if (strategy === 'none') return { status: 'unrecognized_layout' };
  if (coverage && coverage.applicable && !coverage.reliable) {
    return {
      status: 'unreliable_extraction', strategy, recordsDetected: records.length, rowsExpected: coverage.markerCount,
    };
  }
  if (records.length === 0) return { status: 'no_matching_records' };
  if (operation === 'compare') {
    const compiled = aggregate.compileIdentityPattern(identityPattern);
    const hasIntrinsic = records.some((r) => r.serialNo || r.regNo);
    if (!hasIntrinsic && !compiled.regex) return { status: 'identity_required' };
    const c = aggregate.compareRecords(records, { filter, comparison, identityPattern: compiled.regex });
    if (c.matchedCount === 0) return { status: 'no_matching_records' };
    return { status: 'ok', strategy, ...c };
  }
  const rows = aggregate.aggregate(records, { filter, operation });
  return {
    status: 'ok', strategy, sectionsDetected: sections.length, ...aggregate.summarize(rows),
  };
}

function show(label, result) {
  const shown = { ...result };
  if (shown.sample) shown.sample = shown.sample.slice(0, 3);
  console.log(`\n### ${label}`);
  console.log(JSON.stringify(shown, null, 2).split('\n').slice(0, 26).join('\n'));
}

// --- A. exactly what the model would try, against the document as-is ------
show('A1. "total PLB credit" -> operation sum, pattern captures the amount',
  analyze(TEXT, { operation: 'sum', filter: { pattern: 'PLB[^\\n]*?([\\d,]+\\.\\d{2})' } }));

show('A2. "how many PLB rows" -> operation count',
  analyze(TEXT, { operation: 'count', filter: { pattern: 'PLB', mode: 'include' } }));

show('A3. "PLB rows over 0" -> operation compare',
  analyze(TEXT, {
    operation: 'compare',
    filter: { pattern: 'PLB.*?([\\d,]+\\.\\d{2})' },
    comparison: { operator: 'gt', value: 0 },
    identityPattern: '(PLB[^0-9]*)',
  }));

// --- B. the same document with the 2 stray legend lines removed ----------
const NO_LEGEND = TEXT.split('\n').filter((l) => !l.includes(' | ')).join('\n');
show('B1. same call, after removing the 2 legend lines that contain " | "',
  analyze(NO_LEGEND, { operation: 'sum', filter: { pattern: 'PLB[^\\n]*?([\\d,]+\\.\\d{2})' } }));

// --- C. can `sum` even add an Indian-formatted amount? -------------------
console.log('\n### C. matchSum vs comma-formatted currency (no extraction involved)');
const oneRow = [{ key: 'r1', cells: ['08.04.2025 R2 6282520739 PLB FOR MARCH 25 TN 0.000 12,109.37 0.00 0.00 3,390.63 0.00 15,500.00'] }];
console.log('  sum of "15,500.00" via operation sum :',
  JSON.stringify(aggregate.aggregate(oneRow, { operation: 'sum', filter: { pattern: '([\\d,]+\\.\\d{2})$' } })));
console.log('  same value via compare\'s parseNumeric:',
  JSON.stringify(aggregate.compareRecords(oneRow, {
    filter: { pattern: '([\\d,]+\\.\\d{2})$' },
    comparison: { operator: 'gt', value: 0 },
    identityPattern: aggregate.compileIdentityPattern('(PLB[A-Z ]*)').regex,
  })));

// --- D. is category x month grouping expressible at all? ----------------
console.log('\n### D. grouping vocabulary');
try {
  aggregate.aggregate([{ key: 'a' }], { groupBy: 'category', filter: { pattern: 'PLB' }, operation: 'count' });
} catch (err) { console.log('  groupBy: "category" ->', err.message); }
try {
  aggregate.aggregate([{ key: 'a' }], { groupBy: 2, filter: { pattern: 'PLB' }, operation: 'count' });
} catch (err) { console.log('  groupBy: <column index> ->', err.message); }
console.log('  operations available   :', [...aggregate.OPERATIONS].join(', '));
console.log("  'breakdown' splits on  : /(\\d{1,2})\\s+R\\d{4}/g  (DTE semester marker — not a month)");
