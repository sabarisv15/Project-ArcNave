'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  aggregate,
  summarize,
  compareRecords,
  validateFilterPattern,
  compileIdentityPattern,
  OPERATIONS,
  DocumentAggregateValidationError,
} = require('../src/services/documentAggregateService');

const RECORDS = [
  {
    key: '819:25400122',
    serialNo: '819',
    regNo: '25400122',
    block: '2 R2023 Absent\nRA RA\n3 R2023 RA\n4 R2023 RA B A+ A+ A O O',
  },
  { key: '820:25400123', serialNo: '820', regNo: '25400123', block: '1 R2023 RA B C' },
  { key: '821:25400124', serialNo: '821', regNo: '25400124', block: '1 R2023 C' },
];

test('aggregate: counts filter.pattern occurrences per record, never the model doing the arithmetic', () => {
  const results = aggregate(RECORDS, { filter: { pattern: 'RA' }, operation: 'count' });
  assert.deepEqual(
    results.map((r) => r.count),
    [4, 1, 0],
  );
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
  assert.deepEqual(
    results.map((r) => r.count),
    [0, 0, 0],
  );
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
  assert.deepEqual(
    results.map((r) => r.sum),
    [7, 0],
  );
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
  assert.deepEqual(
    results.map((r) => r.key),
    ['819:25400122', '820:25400123'],
  );
});

