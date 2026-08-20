'use strict';

// Direct proof of db/tenantTransaction.js's registerAfterCommit/
// commitAndRelease mechanism, added for Fix 3 (the background-job
// enqueue race — see backgroundJobService.js). background-jobs.test.js
// already proves the end-to-end HTTP behavior still works; this file
// proves the two specific properties the mechanism itself must have,
// isolated from any particular caller:
//
//   1. A registered callback runs only after COMMIT has actually
//      succeeded — never before, and never on rollback.
//   2. A callback throwing can never turn an already-successful commit
//      into a failed response.

const test = require('node:test');
const assert = require('node:assert/strict');
const { openTenantTransaction, registerAfterCommit } = require('../src/db/tenantTransaction');
const { runWithRequestContext, AFTER_COMMIT_CALLBACKS } = require('../src/logging/context');

// A minimal fake req/res — openTenantTransaction only needs
// res.end to exist (it wraps it) and req to be a plain object it can
// stamp fields onto. No real HTTP server needed to exercise the
// mechanism itself.
function fakeReqRes() {
  let endResolve;
  const endPromise = new Promise((resolve) => { endResolve = resolve; });
  const req = { requestId: 'test-request' };
  const res = {
    headersSent: false,
    status() { return this; },
    json() {},
    end: (...args) => endResolve(args),
  };
  return { req, res, endPromise };
}

async function withRequestContext(fn) {
  return runWithRequestContext({ requestId: 'test-request', collegeId: null, [AFTER_COMMIT_CALLBACKS]: [] }, fn);
}

test('registerAfterCommit: callback does not run before commit, runs after', async () => {
  await withRequestContext(async () => {
    const { req, res, endPromise } = fakeReqRes();
    const client = await openTenantTransaction(req, res, null);
    try {
      let fired = false;
      registerAfterCommit(() => { fired = true; });

      assert.equal(fired, false, 'callback must not fire at registration time');

      res.end();
      await endPromise;

      assert.equal(fired, true, 'callback must have fired by the time the real res.end runs, since commitAndRelease drains callbacks before resolving');
    } finally {
      await client.query('SELECT 1').catch(() => {});
    }
  });
});

test('registerAfterCommit: callback does NOT run on rollback', async () => {
  await withRequestContext(async () => {
    const { req, res } = fakeReqRes();
    await openTenantTransaction(req, res, null);

    let fired = false;
    registerAfterCommit(() => { fired = true; });

    await req.rollbackTransaction();

    assert.equal(fired, false, 'callback must never fire when the transaction rolled back instead of committing');
  });
});

test('registerAfterCommit: a throwing callback cannot break the response', async () => {
  await withRequestContext(async () => {
    const { req, res, endPromise } = fakeReqRes();
    await openTenantTransaction(req, res, null);

    let secondFired = false;
    registerAfterCommit(() => { throw new Error('a background callback failing on purpose'); });
    registerAfterCommit(() => { secondFired = true; });

    // Must not throw/reject — a callback failing is swallowed and
    // logged, never allowed to turn a successful commit into a 500 or
    // an unhandled rejection.
    res.end('ok');
    const endArgs = await endPromise;

    assert.deepEqual(endArgs, ['ok'], 'the real response body must still reach res.end unmodified');
    assert.equal(secondFired, true, 'a callback after a throwing one must still run — one failure does not skip the rest');
  });
});

test('registerAfterCommit: with no request context, fires immediately (fallback for non-request callers)', () => {
  let fired = false;
  registerAfterCommit(() => { fired = true; });
  assert.equal(fired, true);
});
