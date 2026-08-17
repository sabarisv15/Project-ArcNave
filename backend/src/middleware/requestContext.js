'use strict';

const crypto = require('node:crypto');
const { runWithRequestContext } = require('../logging/context');
const { logInfo } = require('../logging/logger');

// Outermost middleware — registered first in app.js, before
// authMiddleware, so everything downstream (including
// authMiddleware/tenantMiddleware's own mutations to req and to the
// AsyncLocalStorage store — see tenant.js, which mutates
// getRequestContext().collegeId in place rather than starting a
// second context) happens inside the context this middleware
// establishes.
//
// One res.on('finish', ...) hook logs exactly once per request,
// success or error alike — unlike tenant.js's commit/rollback pair
// (which needs exactly one of two DIFFERENT DB operations to run,
// hence its `settled` guard), the access log is the SAME operation
// regardless of outcome, and 'finish' fires unconditionally once a
// response has actually been sent, whether that response came from a
// route handler completing normally or from errorHandler.js
// eventually calling res.status(500).json(...). No separate
// error-path hook needed — this is the answer to "both the
// res.on('finish') success path and the error path" the build brief
// asked about: they're the same hook, not two.
//
// This callback reads req.requestId/req.collegeId directly, NOT
// getRequestContext() — stated plainly, as asked, rather than
// silently picking one: `req` is already a reliable plain-object
// closure reference (mutated in place by tenantMiddleware before
// 'finish' ever fires), so there's no reason to route through
// AsyncLocalStorage for data already sitting on a variable this
// function already closes over. This is NOT a workaround for a known
// propagation gap the way the Python version's equivalent read
// (request.state instead of the contextvar) was forced to be — it's
// simply the more direct option that happens to exist here. The
// AsyncLocalStorage path itself (getRequestContext(), used by
// logger.js everywhere code doesn't have `req` in scope — e.g.
// authService.refresh) is proven separately, empirically, by
// tests/request-logging.test.js's concurrent-requests test.
function requestContextMiddleware(req, res, next) {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  // req.originalUrl, not req.path: this middleware is registered on
  // both tenantApp and platformApp, each of which is mounted at a
  // path prefix (/api/v1, /api/v1/platform) by the thin outer app
  // (app.js) — Express strips that prefix from req.path/req.url
  // inside a mounted sub-app (same as Starlette's Mount did), so
  // req.path here would only ever show the internal, mount-relative
  // path (e.g. '/health', not '/api/v1/health'). req.originalUrl is
  // unaffected by mounting and always reflects what the client
  // actually requested — caught by this file's own test suite, not
  // assumed: the Super Admin Portal API slice's two-app split changed
  // req.path's meaning, and the access log needed to account for it.
  const path = req.originalUrl.split('?')[0];

  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logInfo('request_completed', {
      requestId: req.requestId,
      collegeId: req.collegeId,
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    });
  });

  runWithRequestContext({ requestId, collegeId: null }, () => next());
}

module.exports = { requestContextMiddleware };
