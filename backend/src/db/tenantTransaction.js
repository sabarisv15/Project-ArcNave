'use strict';

const { getRequestContext, AFTER_COMMIT_CALLBACKS, AFTER_ROLLBACK_CALLBACKS } = require('../logging/context');
const { logError } = require('../logging/logger');
const { TenantConnection } = require('./tenantConnection');

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
  // ARCNAVE modernization P0 (PDF 4.1 / clash C5) — see
  // db/tenantConnection.js's own module comment for the full rationale.
  // `client` below is now a TenantConnection wrapper, not a raw pg
  // client: every `.query()` call site is unaffected (same interface),
  // and aiService.js's completeMaybeStreaming is the only caller that
  // ever pauses/resumes the underlying connection mid-request.
  const client = new TenantConnection(collegeId);

  // A client checked out for this request/transaction's whole lifetime —
  // unlike an idle pool client (db/pool.js's own pool-level `error`
  // listener, which only ever fires for a client sitting unused in the
  // pool), a server-initiated disconnect on THIS client (e.g. Postgres's
  // own idle_in_transaction_session_timeout killing the connection while
  // this request awaits something slow and DB-unrelated, like an LLM
  // call inside askAgent) emits its `error` event directly here, which
  // pool.js's listener never sees. Node's default behavior for an
  // EventEmitter `error` with no listener is to throw, unhandled —
  // crashing the entire process and every other tenant's in-flight
  // request with it (live-reproduced: a single slow /ai/ask/stream call
  // took the whole backend down). A listener here is all that's needed
  // to fix that: once one exists, every later operation this now-dead
  // client attempts (COMMIT, ROLLBACK, or a handler's own next query)
  // already rejects its promise normally instead of hanging or crashing
  // — the existing try/finally release() paths below (commitAndRelease/
  // rollbackAndRelease) and res.end's own commitAndRelease().catch(...)
  // already handle that rejection correctly with no further change.
  // TenantConnection re-attaches this same listener to every connection
  // it acquires across a pause/resume cycle, not just the first one.
  client.onClientError((err) => {
    logError('db_client_error_mid_transaction', {
      requestId: req.requestId,
      collegeId,
      error: err.message,
    });
  });

  await client.open();

  let settled = false;

  const commitAndRelease = async () => {
    if (settled) return;
    settled = true;
    await client.commit();

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

    // A successful commit means nothing this request queued for
    // registerAfterRollback should ever fire — discarded here rather
    // than left to rollbackAndRelease's own `settled` guard, since that
    // guard exists to stop a double COMMIT/ROLLBACK, not to express
    // "this queue is now moot."
    if (context && context[AFTER_ROLLBACK_CALLBACKS]) {
      context[AFTER_ROLLBACK_CALLBACKS] = [];
    }
  };

  const rollbackAndRelease = async () => {
    if (settled) return;
    settled = true;
    await client.rollback();

    // Mirrors commitAndRelease's own callback draining, only reached
    // once ROLLBACK has actually completed — see registerAfterRollback's
    // own comment for the real bug this exists to fix (documentService.
    // uploadDocument writing to disk before its row's transaction
    // commits, with no cleanup if that transaction later rolls back).
    // Same `context` closure commitAndRelease uses (defined below, once
    // per request) — not re-fetched, so both settle against the
    // identical AsyncLocalStorage store.
    const callbacks = context ? context[AFTER_ROLLBACK_CALLBACKS] : null;
    if (callbacks && callbacks.length > 0) {
      context[AFTER_ROLLBACK_CALLBACKS] = [];
      for (const fn of callbacks) {
        try {
          fn();
        } catch (err) {
          logError('after_rollback_callback_failed', {
            requestId: req.requestId,
            collegeId: req.collegeId,
            error: err.message,
          });
        }
      }
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

// Round 10 P2/P3 finding: documentService.uploadDocument (and any
// future caller with the same "write to disk, then write the DB row
// that references it" shape) had no way to undo the disk write if the
// SAME request's transaction later rolled back — an orphaned file,
// invisible to quota accounting, on any later statement's failure. The
// mirror image of registerAfterCommit above: `fn` fires only if THIS
// request's transaction actually rolls back, never if it commits
// (commitAndRelease discards the queue instead of running it).
//
// Deliberately does NOT fall back to firing `fn` immediately when
// there's no request context (registerAfterCommit's own fallback is
// safe because "no context" there means "nothing to defer against, run
// now"; here it would mean the opposite — unconditionally deleting a
// file this function has no way to know will actually need deleting).
// A caller outside the normal HTTP/transaction lifecycle (e.g. a test
// driving documentService directly against its own manually-managed
// transaction) is expected to manage its own file cleanup instead.
function registerAfterRollback(fn) {
  const context = getRequestContext();
  if (!context) {
    return;
  }
  if (!context[AFTER_ROLLBACK_CALLBACKS]) context[AFTER_ROLLBACK_CALLBACKS] = [];
  context[AFTER_ROLLBACK_CALLBACKS].push(fn);
}

module.exports = { openTenantTransaction, registerAfterCommit, registerAfterRollback };
