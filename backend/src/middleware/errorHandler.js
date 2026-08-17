'use strict';

const { logError } = require('../logging/logger');

// Registered last, after every route — Express identifies error-
// handling middleware by its 4-parameter arity (err, req, res, next),
// not by name or position convention, and only reaches it when
// something calls next(err) (directly, or via asyncHandler forwarding
// a rejection).
//
// This is the rollback half of TenantMiddleware's commit/rollback
// pair (see middleware/tenant.js's module docstring for the full
// reasoning on why Express needs two separate hooks here, unlike
// Starlette's single `await call_next()` point). req.rollbackTransaction
// is set by TenantMiddleware for any request that got as far as
// opening a transaction; awaiting it here — before sending any
// response — guarantees the rollback has actually completed (and
// `settled` flipped true) before the response goes out, so
// TenantMiddleware's own res.end interception correctly no-ops
// instead of racing this handler.
// eslint-disable-next-line no-unused-vars
async function errorHandler(err, req, res, next) {
  if (req.rollbackTransaction) {
    try {
      await req.rollbackTransaction();
    } catch (rollbackErr) {
      logError('failed_to_rollback_tenant_scoped_transaction', {
        requestId: req.requestId,
        collegeId: req.collegeId,
        error: rollbackErr.message,
      });
    }
  }

  logError('unhandled_request_error', {
    requestId: req.requestId,
    collegeId: req.collegeId,
    error: err.message,
    stack: err.stack,
  });

  if (res.headersSent) {
    return;
  }
  res.status(500).json({ detail: 'Internal server error' });
}

module.exports = errorHandler;
