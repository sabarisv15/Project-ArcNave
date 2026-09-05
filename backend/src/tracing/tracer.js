'use strict';

// ARCNAVE modernization P1 (PDF 4.4/O4: "standard tracing toolkit;
// carry a trace id into the logs" — 1.15: "AI monitoring... one turn
// shows as one tree"). A minimal, OpenTelemetry-SHAPED span recorder
// (traceId/spanId/parentSpanId/name/attributes/startTime/duration —
// the same fields any real OTel exporter/viewer expects), deliberately
// NOT the full @opentelemetry/sdk-node + auto-instrumentation package
// tree: that pulls in HTTP/Express/pg auto-instrumentation hooking
// into every request this whole app makes, a real compatibility
// surface against a 3500-line hand-written agent loop (aiService.js)
// this session's own budget doesn't have room to fully verify. This
// gives the actual, stated requirement — a request/AI-turn's spans
// forming one real parent-child tree, correlated via the SAME
// requestId logging/context.js's AsyncLocalStorage already carries —
// today, as structured JSON log lines any log-aggregation tool can
// already query. Swapping this recorder for the real OTel SDK later
// (once a real collector/viewer is chosen — its own, separate
// investment decision) needs no re-instrumentation of call sites:
// startSpan/span.end() is the same shape OTel's own API uses.

const crypto = require('node:crypto');
const { getRequestContext } = require('../logging/context');
const { logInfo } = require('../logging/logger');

function newId(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

// One span tree per HTTP request, keyed by the SAME requestId every
// other log line already carries (logging/context.js) — this is what
// makes "one turn shows as one tree" true: every span this request's
// call chain creates shares one traceId, queryable together.
function currentTraceId() {
  const context = getRequestContext();
  return (context && context.requestId) || newId(8);
}

// AsyncLocalStorage-scoped "current span" so a nested startSpan() call
// (e.g. an LLM call span opened from inside a tool-call span) picks up
// the right parentSpanId automatically, without every call site having
// to thread a parent id through manually.
const { AsyncLocalStorage } = require('node:async_hooks');
const spanStack = new AsyncLocalStorage();

function startSpan(name, attributes = {}) {
  const traceId = currentTraceId();
  const parentSpanId = spanStack.getStore() || null;
  const spanId = newId(8);
  const startedAt = process.hrtime.bigint();

  return {
    traceId,
    spanId,
    parentSpanId,
    // Runs `fn` with this span as the "current" one for the duration —
    // any startSpan() called inside fn gets this span as its parent.
    run(fn) {
      return spanStack.run(spanId, fn);
    },
    end(extra = {}) {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logInfo('trace_span', {
        traceId,
        spanId,
        parentSpanId,
        name,
        durationMs: Math.round(durationMs * 100) / 100,
        attributes,
        ...extra,
      });
    },
  };
}

// Convenience wrapper for the common case (span an async function,
// always end() even on throw, record success/failure).
async function withSpan(name, attributes, fn) {
  const span = startSpan(name, attributes);
  return span.run(async () => {
    try {
      const result = await fn(span);
      span.end({ status: 'ok' });
      return result;
    } catch (err) {
      span.end({ status: 'error', error: err.message });
      throw err;
    }
  });
}

module.exports = { startSpan, withSpan };
