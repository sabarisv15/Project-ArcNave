'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  aggregate, summarize, validateFilterPattern, DocumentAggregateValidationError,
} = require('../src/services/documentAggregateService');

const RECORDS = [
  { key: '819:25400122', serialNo: '819', regNo: '25400122', block: '2 R2023 Absent\nRA RA\n3 R2023 RA\n4 R2023 RA B A+ A+ A O O' },
  { key: '820:25400123', serialNo: '820', regNo: '25400123', block: '1 R2023 RA B C' },
  { key: '821:25400124', serialNo: '821', regNo: '25400124', block: '1 R2023 C' },
];

test('aggregate: counts filter.pattern occurrences per record, never the model doing the arithmetic', () => {
  const results = aggregate(RECORDS, { filter: { pattern: 'RA' }, operation: 'count' });
  assert.deepEqual(results.map((r) => r.count), [4, 1, 0]);
});

test('aggregate: a name containing the pattern as a substring (e.g. "ANBARASAN" contains "RA") is NOT falsely counted — word-boundary matching only', () => {
  const records = [{ key: '1', block: '819 25400122 ANBARASAN V 4 R2023 B A+ A+ A O O' }];
  const results = aggregate(records, { filter: { pattern: 'RA' }, operation: 'count' });
  assert.equal(results[0].count, 0);
});

test('aggregate: works identically on delimited-cell records (cells joined before matching)', () => {
  const cellRecords = [{ key: '1', cells: ['ANBARASAN V', '25400122', 'RA'] }];
  const results = aggregate(cellRecords, { filter: { pattern: 'RA' }, operation: 'count' });
  assert.equal(results[0].count, 1);
});

test('aggregate: no filter.pattern -> zero for every record, not an error (an explicit "nothing to count" result)', () => {
  const results = aggregate(RECORDS, { operation: 'count' });
  assert.deepEqual(results.map((r) => r.count), [0, 0, 0]);
});

test('aggregate: rejects an operation outside the fixed enum — RS-AIG-018, never arbitrary code', () => {
  assert.throws(
    () => aggregate(RECORDS, { operation: 'exec', filter: { pattern: 'RA' } }),
    DocumentAggregateValidationError,
  );
});

test('aggregate: rejects an invalid regex pattern rather than letting it throw uncontrolled deep in String.match', () => {
  assert.throws(
    () => aggregate(RECORDS, { operation: 'count', filter: { pattern: '(unclosed' } }),
    DocumentAggregateValidationError,
  );
});

test('aggregate: "sum" totals each match\'s captured group as a number, per record', () => {
  const records = [
    { key: '1', block: 'Total Arrears: 4 Total Arrears: 3' },
    { key: '2', block: 'Total Arrears: 0' },
  ];
  const results = aggregate(records, { operation: 'sum', filter: { pattern: 'Total Arrears:\\s*(\\d+)' } });
  assert.deepEqual(results.map((r) => r.sum), [7, 0]);
});

test('aggregate: "sum" with no capturing group sums the whole match text as a number', () => {
  const records = [{ key: '1', block: 'arrear counts: 2 5 9' }];
  const results = aggregate(records, { operation: 'sum', filter: { pattern: '\\d+' } });
  assert.equal(results[0].sum, 16);
});

test('aggregate: "sum" skips a matched/captured value that is not a plain number rather than fabricating a total', () => {
  const records = [{ key: '1', block: 'RA RA Total Arrears: 5' }];
  const results = aggregate(records, { operation: 'sum', filter: { pattern: 'RA|Total Arrears:\\s*(\\d+)' } });
  assert.equal(results[0].sum, 5);
});

test('aggregate: filter.mode "include" returns only records with a non-zero count, a real filtered list', () => {
  const results = aggregate(RECORDS, { filter: { pattern: 'RA', mode: 'include' }, operation: 'count' });
  assert.deepEqual(results.map((r) => r.key), ['819:25400122', '820:25400123']);
});

