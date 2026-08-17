'use strict';

const express = require('express');
const { requestContextMiddleware } = require('./middleware/requestContext');
const errorHandler = require('./middleware/errorHandler');
const createPlatformRouter = require('./routes/platform');

// The Platform (Super Admin Portal) API — a genuinely separate
// Express app, mounted at /api/v1/platform in app.js, as a *peer* of
// tenantApp.js under the thin outer app, not nested inside the tenant
// app and not sharing its middleware stack.
//
// This is what makes the isolation real rather than a shared-
// middleware special case (ADR-010, Architecture.md 2.1: "Never
// shares auth or database access with tenant requests"). The peer
// structure is load bearing: this is a genuine port of a real bug the
// Python version hit and fixed once, not a hypothetical — its first
// attempt mounted platform routes as a sub-app under a single
// top-level app carrying TenantMiddleware/AuthMiddleware directly,
// and an isolation test caught request.state.college_id/jwt_claims
// leaking onto platform-mounted requests, because Starlette's
// middleware wraps the entire ASGI callable before any Mount-routing
// decision happens. Express's app.use(prefix, subApp) does not carry
// that exact failure mode (each Express app instance owns its own
// middleware stack; mounting doesn't retroactively inherit an outer
// app's middleware unless the outer app has middleware of its own
// registered ahead of the mount) — but that was verified, not assumed
// from how the code reads, in tests/platform.test.js's isolation
// test, the direct Node equivalent of the Python isolation test that
// caught the original bug.
//
// authMiddleware/tenantMiddleware live only on tenantApp, never here
// and never on the thin outer app (app.js) — so req.jwtClaims/
// req.collegeId/req.dbClient are never set for any
// /api/v1/platform/* request. requestContextMiddleware is the one
// exception: it's harmless (just requestId + one access-log line) and
// there's no reason platform requests shouldn't get the same
// observability as tenant ones.
function createPlatformApp({ registerExtraRoutes } = {}) {
  const app = express();

  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use(createPlatformRouter());

  if (typeof registerExtraRoutes === 'function') {
    registerExtraRoutes(app);
  }

  app.use(errorHandler);

  return app;
}

module.exports = createPlatformApp;
