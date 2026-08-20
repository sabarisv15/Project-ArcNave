'use strict';

// Regression test for the P1 finding from the pre-launch audit: no
// statement_timeout/lock_timeout/idle_in_transaction_session_timeout
// existed anywhere. Migration 1762100000000_arcnave-app-role-timeouts
// sets all three at the arcnave_app ROLE level — this proves they are
// actually in effect for a real connection made as that role (not just
// that the migration ran without erroring), and that statement_timeout
// genuinely cancels a runaway query rather than just being a
// documented-but-inert setting.

const test = require('node:test');
const assert = require('node:assert/strict');
const { appPool } = require('../src/db/pool');

test('arcnave_app role timeouts', async (t) => {
  await t.test('the three timeout GUCs are set to the values the migration configured', async () => {
    const client = await appPool.connect();
    t.after(() => client.release());
    const result = await client.query(
      "SELECT current_setting('statement_timeout') AS statement_timeout, "
        + "current_setting('lock_timeout') AS lock_timeout, "
        + "current_setting('idle_in_transaction_session_timeout') AS idle_in_transaction_session_timeout",
    );
    const row = result.rows[0];
    assert.equal(row.statement_timeout, '20s');
    assert.equal(row.lock_timeout, '10s');
    assert.equal(row.idle_in_transaction_session_timeout, '90s');
  });

  await t.test('statement_timeout genuinely cancels a query that runs past it, not just a documented value', async () => {
    const client = await appPool.connect();
    // RESET before release, not just release alone — `pg.Pool` returns
    // physical connections to the pool for reuse, and a plain SET
    // (unlike SET LOCAL) persists for the rest of that connection's
    // session. Without this, a later test/request that happens to be
    // handed this same physical connection back would unexpectedly run
    // under a 200ms timeout instead of the role's real 20s default.
    t.after(async () => {
      await client.query('RESET statement_timeout').catch(() => {});
      client.release();
    });
    // A per-session override, well under the role default, so this
    // one assertion doesn't have to actually wait 20 real seconds —
    // proves the mechanism works at all, at any threshold.
    await client.query("SET statement_timeout = '200ms'");
    await assert.rejects(
      () => client.query('SELECT pg_sleep(2)'),
      (err) => {
        // 57014 = query_canceled, Postgres's own code for a
        // statement_timeout cancellation — not a generic error.
        assert.equal(err.code, '57014');
        return true;
      },
    );
  });
});
