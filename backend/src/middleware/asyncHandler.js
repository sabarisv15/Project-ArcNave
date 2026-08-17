'use strict';

// Express 4 (the version this project uses) does not automatically
// forward a rejected promise from an async route/middleware handler
// to next(err) — unlike a synchronous throw, which Express's own
// dispatcher does catch. An unhandled rejection here would just hang
// the request (no response ever sent) rather than reaching the error-
// handling middleware. This wrapper is the whole fix: resolve the
// handler as a promise and forward any rejection to next() explicitly.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
