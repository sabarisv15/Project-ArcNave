'use strict';

// ARCNAVE modernization P1 (PDF 1.15/4.4) — proves tracer.js's core
// claim: spans opened inside a withSpan() callback are children of
// the outer span (same traceId, parentSpanId pointing at the outer
// span's id), which is what "one turn shows as one tree" actually
// depends on.

const test = require('node:test');
const assert = require('node:assert/strict');
const { runWithRequestContext } = require('../src/logging/context');
const { startSpan, withSpan } = require('../src/tracing/tracer');

function captureLogLines(fn) {
  const original = console.log;
  const lines = [];
  console.log = (text) => lines.push(JSON.parse(text));
  return fn()
    .finally(() => {
      console.log = original;
    })
    .then(() => lines);
}

test('spans opened within the same request share one traceId', async () => {
  const lines = await captureLogLines(() =>
    runWithRequestContext({ requestId: 'req-shared-trace' }, async () => {
      const a = startSpan('a');
      a.end();
      const b = startSpan('b');
      b.end();
    }),
  );
  assert.equal(lines.length, 2);
  assert.equal(lines[0].traceId, 'req-shared-trace');
  assert.equal(lines[1].traceId, 'req-shared-trace');
});

test('a span started inside withSpan() is a child of the outer span', async () => {
  const lines = await captureLogLines(() =>
    runWithRequestContext({ requestId: 'req-nested' }, () =>
      withSpan('outer', {}, async (outer) => {
        const inner = startSpan('inner');
        inner.end();
        return outer.spanId;
      }),
    ),
  );
  const [innerLine, outerLine] = lines;
  assert.equal(innerLine.name, 'inner');
  assert.equal(outerLine.name, 'outer');
  assert.equal(innerLine.parentSpanId, outerLine.spanId, 'inner span must record outer span as its parent');
  assert.equal(innerLine.traceId, outerLine.traceId);
});

test('withSpan records status:error and still ends the span when the callback throws', async () => {
  const lines = await captureLogLines(async () => {
    await assert.rejects(
      () =>
        runWithRequestContext({ requestId: 'req-error' }, () =>
          withSpan('failing', {}, async () => {
            throw new Error('boom');
          }),
        ),
      /boom/,
    );
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].status, 'error');
  assert.equal(lines[0].error, 'boom');
});

test("two concurrent requests never mix up each other's traceId", async () => {
  const linesA = [];
  const linesB = [];
  const original = console.log;
  console.log = (text) => {
    const parsed = JSON.parse(text);
    (parsed.traceId === 'req-a' ? linesA : linesB).push(parsed);
  };
  try {
    await Promise.all([
      runWithRequestContext({ requestId: 'req-a' }, async () => {
        const s = startSpan('concurrent-a');
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
        s.end();
      }),
      runWithRequestContext({ requestId: 'req-b' }, async () => {
        const s = startSpan('concurrent-b');
        s.end();
      }),
    ]);
  } finally {
    console.log = original;
  }
  assert.equal(linesA.length, 1);
  assert.equal(linesA[0].name, 'concurrent-a');
});