test('aggregate: filter.mode "include" works for "sum" the same way — non-zero sum, not non-zero match count', () => {
  const records = [
    { key: '1', block: 'Total Arrears: 0' },
    { key: '2', block: 'Total Arrears: 3' },
  ];
  const results = aggregate(records, {
    operation: 'sum',
    filter: { pattern: 'Total Arrears:\\s*(\\d+)', mode: 'include' },
  });
  assert.deepEqual(
    results.map((r) => r.key),
    ['2'],
  );
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
  assert.deepEqual(
    s.sample.map((r) => r.serialNo),
    ['819', '820'],
  );
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

test("summarize: at the prior slice's own documented scale (55 records, serial 818-872) every matching row is still listed — no behaviour change where it already worked", () => {
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
  assert.deepEqual(breakdown.bySemester, [
    { semester: 2, count: 3 },
    { semester: 3, count: 1 },
  ]);
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
  // \A/\Z are identity escapes in JS, not real anchors; that IS this
  // test's point (see the comment above and ADL-056) — "fixing" the
  // escape below would silently stop testing the actual behavior.
  // eslint-disable-next-line no-useless-escape
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

// --- ADL-057: operation 'compare', the numeric half of ADR-029's "filter"
// (ai-chat-document-numeric-comparison-approved-spec.md) ---

const DAYBOOK = [
  { key: null, cells: ['01-04-2026', 'ANBU TRADERS', 'Payment', '4500'] },
  { key: null, cells: ['02-04-2026', 'BHARATH STORES', 'Receipt', '12000'] },
  { key: null, cells: ['03-04-2026', 'CHITRA AGENCIES', 'Payment', '5000'] },
  { key: null, cells: ['04-04-2026', 'DEEPA SUPPLIES', 'Payment', '1,250'] },
  { key: null, cells: ['05-04-2026', 'ESWAR AND CO', 'Payment', 'n/a'] },
  { key: null, cells: ['06-04-2026', 'FATHIMA TRADERS', 'Opening balance'] },
];
const AMOUNT = '([\\d,]+)$';
const PARTY = '([A-Z]{2,}(?: [A-Z]{2,})*)';

function compareDaybook(overrides = {}) {
  return compareRecords(DAYBOOK, {
    filter: { pattern: AMOUNT },
    comparison: { operator: 'lt', value: 5000 },
    ...overrides,
  });
}

test("compareRecords: 'lt' returns only the rows under the threshold — the question that was inexpressible before", () => {
  const result = compareDaybook();
  assert.equal(result.matchedCount, 2);
  assert.deepEqual(
    result.sample.map((r) => r.value),
    [4500, 1250],
  );
});

test('compareRecords: scopedCount is the rows CONSIDERED, not the rows that passed', () => {
  const result = compareDaybook();
  assert.equal(result.scopedCount, DAYBOOK.length);
  assert.notEqual(result.scopedCount, result.matchedCount);
});

test('compareRecords: boundary — lt excludes the threshold, lte includes it', () => {
  assert.equal(compareDaybook().matchedCount, 2);
  assert.equal(compareDaybook({ comparison: { operator: 'lte', value: 5000 } }).matchedCount, 3);
});

test("compareRecords: 'gt' / 'gte' mirror it at the other end", () => {
  assert.equal(compareDaybook({ comparison: { operator: 'gt', value: 5000 } }).matchedCount, 1);
  assert.equal(compareDaybook({ comparison: { operator: 'gte', value: 5000 } }).matchedCount, 2);
});

test("compareRecords: 'between' is inclusive at BOTH ends", () => {
  const result = compareDaybook({ comparison: { operator: 'between', value: 4500, upperValue: 12000 } });
  assert.deepEqual(
    result.sample.map((r) => r.value),
    [4500, 12000, 5000],
  );
});

test('compareRecords: total is the sum of the matching rows own values, computed here and not by the model', () => {
  assert.equal(compareDaybook().total, 5750);
});

// The one normalisation this slice permits, scoped to compare alone.
test('compareRecords: "1,250" parses — comma separators are presentation, not value', () => {
  assert.ok(compareDaybook().sample.some((r) => r.value === 1250));
});

// A captured "Rs." prefix is stripped by parseNumeric rather than making
// the row non-numeric — the caller can capture the whole money token and
// still get a number.
test('compareRecords: a captured Rs. prefix is stripped, not treated as unparseable', () => {
  const result = compareRecords([{ key: null, cells: ['Y', 'Rs. 900'] }], {
    filter: { pattern: '(Rs\\.?\\s*[\\d,]+)' },
    comparison: { operator: 'lt', value: 5000 },
  });
  assert.equal(result.sample[0].value, 900);
});

// Same root cause as the minus sign below: compilePattern's \b(?:...)\b
// wrapping means a pattern that STARTS with a non-word character can never
// match, so "₹4,500" is not reachable by a pattern beginning with ₹. The
// caller anchors on the digits instead. Pinned so this is a known
// limitation rather than a mystery empty result.
test('compareRecords: a pattern starting with ₹ cannot match — word-boundary wrapping again', () => {
  const rows = [{ key: null, cells: ['X', '₹4,500'] }];
  const viaSymbol = compareRecords(rows, {
    filter: { pattern: '₹\\s*([\\d,]+)' },
    comparison: { operator: 'lt', value: 5000 },
  });
  assert.equal(viaSymbol.matchedCount, 0);
  assert.equal(viaSymbol.unmatchedRows, 1);
  const viaDigits = compareRecords(rows, {
    filter: { pattern: '([\\d,]+)$' },
    comparison: { operator: 'lt', value: 5000 },
  });
  assert.equal(viaDigits.sample[0].value, 4500);
});

// The three honesty counts. A threshold answer computed over a subset,
// with no signal that it was a subset, is the silent-false-positive class
// item 1 slice 1 shipped to remove.
test('compareRecords: a row whose captured text is not a number is counted, never coerced to 0', () => {
  assert.equal(compareDaybook().nonNumericRows, 0);
  const loose = compareRecords(DAYBOOK, {
    filter: { pattern: '(\\S+)$' },
    comparison: { operator: 'lt', value: 5000 },
  });
  assert.ok(loose.nonNumericRows > 0);
  assert.ok(loose.sample.every((r) => typeof r.value === 'number'));
});

test('compareRecords: a row the pattern never matched is counted as unmatched, not as zero', () => {
  assert.equal(compareDaybook().unmatchedRows, 2);
});

test('compareRecords: a row matching several numbers is counted as ambiguous, and the FIRST match is used', () => {
  const rows = [{ key: null, cells: ['700', 'X', '4000'] }];
  const result = compareRecords(rows, {
    filter: { pattern: '(\\d+)' },
    comparison: { operator: 'lt', value: 5000 },
  });
  assert.equal(result.multiMatchRows, 1);
  assert.equal(result.sample[0].value, 700);
});

// The section 15 decision: row identity is caller-supplied data, the same
// way filter.pattern and sectionPattern already are.
test('compareRecords: identityPattern gives each matching row something to be identified by', () => {
  const result = compareDaybook({ identityPattern: new RegExp(PARTY) });
  assert.deepEqual(
    result.sample.map((r) => r.identity.trim()),
    ['ANBU TRADERS', 'DEEPA SUPPLIES'],
  );
});

test('compareRecords: a row identityPattern cannot name is counted, not silently blank', () => {
  const result = compareRecords([{ key: null, cells: ['01-04-2026', '123 456', '4500'] }], {
    filter: { pattern: AMOUNT },
    comparison: { operator: 'lt', value: 5000 },
    identityPattern: new RegExp(PARTY),
  });
  assert.equal(result.matchedCount, 1);
  assert.equal(result.sample[0].identity, null);
  assert.equal(result.rowsWithoutIdentity, 1);
});

// Regression against a stateful-regex bug: a global identityPattern would
// carry lastIndex between records, so a row's identity would depend on
// which rows preceded it.
test('compareRecords: identity extraction is stateless across rows', () => {
  const first = compareDaybook({ identityPattern: new RegExp(PARTY) });
  const second = compareDaybook({ identityPattern: new RegExp(PARTY) });
  assert.deepEqual(
    first.sample.map((r) => r.identity),
    second.sample.map((r) => r.identity),
  );
});

// A value of exactly 0 (or a negative one — a day book credit) is a
// legitimately PASSING row. summarize's `rowValue(row) > 0` derivation
// would drop it from both the count and the sample, which is why compare
// does not route through summarize. A correction to this slice's own spec.
test('compareRecords: a passing value of exactly 0 is kept, not dropped as if it were "no match"', () => {
  const result = compareRecords([{ key: null, cells: ['ZERO ENTRY', '0'] }], {
    filter: { pattern: '(\\d+)$' },
    comparison: { operator: 'lt', value: 5000 },
  });
  assert.equal(result.matchedCount, 1);
  assert.equal(result.sample[0].value, 0);
});

// parseNumeric itself handles a sign, but filter.pattern cannot DELIVER
// one: compilePattern wraps every pattern as \b(?:...)\b (ADL-055's fix for
// "RA" matching inside "ANBARASAN"), and a leading "-" is not a word
// character, so the boundary lands after it and "-250" captures as "250".
// A known, inherited limitation of compare, pinned here rather than left
// to be rediscovered as a wrong answer: a negative-threshold question
// ("entries below zero") is NOT expressible today. Recorded in the ADL-057
// addendum; it needs its own pass, because the fix would mean changing a
// shipped, verified operation's matching rule.
test('compareRecords: a leading minus sign is NOT captured — word-boundary wrapping strips it, a known limitation', () => {
  const result = compareRecords([{ key: null, cells: ['CREDIT', '-250'] }], {
    filter: { pattern: '(-?\\d+)$' },
    comparison: { operator: 'lt', value: 0 },
  });
  assert.equal(result.matchedCount, 0);
  const positive = compareRecords([{ key: null, cells: ['CREDIT', '-250'] }], {
    filter: { pattern: '(-?\\d+)$' },
    comparison: { operator: 'gt', value: 0 },
  });
  assert.equal(positive.sample[0].value, 250);
});

// The parser's own half of that: given text that DOES carry the sign, it
// parses correctly. Only the delivery path is limited, not the arithmetic.
test('compareRecords: a negative value that reaches the parser intact compares correctly', () => {
  const result = compareRecords([{ key: null, cells: ['CREDIT', 'BAL-250'] }], {
    filter: { pattern: 'BAL(-\\d+)' },
    comparison: { operator: 'lt', value: 0 },
  });
  assert.equal(result.matchedCount, 1);
  assert.equal(result.sample[0].value, -250);
});

test('compareRecords: the sample is bounded and sampleOmitted stays truthful', () => {
  const many = Array.from({ length: 150 }, (_, i) => ({ key: null, cells: [`P${i}`, '10'] }));
  const result = compareRecords(many, {
    filter: { pattern: '(\\d+)$' },
    comparison: { operator: 'lt', value: 5000 },
    sampleSize: 100,
  });
  assert.equal(result.matchedCount, 150);
  assert.equal(result.sampleShown, 100);
  assert.equal(result.sampleOmitted, 50);
});

// --- compare: validation, all returning DocumentAggregateValidationError ---

test('compareRecords: rejects a missing comparison', () => {
  assert.throws(() => compareRecords(DAYBOOK, { filter: { pattern: AMOUNT } }), DocumentAggregateValidationError);
});

test('compareRecords: rejects an operator outside the closed set — RS-AIG-018, never arbitrary logic', () => {
  assert.throws(
    () => compareDaybook({ comparison: { operator: 'regex', value: 1 } }),
    DocumentAggregateValidationError,
  );
});

test('compareRecords: rejects a non-finite comparison.value', () => {
  assert.throws(
    () => compareDaybook({ comparison: { operator: 'lt', value: 'cheap' } }),
    DocumentAggregateValidationError,
  );
  assert.throws(
    () => compareDaybook({ comparison: { operator: 'lt', value: Infinity } }),
    DocumentAggregateValidationError,
  );
});

test("compareRecords: 'between' without upperValue is rejected", () => {
  assert.throws(
    () => compareDaybook({ comparison: { operator: 'between', value: 1 } }),
    DocumentAggregateValidationError,
  );
});

// Rejected rather than ignored: an upperValue that silently does nothing
// looks to the caller like a range it never actually got.
test('compareRecords: upperValue on a non-between operator is rejected, not ignored', () => {
  assert.throws(
    () => compareDaybook({ comparison: { operator: 'lt', value: 1, upperValue: 9 } }),
    DocumentAggregateValidationError,
  );
});

test("compareRecords: filter.mode 'annotate' is rejected — compare is always a filtered list", () => {
  assert.throws(
    () => compareDaybook({ filter: { pattern: AMOUNT, mode: 'annotate' } }),
    DocumentAggregateValidationError,
  );
});

test('compareRecords: a missing filter.pattern is rejected rather than treated as "no filter"', () => {
  assert.throws(
    () => compareRecords(DAYBOOK, { comparison: { operator: 'lt', value: 5000 } }),
    DocumentAggregateValidationError,
  );
});

test("aggregate: 'compare' is in the closed vocabulary but has its own entry point", () => {
  assert.ok(OPERATIONS.has('compare'));
  assert.throws(() => aggregate(DAYBOOK, { operation: 'compare', filter: { pattern: AMOUNT } }), /own entry point/);
});

// --- compileIdentityPattern: the third LLM-supplied regex (ADL-056 rules) ---

test('compileIdentityPattern: a valid pattern compiles; an absent one is not an error', () => {
  assert.ok(compileIdentityPattern(PARTY).regex instanceof RegExp);
  assert.equal(compileIdentityPattern(undefined).regex, null);
});

test('compileIdentityPattern: an uncompilable pattern returns a reason naming identityPattern, and does NOT throw', () => {
  const { reason, regex } = compileIdentityPattern('(?i)ANBU');
  assert.equal(regex, undefined);
  assert.match(reason, /^identityPattern is not valid JavaScript/);
  assert.match(reason, /case-sensitively/);
});

// identityPattern is compiled PLAIN — no word-boundary wrapping (it
// extracts a name, not a token) and no 'i' flag. Pins that it does not
// share compilePattern's or compileSectionPattern's treatment, which is
// ADL-056's finding applied to the new parameter.
test('compileIdentityPattern: compiles plainly — no added flags, no wrapping', () => {
  const { regex } = compileIdentityPattern('anbu');
  assert.equal(regex.flags, '');
  assert.equal(regex.source, 'anbu');
  assert.equal(regex.test('ANBU'), false);
});

// The spec's own required pin: breakdown depends on `total` being read
// first, so no future key may be inserted ahead of it.
test('summarize: rowValue reads `total` before `sum` before `count` — breakdown depends on this order', () => {
  assert.equal(summarize([{ key: '1', total: 7, sum: 99, count: 42 }]).total, 7);
  assert.equal(summarize([{ key: '1', sum: 99, count: 42 }]).total, 99);
  assert.equal(summarize([{ key: '1', count: 42 }]).total, 42);
});