test('aggregate: filter.mode "include" works for "sum" the same way — non-zero sum, not non-zero match count', () => {
  const records = [
    { key: '1', block: 'Total Arrears: 0' },
    { key: '2', block: 'Total Arrears: 3' },
  ];
  const results = aggregate(records, { operation: 'sum', filter: { pattern: 'Total Arrears:\\s*(\\d+)', mode: 'include' } });
  assert.deepEqual(results.map((r) => r.key), ['2']);
});

test('aggregate: filter.mode defaults to "annotate" (every record returned) when omitted', () => {
  const results = aggregate(RECORDS, { filter: { pattern: 'RA' }, operation: 'count' });
  assert.equal(results.length, RECORDS.length);
});

test('aggregate: rejects a filter.mode outside the fixed enum', () => {
  assert.throws(
    () => aggregate(RECORDS, { operation: 'count', filter: { pattern: 'RA', mode: 'exec' } }),
    DocumentAggregateValidationError,
  );
});

// --- summarize: the deterministic cross-record reduction (ADL-055 /
// ai-chat-document-analysis-payload-bounds-approved-spec.md) ---

test('summarize: totals across records — the arithmetic the model used to be handed thousands of rows to perform itself', () => {
  const rows = aggregate(RECORDS, { filter: { pattern: 'RA' }, operation: 'count' });
  const s = summarize(rows);
  assert.equal(s.total, 5); // 4 + 1 + 0
  assert.equal(s.matchedCount, 2); // the third record matched nothing
  assert.equal(s.scopedCount, 3);
});

test('summarize: samples from MATCHED records only — a sample of zero-count rows would spend the budget saying nothing', () => {
  const rows = aggregate(RECORDS, { filter: { pattern: 'RA' }, operation: 'count' });
  const s = summarize(rows, { sampleSize: 10 });
  assert.deepEqual(s.sample.map((r) => r.serialNo), ['819', '820']);
  assert.equal(s.sampleOmitted, 0);
});

test('summarize: over the cap, reports a truthful shown/omitted split — never a silent truncation', () => {
  const many = Array.from({ length: 250 }, (_, i) => ({ key: `k${i}`, block: 'RA' }));
  const rows = aggregate(many, { filter: { pattern: 'RA' }, operation: 'count' });
  const s = summarize(rows, { sampleSize: 100 });
  assert.equal(s.matchedCount, 250);
  assert.equal(s.total, 250);
  assert.equal(s.sampleShown, 100);
  assert.equal(s.sampleOmitted, 150);
  assert.equal(s.sampleShown + s.sampleOmitted, s.matchedCount);
});

test('summarize: at the prior slice\'s own documented scale (55 records, serial 818-872) every matching row is still listed — no behaviour change where it already worked', () => {
  const range = Array.from({ length: 55 }, (_, i) => ({ key: `${818 + i}`, block: 'RA' }));
  const rows = aggregate(range, { filter: { pattern: 'RA' }, operation: 'count' });
  const s = summarize(rows);
  assert.equal(s.matchedCount, 55);
  assert.equal(s.sampleShown, 55);
  assert.equal(s.sampleOmitted, 0);
});

test('summarize: bySemester rolls up across records for breakdown, and is absent (not empty) for count', () => {
  const records = [
    { key: 'a', block: '2 R2023 RA RA\n3 R2023 RA' },
    { key: 'b', block: '2 R2023 RA' },
  ];
  const breakdown = summarize(aggregate(records, { filter: { pattern: 'RA' }, operation: 'breakdown' }));
  assert.deepEqual(breakdown.bySemester, [{ semester: 2, count: 3 }, { semester: 3, count: 1 }]);
  const counted = summarize(aggregate(records, { filter: { pattern: 'RA' }, operation: 'count' }));
  assert.equal(counted.bySemester, undefined);
});

test('summarize: rejects a non-array, same fail-loudly posture as aggregate', () => {
  assert.throws(() => summarize('not an array'), DocumentAggregateValidationError);
});

// --- ADL-056: validateFilterPattern, the precondition that stops an
// uncompilable LLM-supplied pattern ending the whole /ai/ask turn as an
// HTTP 500 ---

