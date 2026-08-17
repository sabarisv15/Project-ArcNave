'use strict';

// Request-scoped log enrichment via node:async_hooks's
// AsyncLocalStorage — the Node analogue of the deleted Python
// version's contextvars-based approach (app/core/request_context.py,
// git history).
//
// The Python bug that forced a workaround there was specific to
// Starlette's BaseHTTPMiddleware: it runs downstream handling inside
// a copied asyncio Task, so a contextvar mutation made *inside* that
// task (by an inner middleware/route) was not guaranteed to propagate
// back to the *outer* middleware's own task once `await call_next()`
// returned — a real, documented Starlette gotcha, not a contextvars
// limitation in general.
//
// Express's architecture doesn't have that shape: middleware calls
// next() synchronously in-chain (no task-copying wrapper), so there
// was reason to expect AsyncLocalStorage might just work cleanly here
// with no equivalent gotcha. That expectation is not taken on faith —
// see tests/request-logging.test.js's concurrent-requests test, the
// direct equivalent of the RLS pooled-connection leak test applied to
// log context instead of tenant context: two requests fired via
// Promise.all (not sequential — sequential requests could pass even
// under a broken shared-global implementation if Node happened to
// serialize them), each hitting a route with a deliberate delay before
// a deeply-nested log call, asserting each request's own requestId
// shows up on its own log line, never the other's. That test is what
// actually establishes this works, not this comment.

const { AsyncLocalStorage } = require('node:async_hooks');

const als = new AsyncLocalStorage();

function runWithRequestContext(initialStore, fn) {
  return als.run(initialStore, fn);
}

function getRequestContext() {
  // undefined outside a request (app startup, anything not run via
  // runWithRequestContext) — callers treat that the same as an empty
  // context, same as the Python version's contextvars defaulting to
  // None outside a request.
  return als.getStore();
}

module.exports = { runWithRequestContext, getRequestContext };
