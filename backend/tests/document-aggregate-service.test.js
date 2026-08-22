'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregate, DocumentAggregateValidationError } = require('../src/services/documentAggregateService');

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
