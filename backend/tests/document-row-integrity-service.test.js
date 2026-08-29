'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessRowIntegrity } = require('../src/services/documentRowIntegrityService');

// Real record shape from documentTableExtractionService's 'sequential_id'
// strategy: { key, serialNo, regNo, startLine, block }. Only serialNo,
// regNo and block matter to this module.
function record(serialNo, regNo, dob, trailingNumbers) {
  return {
    serialNo,
    regNo,
    startLine: 0,
    // A non-numeric name — reusing serialNo in the name text would leave a
    // stray digit behind after stripping (String.replace only removes the
    // FIRST occurrence), contaminating the extracted numeric vector.
    block: `${serialNo} ${regNo} STUDENT NAME DoB: ${dob} ${trailingNumbers.join(' ')}`,
  };
}

// arrears, fees(=arrears*65), semFee(=625, constant), total(=fees+semFee) —
// the same two-relation shape measured against the real exam-fees PDF
// (backend/scripts/row-arithmetic-consistency-probe.js), reconstructed
// here as a synthetic fixture so this test never depends on the real PII
// document.
function feeRecords(rows) {
  return rows.map(([serial, arrears], i) => {
    const fees = arrears * 65;
    const total = fees + 625;
    return record(String(serial), `2024000${i}`, `0${i + 1}.0${i + 1}.2005`, [arrears, fees, 625, total]);
  });
}

test('assessRowIntegrity: verifies a document whose numbers carry two independent, non-hand-fit relations', () => {
  const records = feeRecords([[101, 1], [102, 0], [103, 2], [104, 0], [105, 3]]);
  const result = assessRowIntegrity(records);
  assert.equal(result.verified, true);
  assert.ok(result.relations.length >= 2, `expected >= 2 relations, got ${result.relations.length}`);
  assert.ok(result.relations.some((r) => r.type === 'scale'));
  assert.ok(result.relations.some((r) => r.type === 'sum'));
});

test('assessRowIntegrity: fewer than MIN_RECORDS never verifies, even with perfect arithmetic', () => {
  const records = feeRecords([[101, 1], [102, 0], [103, 2]]);
  const result = assessRowIntegrity(records);
  assert.equal(result.verified, false);
});

test('assessRowIntegrity: a document with no discoverable arithmetic relation is left unverified, not guessed at', () => {
  const records = [
    record('101', '20240001', '01.01.2005', [7, 3, 19, 4]),
    record('102', '20240002', '02.02.2005', [2, 9, 1, 8]),
    record('103', '20240003', '03.03.2005', [5, 5, 5, 5]),
    record('104', '20240004', '04.04.2005', [11, 2, 6, 1]),
    record('105', '20240005', '05.05.2005', [3, 3, 14, 9]),
  ];
  const result = assessRowIntegrity(records);
  assert.equal(result.verified, false);
});

// The measured degenerate case this module exists to avoid: every row
// reading zero in the tested positions would trivially "satisfy" any
// scale/sum relation, and that must not be credited as evidence.
test('assessRowIntegrity: an all-zero column is never credited as a verified relation on its own', () => {
  const records = [
    record('101', '20240001', '01.01.2005', [0, 0, 0]),
    record('102', '20240002', '02.02.2005', [0, 0, 0]),
    record('103', '20240003', '03.03.2005', [0, 0, 0]),
    record('104', '20240004', '04.04.2005', [0, 0, 0]),
    record('105', '20240005', '05.05.2005', [0, 0, 0]),
  ];
  const result = assessRowIntegrity(records);
  assert.equal(result.verified, false);
});

test('assessRowIntegrity: a record whose trailing free-text numbers vary in count does not block verification of the shared leading columns', () => {
  const base = [[101, 1], [102, 0], [103, 2], [104, 0], [105, 3]];
  const records = feeRecords(base).map((r, i) => ({
    ...r,
    // Real pdfplumber reconstructions carry a variable-length arrears-
    // subject breakdown after the fixed fee block (measured: 14/23 real
    // rows in the exam-fees PDF have this shape) — the widest FULLY
    // COVERED prefix must still be found and verified despite it.
    block: `${r.block} ${'0 '.repeat(i).trim()}`.trim(),
  }));
  const result = assessRowIntegrity(records);
  assert.equal(result.verified, true);
  assert.equal(result.width, 4);
});

test('assessRowIntegrity: non-array or empty input never throws', () => {
  assert.equal(assessRowIntegrity(null).verified, false);
  assert.equal(assessRowIntegrity([]).verified, false);
  assert.equal(assessRowIntegrity(undefined).verified, false);
});
