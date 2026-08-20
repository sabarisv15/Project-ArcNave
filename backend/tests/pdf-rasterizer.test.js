'use strict';

// Unit tests for pdfRasterizer — child_process.execFile is mocked
// (node:test's built-in mock on the module's own exported property,
// same "mock the direct dependency" convention this codebase already
// uses), with a side effect that writes fake PNG files into the same
// temp dir the real pdftoppm binary would write into — this proves the
// wrapper's own file-discovery/ordering/cleanup logic for real,
// without needing poppler-utils installed in this environment. The
// real pdftoppm CLI call itself is a live-verification concern (no
// poppler-utils binary available here), not re-proven by this file.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const childProcess = require('child_process');
const pdfRasterizer = require('../src/ocr/pdfRasterizer');

function mockPdftoppmWritingPages(t, pageContents, capturedTempDirHolder) {
  return t.mock.method(childProcess, 'execFile', (file, args, options, callback) => {
    // args: ['-png', '-r', '200', '-l', MAX_PAGES, inputPath, outputPrefix]
    const outputPrefix = args[args.length - 1];
    const dir = path.dirname(outputPrefix);
    if (capturedTempDirHolder) capturedTempDirHolder.value = dir;
    const total = pageContents.length;
    const writes = pageContents.map((content, i) => {
      const pageNum = i + 1;
      const padded = total >= 10 ? String(pageNum).padStart(2, '0') : String(pageNum);
      return fs.writeFile(path.join(dir, `page-${padded}.png`), content);
    });
    Promise.all(writes).then(() => callback(null, '', '')).catch(callback);
  });
}

test('rasterizePdfToImages: returns one buffer per page, in page order, and cleans up the temp dir', async (t) => {
  const tempDirHolder = {};
  const execFileMock = mockPdftoppmWritingPages(t, [Buffer.from('page-1-bytes'), Buffer.from('page-2-bytes'), Buffer.from('page-3-bytes')], tempDirHolder);
  t.after(() => execFileMock.mock.restore());

  const pages = await pdfRasterizer.rasterizePdfToImages(Buffer.from('%PDF-fake'));

  assert.equal(pages.length, 3);
  assert.equal(pages[0].toString(), 'page-1-bytes');
  assert.equal(pages[1].toString(), 'page-2-bytes');
  assert.equal(pages[2].toString(), 'page-3-bytes');

  await assert.rejects(() => fs.stat(tempDirHolder.value), { code: 'ENOENT' });
});

test('rasterizePdfToImages: sorts pages numerically, not lexically (page-10 after page-2)', async (t) => {
  const pageContents = Array.from({ length: 11 }, (_, i) => Buffer.from(`page-${i + 1}`));
  const execFileMock = mockPdftoppmWritingPages(t, pageContents);
  t.after(() => execFileMock.mock.restore());

  const pages = await pdfRasterizer.rasterizePdfToImages(Buffer.from('%PDF-fake'));
  assert.equal(pages.length, 11);
  assert.deepEqual(pages.map((p) => p.toString()), pageContents.map((p) => p.toString()));
});

test('rasterizePdfToImages: a pdftoppm failure is wrapped in PdfRasterizationError, and the temp dir is still cleaned up', async (t) => {
  let capturedTempDir;
  const execFileMock = t.mock.method(childProcess, 'execFile', (file, args, options, callback) => {
    capturedTempDir = path.dirname(args[args.length - 1]);
    callback(new Error('pdftoppm: command failed'));
  });
  t.after(() => execFileMock.mock.restore());

  await assert.rejects(
    () => pdfRasterizer.rasterizePdfToImages(Buffer.from('%PDF-fake')),
    pdfRasterizer.PdfRasterizationError,
  );
  await assert.rejects(() => fs.stat(capturedTempDir), { code: 'ENOENT' });
});

test('rasterizePdfToImages: zero output pages throws PdfRasterizationError', async (t) => {
  const execFileMock = t.mock.method(childProcess, 'execFile', (file, args, options, callback) => callback(null, '', ''));
  t.after(() => execFileMock.mock.restore());

  await assert.rejects(
    () => pdfRasterizer.rasterizePdfToImages(Buffer.from('%PDF-fake')),
    pdfRasterizer.PdfRasterizationError,
  );
});

// Regression test for Fix 7 (pre-launch audit, F6-1/F6-2): pdftoppm
// used to run with no timeout and no page-count ceiling at all.
test('rasterizePdfToImages: passes a page-count ceiling and an exec timeout to pdftoppm', async (t) => {
  let capturedArgs;
  let capturedOptions;
  const execFileMock = t.mock.method(childProcess, 'execFile', (file, args, options, callback) => {
    capturedArgs = args;
    capturedOptions = options;
    callback(new Error('short-circuit — this test only inspects the call, not the result'));
  });
  t.after(() => execFileMock.mock.restore());

  await assert.rejects(() => pdfRasterizer.rasterizePdfToImages(Buffer.from('%PDF-fake')), pdfRasterizer.PdfRasterizationError);

  assert.equal(capturedArgs[0], '-png');
  const lIndex = capturedArgs.indexOf('-l');
  assert.ok(lIndex !== -1, 'expected a -l (last page) flag to bound the page count');
  assert.equal(capturedArgs[lIndex + 1], String(pdfRasterizer.MAX_PAGES));
  assert.equal(capturedOptions.timeout, pdfRasterizer.EXEC_TIMEOUT_MS);
});
