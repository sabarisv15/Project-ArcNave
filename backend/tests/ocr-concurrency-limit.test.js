'use strict';

// Regression test for the pre-launch audit's F6-3 finding: no
// concurrency control existed on OCR at all — N simultaneous requests
// could spawn N simultaneous pdftoppm/Tesseract processes. Proves the
// limiter itself (ocr/ocrConcurrencyLimit.js) actually bounds
// concurrent execution and queues the rest, rather than just existing
// as an unused import.

const test = require('node:test');
const assert = require('node:assert/strict');
const { withOcrSlot, OCR_CONCURRENCY_LIMIT } = require('../src/ocr/ocrConcurrencyLimit');

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test('withOcrSlot never lets more than OCR_CONCURRENCY_LIMIT jobs run at once, and every job still completes', async () => {
  assert.equal(
    OCR_CONCURRENCY_LIMIT,
    2,
    'this test is written against the current limit of 2 — update both together if that ever changes',
  );

  const jobCount = 5;
  let concurrentNow = 0;
  let maxConcurrentSeen = 0;
  const gates = Array.from({ length: jobCount }, () => deferred());
  const completed = [];

  const runs = gates.map((gate, i) =>
    withOcrSlot(async () => {
      concurrentNow += 1;
      maxConcurrentSeen = Math.max(maxConcurrentSeen, concurrentNow);
      await gate.promise;
      concurrentNow -= 1;
      completed.push(i);
      return i;
    }),
  );

  // Let the first wave of microtasks/acquires settle, then release jobs
  // one at a time — proving a released slot picks up the next queued
  // job rather than the queue getting stuck.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    maxConcurrentSeen,
    OCR_CONCURRENCY_LIMIT,
    `expected exactly ${OCR_CONCURRENCY_LIMIT} jobs running concurrently, the rest queued`,
  );

  for (const gate of gates) {
    // eslint-disable-next-line no-await-in-loop
    gate.resolve();
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setImmediate(resolve));
  }

  const results = await Promise.all(runs);
  assert.deepEqual(results, [0, 1, 2, 3, 4], 'every job must still complete, in the order it was released');
  assert.equal(completed.length, jobCount);
  assert.ok(maxConcurrentSeen <= OCR_CONCURRENCY_LIMIT, 'concurrency must never have exceeded the limit at any point');
});

test('withOcrSlot: a job that throws still releases its slot for the next queued job', async () => {
  const first = withOcrSlot(async () => {
    throw new Error('job 1 fails on purpose');
  });
  await assert.rejects(first);

  // If the failed job's slot were never released, this would hang.
  const second = await withOcrSlot(async () => 'job 2 ran');
  assert.equal(second, 'job 2 ran');
});
