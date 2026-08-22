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

test('aggregate: "sum" is a declared-but-not-yet-implemented operation — throws clearly rather than silently returning zeros', () => {
  assert.throws(
    () => aggregate(RECORDS, { operation: 'sum', filter: { pattern: 'RA' } }),
    DocumentAggregateValidationError,
  );
});
