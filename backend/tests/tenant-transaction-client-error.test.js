'use strict';

// Regression test for the P0 finding from the AI red-team evaluation
// session (2026-08-21): the client checked out via appPool.connect()
// and held open for a request's whole transaction (tenantTransaction.js's
// openTenantTransaction) had no local `error` listener of its own — only
// db/pool.js's pool-level listener existed, which only ever fires for a
// client sitting IDLE in the pool, never one currently checked out.
//
// Live-reproduced trigger: Postgres's own idle_in_transaction_session_timeout
// (db-role-timeouts.test.js) killed a checked-out connection that had been
// held open (no DB activity) while its request awaited a slow, DB-unrelated
// external LLM call inside askAgent. The resulting unhandled EventEmitter
// `error` crashed the entire Node process — taking every other tenant's
// in-flight request down with it, not just the one that hit the bad
// connection.
//
// Proven here with a REAL Postgres-initiated disconnect (pg_terminate_backend
// from a second, separately-connected superuser session), not a mocked/
// simulated error — same rigor as workflow-service-concurrency.test.js's
// two-connection race test. Without the fix in openTenantTransaction, this
// test crashes the entire `node --test` process rather than failing one
// assertion cleanly (an unhandled EventEmitter `error` has no per-test
// boundary to catch it) — so a regression here is loud, not silent.

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { openTenantTransaction } = require('../src/db/tenantTransaction');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;

function fakeReqRes() {
  const req = { requestId: 'tenant-transaction-client-error-test' };
  const res = { headersSent: false, end: () => {} };
  return { req, res };
}

test('a server-initiated disconnect on the checked-out transaction client never crashes the process', async (t) => {
  // arcnave_admin is a real superuser (verified: rolsuper = true) — the
  // only role in this schema actually permitted to pg_terminate_backend
  // a session it doesn't own (arcnave_app, the runtime role every real
  // request's transaction client connects as).
  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  t.after(() => adminPool.end());

  const { req, res } = fakeReqRes();
  const client = await openTenantTransaction(req, res, null);
  t.after(async () => {
    // Expected to reject — the connection is already dead by this point.
    // What matters is that rejecting is all it does (no hang, no crash),
    // and that client.release() (inside rollbackAndRelease's own
    // finally) still runs so the pool's bookkeeping isn't left stuck
    // thinking this client is still checked out.
    await req.rollbackTransaction().catch(() => {});
  });

  const pid = client.processID;
  assert.ok(pid, 'the checked-out client must have a real backend PID to target');
  await adminPool.query('SELECT pg_terminate_backend($1)', [pid]);

  // Let the terminated connection's error actually arrive and be emitted
  // on the client. If openTenantTransaction's fix were missing, the
  // process would already have crashed by the time this line is reached
  // — there would be no test failure to report, just a dead test run.
  await new Promise((resolve) => {
    setTimeout(resolve, 500);
  });

  // The client is provably dead now — any later query on it must reject
  // cleanly, exactly like a normal failed query, never hang and never
  // take the process down with it.
  await assert.rejects(() => client.query('SELECT 1'));
});
