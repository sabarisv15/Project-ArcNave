'use strict';

// Originally written for Express 4, which does not automatically
// forward a rejected promise from an async route/middleware handler
// to next(err) — unlike a synchronous throw, which Express's own
// dispatcher does catch. An unhandled rejection there would just hang
// the request (no response ever sent) rather than reaching the error-
// handling middleware.
//
// ARCNAVE modernization P1 (PDF 4.2, framework upgrade): this project
// is now on Express 5, which handles that case natively — every
// existing call site below is now technically redundant, not
// incorrect. Left in place rather than stripped from ~336 route
// registrations: it's harmless (Promise.resolve().catch(next) is a
// no-op wrapper around Express 5's own equivalent behavior) and
// removing it project-wide is its own separate, mechanical cleanup
// pass, not bundled into the version bump itself.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