test('validateFilterPattern: a valid pattern returns null (nothing to report)', () => {
  assert.equal(validateFilterPattern({ pattern: 'RA|Absent RA' }), null);
});

test('validateFilterPattern: an absent filter or pattern is not an error — both call sites already treat it as "no filter"', () => {
  assert.equal(validateFilterPattern(undefined), null);
  assert.equal(validateFilterPattern({}), null);
  assert.equal(validateFilterPattern({ pattern: '' }), null);
});

test('validateFilterPattern: an uncompilable pattern returns a reason naming filter.pattern, and does NOT throw', () => {
  const reason = validateFilterPattern({ pattern: '(?i)RA' });
  assert.match(reason, /^filter\.pattern is not valid JavaScript/);
});

// The central ADL-056 correction: stripping "(?i)" is safe for
// sectionPattern and a silent correctness bug here, because filter.pattern
// is deliberately case-sensitive. The message must point at casing, never
// imply the flag was merely redundant.
test('validateFilterPattern: the (?i) message tells the model filter.pattern is case-SENSITIVE, the opposite of the sectionPattern remedy', () => {
  const reason = validateFilterPattern({ pattern: '(?i)RA' });
  assert.match(reason, /case-sensitively by design/);
  assert.doesNotMatch(reason, /not needed/);
});

test('validateFilterPattern: an unbalanced group is rejected too — this is not a (?i)-specific check', () => {
  assert.match(validateFilterPattern({ pattern: 'RA(' }), /not valid JavaScript/);
});

// Guards the whole no-normalisation decision. If anyone ever adds a
// "normalisePattern" helper that strips inline flags before compiling,
// this test fails — which is exactly the point: ADL-056 rejected
// normalisation outright rather than deferring it.
test('validateFilterPattern: patterns are REJECTED, never rewritten — no normalisation is performed anywhere', () => {
  assert.notEqual(validateFilterPattern({ pattern: '(?i)RA' }), null);
  assert.notEqual(validateFilterPattern({ pattern: '(?P<code>RA)' }), null);
  assert.notEqual(validateFilterPattern({ pattern: '(?#comment)RA' }), null);
});

// A measured correction to this slice's own Approved Spec, which listed
// "\A, \Z and the rest" alongside (?i) and (?P<name>...) as syntax JS
// rejects. It does not: \A and \Z are IDENTITY ESCAPES in JavaScript, so
// "\ARA\Z" compiles silently as the literal "ARAZ" and matches the wrong
// thing entirely. That is a semantic divergence, not a compile failure,
// and this slice addresses compile failure only. Pinned here so the
// limitation is explicit rather than assumed covered by the check above.
test('validateFilterPattern: a Python anchor (\\A/\\Z) is NOT caught — it compiles as a literal, a known and deliberate gap', () => {
  assert.equal(validateFilterPattern({ pattern: '\\ARA\\Z' }), null);
  assert.equal(/\ARA\Z/.test('ARAZ'), true);
});

// The behavioural half of the same guard: if a future normalisation ever
// made filter.pattern case-insensitive, this fails.
test('aggregate: filter.pattern stays case-SENSITIVE — a pattern differing only in case does not match', () => {
  const records = [{ key: '1', block: '1 R2023 RA' }];
  assert.equal(aggregate(records, { filter: { pattern: 'RA' }, operation: 'count' })[0].count, 1);
  assert.equal(aggregate(records, { filter: { pattern: 'ra' }, operation: 'count' })[0].count, 0);
});

// validateFilterPattern is a PRECONDITION, not a replacement for the
// throw: a direct caller of aggregate() that skips it still fails loudly,
// because reaching compilePattern with an unvalidated pattern is a
// programming error rather than model input.
test('aggregate: called directly with an uncompilable pattern still throws — running the precondition is the caller responsibility', () => {
  assert.throws(
    () => aggregate(RECORDS, { filter: { pattern: '(?i)RA' }, operation: 'count' }),
    DocumentAggregateValidationError,
  );
});
