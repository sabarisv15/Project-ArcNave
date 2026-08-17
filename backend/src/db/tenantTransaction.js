'use strict';

const { appPool } = require('./pool');
const { getRequestContext } = require('../logging/context');
const { logError } = require('../logging/logger');

// The shared "open a transaction, set_config, wire up commit-on-
// res.end / rollback-on-error" machinery — extracted out of
// middleware/tenant.js specifically so it only has to be gotten right
// once. It has two callers: tenantMiddleware (the normal path, called
// with whatever collegeId resolveTenant resolved, including null) and
// routes/invitations.js's POST /invitations/accept (the one
// deliberate bypass of normal tenant resolution in this codebase —
// called with the invitation row's own collegeId, once the token's
// been looked up, since that route has no subdomain/JWT/explicit-code
// signal to resolve from at all). Duplicating this logic for that one
// route would risk reintroducing an equivalent version of the commit-
// timing bug tenant.js's own module docstring documents, independently,
// in a route with a much smaller test surface than tenantMiddleware's.
//
// Sets req.dbClient/req.collegeId/req.rollbackTransaction and mutates
// the current AsyncLocalStorage store's collegeId in place — every
// caller gets the exact same guarantees tenantMiddleware's requests
// always had, including a deeply-nested log call automatically
// picking up the right collegeId with no req in scope.
async function openTenantTransaction(req, res, collegeId) {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    if (collegeId !== null) {
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    }
  } catch (err) {
    client.release();
    throw err;
  }

  let settled = false;

  const commitAndRelease = async () => {
    if (settled) return;
    settled = true;
    try {
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  };

  const rollbackAndRelease = async () => {
    if (settled) return;
    settled = true;
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  };

  req.dbClient = client;
  req.collegeId = collegeId;
  req.rollbackTransaction = rollbackAndRelease;
  // Exposed for the rare route that must guarantee a tenant-side write
  // is durably committed BEFORE a separate, already-irreversible
  // side effect on a different connection/pool (e.g. marking a
  // structural authorization key redeemed on platformPool — RS-GOV-006
  // requires the key to survive only if the change it authorized
  // actually landed). Idempotent with the automatic res.end commit
  // above via the shared `settled` guard — calling this early makes
  // the later one a no-op, never a double commit.
  req.commitTransaction = commitAndRelease;

  const context = getRequestContext();
  if (context) context.collegeId = collegeId;

  // Every response path (res.json, res.send, an explicit res.end(),
  // and errorHandler.js's own res.status(500).json(...)) funnels
  // through res.end eventually — intercepting it here is the one
  // choke point that reliably runs before any byte reaches the
  // client, regardless of which helper the route handler used. See
  // middleware/tenant.js's module docstring for the real bug this
  // fixes (committing in a res.on('finish') listener, which fires
  // only *after* the response was already sent, let a fast client
  // race the COMMIT with an immediate follow-up request).
  const originalEnd = res.end.bind(res);
  res.end = (...args) => {
    res.end = originalEnd;
    commitAndRelease()
      .then(() => originalEnd(...args))
      .catch((err) => {
        logError('failed_to_commit_tenant_scoped_transaction', {
          requestId: req.requestId,
          collegeId: req.collegeId,
          error: err.message,
        });
        if (!res.headersSent) {
          res.status(500).json({ detail: 'Internal server error' });
        } else {
          originalEnd();
        }
      });
  };

  return client;
}

module.exports = { openTenantTransaction };
