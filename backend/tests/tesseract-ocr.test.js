'use strict';

// Unit tests for the tesseractOcr wrapper — Tesseract.recognize is
// mocked (node:test's built-in mock on the tesseract.js module's own
// exported property, same "mock the direct dependency" convention this
// codebase already uses elsewhere), no real OCR run (that would need a
// real image fixture and take real wall-clock time neither this test
// nor the suite it runs in needs).

const test = require('node:test');
const assert = require('node:assert/strict');
const Tesseract = require('tesseract.js');
const tesseractOcr = require('../src/ocr/tesseractOcr');

test("extractTextFromImage: returns the trimmed recognized text and Tesseract's own confidence", async (t) => {
  const recognizeMock = t.mock.method(Tesseract, 'recognize', async () => ({
    data: { text: '  Hello from the image  \n', confidence: 92.5 },
  }));
  t.after(() => recognizeMock.mock.restore());

  const result = await tesseractOcr.extractTextFromImage(Buffer.from('fake-image-bytes'));
  assert.equal(result.text, 'Hello from the image');
  assert.equal(result.confidence, 92.5);
  assert.equal(recognizeMock.mock.calls[0].arguments[1], 'eng');
});

test('extractTextFromImage: passes a caller-supplied lang straight through to Tesseract (e.g. multilingual "eng+tam")', async (t) => {
  const recognizeMock = t.mock.method(Tesseract, 'recognize', async () => ({ data: { text: 'hi', confidence: 80 } }));
  t.after(() => recognizeMock.mock.restore());

  await tesseractOcr.extractTextFromImage(Buffer.from('fake-image-bytes'), 'eng+tam');
  assert.equal(recognizeMock.mock.calls[0].arguments[1], 'eng+tam');
});

test('extractTextFromImage: missing confidence in the Tesseract result defaults to 0, not undefined/NaN', async (t) => {
  const recognizeMock = t.mock.method(Tesseract, 'recognize', async () => ({ data: { text: 'hi' } }));
  t.after(() => recognizeMock.mock.restore());

  const result = await tesseractOcr.extractTextFromImage(Buffer.from('fake-image-bytes'));
  assert.equal(result.confidence, 0);
});

test('extractTextFromImage: a Tesseract failure is wrapped in OcrExtractionError, not thrown raw', async (t) => {
  const recognizeMock = t.mock.method(Tesseract, 'recognize', async () => {
    throw new Error('worker crashed');
  });
  t.after(() => recognizeMock.mock.restore());

  await assert.rejects(
    () => tesseractOcr.extractTextFromImage(Buffer.from('fake-image-bytes')),
    tesseractOcr.OcrExtractionError,
  );
});

test('extractTextFromPages: creates one worker, reuses it across every page in order, then terminates it', async (t) => {
  let call = 0;
  const workerStub = {
    recognize: async () => {
      call += 1;
      return call === 1
        ? { data: { text: 'page one', confidence: 80 } }
        : { data: { text: 'page two', confidence: 60 } };
    },
    terminate: async () => {},
  };
  const recognizeMock = t.mock.method(workerStub, 'recognize');
  const terminateMock = t.mock.method(workerStub, 'terminate');
  const createWorkerMock = t.mock.method(Tesseract, 'createWorker', async () => workerStub);
  t.after(() => createWorkerMock.mock.restore());

  const results = await tesseractOcr.extractTextFromPages([Buffer.from('p1'), Buffer.from('p2')], 'eng');

  assert.equal(createWorkerMock.mock.callCount(), 1);
  assert.equal(createWorkerMock.mock.calls[0].arguments[0], 'eng');
  assert.equal(recognizeMock.mock.callCount(), 2);
  assert.deepEqual(results, [
    { text: 'page one', confidence: 80 },
    { text: 'page two', confidence: 60 },
  ]);
  assert.equal(terminateMock.mock.callCount(), 1);
});

test('extractTextFromPages: an empty page list creates no worker and returns an empty array', async (t) => {
  const createWorkerMock = t.mock.method(Tesseract, 'createWorker', async () => {
    throw new Error('must not be called');
  });
  t.after(() => createWorkerMock.mock.restore());

  const results = await tesseractOcr.extractTextFromPages([]);
  assert.deepEqual(results, []);
  assert.equal(createWorkerMock.mock.callCount(), 0);
});

test('extractTextFromPages: the worker is still terminated when a page recognize() call fails', async (t) => {
  const workerStub = {
    recognize: async () => {
      throw new Error('worker crashed mid-page');
    },
    terminate: async () => {},
  };
  const terminateMock = t.mock.method(workerStub, 'terminate');
  const createWorkerMock = t.mock.method(Tesseract, 'createWorker', async () => workerStub);
  t.after(() => createWorkerMock.mock.restore());

  await assert.rejects(() => tesseractOcr.extractTextFromPages([Buffer.from('p1')]), tesseractOcr.OcrExtractionError);
  assert.equal(terminateMock.mock.callCount(), 1);
});
