'use strict';

const { appPool } = require('./pool');
const { getRequestContext, AFTER_COMMIT_CALLBACKS } = require('../logging/context');
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

    // Only reached once COMMIT has actually succeeded (a throw above
    // exits before this line, same as rollbackAndRelease never running
    // this at all) — see registerAfterCommit's own comment for why
    // this exists. Each callback is isolated in its own try/catch: one
    // throwing must never turn an already-successful commit into a
    // failed response — by this point the transaction is durably
    // committed and the connection already released, so there is
    // nothing left for a callback's failure to roll back or corrupt,
    // only its own (logged, swallowed) side effect to lose.
    const callbacks = context ? context[AFTER_COMMIT_CALLBACKS] : null;
    if (callbacks && callbacks.length > 0) {
      context[AFTER_COMMIT_CALLBACKS] = [];
      for (const fn of callbacks) {
        try {
          fn();
        } catch (err) {
          logError('after_commit_callback_failed', {
            requestId: req.requestId,
            collegeId: req.collegeId,
            error: err.message,
          });
        }
      }
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

// Defers `fn` until the CURRENT request's transaction has actually
// committed — for work that must never start against data a concurrent
// reader could fail to see yet (backgroundJobService.enqueue's worker
// trigger is the one real caller today: it used to fire via
// setImmediate at enqueue-call-time, on a brand-new pool connection
// that could reach Postgres before the enqueuing transaction's own
// COMMIT — fired later, from res.end above — actually landed).
//
// Reads the SAME AsyncLocalStorage context openTenantTransaction
// itself populates (middleware/requestContext.js's initial store
// already carries an empty AFTER_COMMIT_CALLBACKS array) rather than
// needing `req` threaded through every service that wants this —
// callers here only ever have `client` in scope, same as every other
// repository/service call in this codebase (CLAUDE.md rule 1).
//
// Falls back to firing `fn` immediately when there's no request
// context at all (a direct call outside the normal HTTP request
// lifecycle, e.g. a test invoking a service function straight against
// a manually-opened transaction) — preserves today's behavior for
// exactly the callers that were never going through openTenantTransaction
// to begin with, rather than silently dropping the work.
function registerAfterCommit(fn) {
  const context = getRequestContext();
  if (!context) {
    fn();
    return;
  }
  if (!context[AFTER_COMMIT_CALLBACKS]) context[AFTER_COMMIT_CALLBACKS] = [];
  context[AFTER_COMMIT_CALLBACKS].push(fn);
}

module.exports = { openTenantTransaction, registerAfterCommit };
