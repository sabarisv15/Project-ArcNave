'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const cacheModule = require('../src/services/documentTextExtractionCache');

beforeEach(() => {
  cacheModule._reset();
});

test('getOrExtract calls extractFn on a miss and returns cacheHit: false', async () => {
  let calls = 0;
  const result = await cacheModule.getOrExtract('doc-1', async () => {
    calls += 1;
    return { text: 'hello', method: 'mammoth' };
  });
  assert.equal(calls, 1);
  assert.equal(result.text, 'hello');
  assert.equal(result.method, 'mammoth');
  assert.equal(result.cacheHit, false);
});

test('getOrExtract serves a cached result on the second call for the same id, without calling extractFn again', async () => {
  let calls = 0;
  const extractFn = async () => {
    calls += 1;
    return { text: 'hello', method: 'mammoth' };
  };

  const first = await cacheModule.getOrExtract('doc-1', extractFn);
  const second = await cacheModule.getOrExtract('doc-1', extractFn);

  assert.equal(calls, 1);
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(second.text, 'hello');
});

test('getOrExtract caches a failure result too (failureReason), not just a success', async () => {
  let calls = 0;
  const extractFn = async () => {
    calls += 1;
    return { text: null, failureReason: 'corrupt_or_unreadable' };
  };

  const first = await cacheModule.getOrExtract('doc-2', extractFn);
  const second = await cacheModule.getOrExtract('doc-2', extractFn);

  assert.equal(calls, 1);
  assert.equal(first.text, null);
  assert.equal(second.failureReason, 'corrupt_or_unreadable');
  assert.equal(second.cacheHit, true);
});

test('getOrExtract keys independently per attachmentId', async () => {
  let calls = 0;
  const extractFn = async () => {
    calls += 1;
    return { text: `text-${calls}`, method: 'mammoth' };
  };

  const a = await cacheModule.getOrExtract('doc-a', extractFn);
  const b = await cacheModule.getOrExtract('doc-b', extractFn);

  assert.equal(calls, 2);
  assert.notEqual(a.text, b.text);
});

test('evicts the oldest entry once MAX_ENTRIES is exceeded', async () => {
  const extractFn = async () => ({ text: 'x', method: 'mammoth' });

  // Fill exactly to MAX_ENTRIES, then add one more — the very first key
  // inserted should be evicted (insertion-order Map), forcing a
  // re-extract on next lookup.
  for (let i = 0; i < cacheModule.MAX_ENTRIES; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await cacheModule.getOrExtract(`doc-${i}`, extractFn);
  }
  await cacheModule.getOrExtract('doc-overflow', extractFn);

  let calls = 0;
  await cacheModule.getOrExtract('doc-0', async () => {
    calls += 1;
    return { text: 'x', method: 'mammoth' };
  });
  assert.equal(calls, 1, 'doc-0 should have been evicted and re-extracted');
});

test('_reset clears every cached entry', async () => {
  await cacheModule.getOrExtract('doc-1', async () => ({ text: 'hello', method: 'mammoth' }));
  cacheModule._reset();

  let calls = 0;
  await cacheModule.getOrExtract('doc-1', async () => {
    calls += 1;
    return { text: 'hello again', method: 'mammoth' };
  });
  assert.equal(calls, 1);
});
