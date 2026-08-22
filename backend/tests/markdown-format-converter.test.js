'use strict';

// Unit tests for the markdown export pipeline added this round —
// markdownTableParser.js + markdownFormatConverter.js — no DB needed,
// same "pure function, real bytes" testing style
// ai-service.test.js's buildAttachmentHint tests already use for
// generator-adjacent code.

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTableAt, findFirstTable } = require('../src/generators/markdownTableParser');
const converter = require('../src/generators/markdownFormatConverter');

const SAMPLE_MARKDOWN = '# ECE 1040 vs 2040\n\n'
  + 'This compares two programmes.\n\n'
  + '## Results\n\n'
  + '| Sl No | Name | Marks |\n'
  + '| --- | --- | --- |\n'
  + '| 1 | Alice | 88 |\n'
  + '| 2 | Bob | 91 |\n\n'
  + 'End of report.';

test('markdownTableParser.findFirstTable: extracts a GFM pipe-table into ReportModel shape', () => {
  const table = findFirstTable(SAMPLE_MARKDOWN);
  assert.deepEqual(table.columns.map((c) => c.label), ['Sl No', 'Name', 'Marks']);
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0][table.columns[0].id], '1');
  assert.equal(table.rows[0][table.columns[1].id], 'Alice');
});

test('markdownTableParser.findFirstTable: no table anywhere -> null', () => {
  assert.equal(findFirstTable('# Just prose\n\nNo tables here.'), null);
});

test('markdownTableParser.findFirstTable: finds the FIRST of multiple tables, not the last', () => {
  const md = '| A | B |\n| --- | --- |\n| 1 | 2 |\n\ntext between\n\n| C | D |\n| --- | --- |\n| 3 | 4 |';
  const table = findFirstTable(md);
  assert.deepEqual(table.columns.map((c) => c.label), ['A', 'B']);
});

test('markdownTableParser.parseTableAt: a pipe row with no separator right after it is not a table', () => {
  const lines = ['| looks like a table |', 'but this is not a separator row', '| more pipes |'];
  assert.equal(parseTableAt(lines, 0), null);
});

test('markdownTableParser.parseTableAt: returns endIndex pointing past the last data row', () => {
  const lines = ['| A | B |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |', 'not a table row'];
  const table = parseTableAt(lines, 0);
  assert.equal(table.endIndex, 4);
  assert.equal(table.rows.length, 2);
});

test('markdownFormatConverter.convert: markdown format is a byte-identical passthrough', async () => {
  const { buffer, mimeType, extension } = await converter.convert({ title: 'T', markdown: 'hello' }, 'markdown');
  assert.equal(buffer.toString('utf8'), 'hello');
  assert.equal(mimeType, 'text/markdown');
  assert.equal(extension, 'md');
});

test('markdownFormatConverter.convert: txt format is also a byte-identical passthrough (same source, different label)', async () => {
  const { buffer, mimeType } = await converter.convert({ title: 'T', markdown: 'hello' }, 'txt');
  assert.equal(buffer.toString('utf8'), 'hello');
  assert.equal(mimeType, 'text/plain');
});

for (const format of ['docx', 'pdf', 'pptx']) {
  test(`markdownFormatConverter.convert: ${format} produces real, non-trivial binary output`, async () => {
    const { buffer, mimeType, extension } = await converter.convert({ title: 'ECE Report', markdown: SAMPLE_MARKDOWN }, format);
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 500, `${format} output should be a real document, not a stub`);
    assert.equal(extension, format);
    assert.ok(mimeType.startsWith('application/'));
  });
}

for (const format of ['csv', 'xlsx']) {
  test(`markdownFormatConverter.convert: ${format} extracts the table into real rows`, async () => {
    const { buffer } = await converter.convert({ title: 'ECE Report', markdown: SAMPLE_MARKDOWN }, format);
    assert.ok(buffer.length > 0);
    if (format === 'csv') {
      assert.ok(buffer.toString('utf8').includes('Alice'));
    }
  });

  test(`markdownFormatConverter.convert: ${format} with no table throws MarkdownConversionError`, async () => {
    await assert.rejects(
      () => converter.convert({ title: 'T', markdown: '# Just prose\n\nNo tables here.' }, format),
      converter.MarkdownConversionError,
    );
  });
}

test('markdownFormatConverter.convert: an unsupported format throws MarkdownConversionError', async () => {
  await assert.rejects(
    () => converter.convert({ title: 'T', markdown: 'x' }, 'exe'),
    converter.MarkdownConversionError,
  );
});
