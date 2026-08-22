'use strict';

// Fixture below is a trimmed, verbatim-shaped excerpt of the real
// production extraction (documentTextExtractionService.extractPlainText,
// run against a real DTE examination result-sheet PDF, per the
// investigation behind bka/60-product-reasoning/ai-chat-result-sheet-evidence.md
// and ADR-029) — same page-break noise, same Absent/RA wrapping, same
// merged-record-across-a-page-break shape (serial 822), with the same
// manually cross-checked ground-truth counts (818 -> 0, 819 -> 4, 822 -> 8
// "RA" occurrences).

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractRecords } = require('../src/services/documentTableExtractionService');

const SAMPLE_TEXT = `818 25400121 AKASH B
DoB: 23.11.2008 4 R2023   B      A       A+       A+  A                O  O

819 25400122 ANBARASAN V
DoB: 24.04.2008 2 R2023 Absent
RA RA

3 R2023 RA

4 R2023 RA       B       A+       A+  A                O  O

822 25400125 AZHAGAR M
DoB: 24.09.2009 1 R2023                                                       B

2 R2023 RA RA Absent B B                                   Absent
                                                                                                   RA         RA

3 R2023 RA       B
DIRECTORATE OF TECHNICAL EDUCATION, CHENNAI - 600 025

BOARD EXAMINATIONS :: APRIL 2026

InsCode    Name of the Institution                         CCode                       Course Name                             Page
                                                                                                                                242
111      GOVERNMENT POLYTECHNIC COLLEGE, COIMBATORE        1040      ELECTRONICS AND COMMUNICATION ENGINEERING (FULL TIME)      10

## Reg No                                  Name  Sem Regl  1      2   3            4   5                6   7  8            9

822 25400125 AZHAGAR M
DoB: 24.09.2009 4 R2023 RA       RA  RA           B   B+               A   O`;

function countRa(block) {
  return (block.match(/\bRA\b/g) || []).length;
}

test('extractRecords: free-text sequential-id source is detected, not treated as delimited', () => {
  const { strategy } = extractRecords(SAMPLE_TEXT);
  assert.equal(strategy, 'sequential_id');
});

test('extractRecords: three distinct students detected — page-break repeat of 822 is merged into one record, not counted twice', () => {
  const { records } = extractRecords(SAMPLE_TEXT);
  const keys = records.map((r) => r.key);
  assert.deepEqual(keys, ['818:25400121', '819:25400122', '822:25400125']);
});

test('extractRecords: merged 822 record carries BOTH halves of its text (before and after the page-break noise)', () => {
  const { records } = extractRecords(SAMPLE_TEXT);
  const azhagar = records.find((r) => r.key === '822:25400125');
  assert.match(azhagar.block, /1 R2023/); // pre-page-break half
  assert.match(azhagar.block, /4 R2023/); // post-page-break half
});

test('extractRecords: RA occurrence counts match this session\'s manually verified ground truth', () => {
  const { records } = extractRecords(SAMPLE_TEXT);
  const byKey = Object.fromEntries(records.map((r) => [r.key, countRa(r.block)]));
  assert.equal(byKey['818:25400121'], 0);
  assert.equal(byKey['819:25400122'], 4);
  assert.equal(byKey['822:25400125'], 8);
});

test('extractRecords: page-break noise lines (institution/course header, page number) never falsely start a new record', () => {
  const { records } = extractRecords(SAMPLE_TEXT);
  // Exactly 3 records — "111 GOVERNMENT POLYTECHNIC..." and the bare page
  // number "242" must not be mistaken for a serial+regno pair.
  assert.equal(records.length, 3);
});

test('extractRecords: a pipe-delimited source (XLSX/ODS extractor output) is split into cells, not treated as sequential-id text', () => {
  const text = 'Sheet1\nName | RegNo | Result\nANBARASAN V | 25400122 | RA';
  const { strategy, records } = extractRecords(text);
  assert.equal(strategy, 'delimited');
  assert.deepEqual(records[0].cells, ['Name', 'RegNo', 'Result']);
  assert.deepEqual(records[1].cells, ['ANBARASAN V', '25400122', 'RA']);
});

test('extractRecords: prose text with no recognizable tabular structure returns strategy "none", never a guessed record shape', () => {
  const { strategy, records } = extractRecords('This is a plain paragraph of ordinary prose text, no table here.');
  assert.equal(strategy, 'none');
  assert.deepEqual(records, []);
});

test('extractRecords: empty/non-string input degrades to strategy "none" rather than throwing', () => {
  assert.deepEqual(extractRecords(''), { strategy: 'none', records: [] });
  assert.deepEqual(extractRecords(null), { strategy: 'none', records: [] });
});
