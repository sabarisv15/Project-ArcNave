'use strict';

// Unit tests for the shared import framework (task #18 — BusinessRules.md
// Central audit log and Import/Export): csvImporter.js/excelImporter.js
// (pure Importer Modules) and importService.js (parseImportFile
// dispatch + validateRows). No live Postgres needed anywhere in this
// file — these are pure functions, same as csvGenerator/excelGenerator's
// own test style.

const test = require('node:test');
const assert = require('node:assert/strict');
const csvImporter = require('../src/importers/csvImporter');
const excelGenerator = require('../src/generators/excelGenerator');
const excelImporter = require('../src/importers/excelImporter');
const importService = require('../src/services/importService');

test('csvImporter.parse', async (t) => {
  await t.test('parses headers (lowercased) and rows into plain objects', () => {
    const csv = 'Day_Of_Week,Hour_Index,Start_Time\nMonday,1,09:00\nTuesday,2,10:00\n';
    const { headers, rows } = csvImporter.parse(Buffer.from(csv, 'utf8'));
    assert.deepEqual(headers, ['day_of_week', 'hour_index', 'start_time']);
    assert.deepEqual(rows, [
      { day_of_week: 'Monday', hour_index: '1', start_time: '09:00' },
      { day_of_week: 'Tuesday', hour_index: '2', start_time: '10:00' },
    ]);
  });

  await t.test('handles quoted values containing commas and escaped quotes', () => {
    const csv = 'name,note\n"Smith, John","she said ""hi"""\n';
    const { rows } = csvImporter.parse(Buffer.from(csv, 'utf8'));
    assert.deepEqual(rows, [{ name: 'Smith, John', note: 'she said "hi"' }]);
  });

  await t.test('strips a leading UTF-8 BOM', () => {
    const csv = '﻿a,b\n1,2\n';
    const { headers } = csvImporter.parse(Buffer.from(csv, 'utf8'));
    assert.deepEqual(headers, ['a', 'b']);
  });

  await t.test('returns empty headers/rows for an empty file', () => {
    const result = csvImporter.parse(Buffer.from('', 'utf8'));
    assert.deepEqual(result, { headers: [], rows: [] });
  });
});

test('excelImporter.parse round-trips excelGenerator output', async (t) => {
  await t.test('reads back headers and row values from a real generated .xlsx', async () => {
    const reportModel = {
      title: 'Test Report',
      columns: [{ id: 'roll_no', label: 'roll_no' }, { id: 'full_name', label: 'full_name' }],
      rows: [{ roll_no: '35', full_name: 'Asha' }, { roll_no: '67', full_name: 'Ravi' }],
    };
    const bytes = await excelGenerator.generate(reportModel);
    const { headers, rows } = await excelImporter.parse(bytes);
    assert.deepEqual(headers, ['roll_no', 'full_name']);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].roll_no, '35');
    assert.equal(rows[1].full_name, 'Ravi');
  });
});

test('importService.parseImportFile', async (t) => {
  await t.test('rejects a missing fileBuffer', async () => {
    await assert.rejects(
      () => importService.parseImportFile(null, 'text/csv'),
      importService.ImportValidationError,
    );
  });

  await t.test('rejects an unsupported mimeType', async () => {
    await assert.rejects(
      () => importService.parseImportFile(Buffer.from('x'), 'application/pdf'),
      importService.ImportUnsupportedFormatError,
    );
  });

  await t.test('dispatches text/csv to csvImporter', async () => {
    const { rows } = await importService.parseImportFile(Buffer.from('a,b\n1,2\n', 'utf8'), 'text/csv');
    assert.deepEqual(rows, [{ a: '1', b: '2' }]);
  });
});

test('importService.validateRows', async (t) => {
  await t.test('reports a missing required field without dropping other valid rows', () => {
    const rows = [
      { day_of_week: 'Monday', hour_index: '1' },
      { day_of_week: '', hour_index: '2' },
    ];
    const { validRows, errors } = importService.validateRows(rows, { requiredFields: ['day_of_week', 'hour_index'] });
    assert.equal(validRows.length, 1);
    assert.equal(validRows[0].rowNumber, 1);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].rowNumber, 2);
    assert.match(errors[0].reason, /day_of_week/);
  });

  await t.test('drops fields not in allowedFields', () => {
    const rows = [{ day_of_week: 'Monday', hour_index: '1', unexpected_column: 'x' }];
    const { validRows } = importService.validateRows(rows, {
      requiredFields: ['day_of_week'], allowedFields: ['day_of_week', 'hour_index'],
    });
    assert.deepEqual(validRows[0].fields, { day_of_week: 'Monday', hour_index: '1' });
  });

  await t.test('keeps every field when allowedFields is omitted', () => {
    const rows = [{ a: '1', b: '2' }];
    const { validRows } = importService.validateRows(rows, {});
    assert.deepEqual(validRows[0].fields, { a: '1', b: '2' });
  });
});
