'use strict';

const express = require('express');
const createTenantApp = require('./tenantApp');
const createPlatformApp = require('./platformApp');

// Top-level Express application. Deliberately thin: no business
// middleware lives directly on this app — that is not a style
// preference, it's the fix for a real bug the deleted Python version
// hit once already (recoverable via git history).
//
// The Python version's first attempt added TenantMiddleware/
// AuthMiddleware/RequestContextMiddleware straight to its single
// top-level app, with the platform routes mounted alongside as a
// second sub-app. That looked like isolation but wasn't: Starlette's
// middleware wraps the *entire* ASGI callable before any
// routing/mounting decision ever happens, so middleware on an outer
// app ran for every request regardless of which mount ultimately
// served it. An isolation test caught request.state.college_id/
// jwt_claims existing on platform-routed requests before the fix —
// tenant_app/platform_app were split into two genuinely independent
// sub-apps, each owning its own middleware stack, with nothing of
// substance on the app mounting them.
//
// Express's app.use(prefix, subApp) is not assumed to be automatically
// as isolated as Starlette's Mount was assumed to be — that exact
// assumption is what failed last time, just in a different framework.
// The structural fix is the same shape here for a documented reason:
// each Express app instance owns its own middleware stack, and
// mounting a sub-app via app.use(prefix, subApp) does not retroactively
// make that sub-app inherit an ancestor's middleware UNLESS the
// ancestor has middleware of its own registered ahead of the mount —
// which is exactly why this file has none. That reasoning was verified
// empirically, not taken on faith: tests/platform.test.js's isolation
// test is the direct Node equivalent of the Python test that caught
// the original bug, run against this real mounted structure.
//
// Chose path-prefix mounting on this middleware-free outer app over
// two separate listen() calls (the other option that would achieve
// equivalent isolation): it keeps the same single-port, single-process
// external API surface the Python version had (and docker-compose.yml
// / the frontend already assume), rather than introducing a second
// port and reverse-proxy concern that nothing about this slice
// actually requires.
//
// Mount order matters and is easy to get backwards: /api/v1/platform
// must be registered before /api/v1, since Express's path-prefix
// matching (like Starlette's Mount) stops at the first matching
// prefix in registration order. If /api/v1 were registered first,
// every /api/v1/platform/* request would match it (a prefix match)
// before ever reaching the more specific /api/v1/platform entry.
function createApp({ registerTenantExtraRoutes, registerPlatformExtraRoutes } = {}) {
  const app = express();

  app.use('/api/v1/platform', createPlatformApp({ registerExtraRoutes: registerPlatformExtraRoutes }));
  app.use('/api/v1', createTenantApp({ registerExtraRoutes: registerTenantExtraRoutes }));

  return app;
}

module.exports = createApp;
