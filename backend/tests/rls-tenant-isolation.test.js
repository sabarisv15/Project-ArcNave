'use strict';

// ADR-002's release gate, ported from the deleted Python test
// (test_rls_tenant_isolation.py, recoverable via git history) — the
// SQL/RLS policy is unchanged (ADR-016), but nothing about a
// different client library's connection pooling is assumed to behave
// the same. Re-proven here from scratch, same rigor: connect as
// arcnave_app (the role RLS is actually meant to constrain) on a
// pool constrained to exactly one physical connection, and prove —
// via pg_backend_pid(), a Postgres builtin, not a driver-specific
// trick — that a second logical checkout really does reuse the same
// physical connection before trusting what it does or doesn't see.
//
// Two connections matter for different reasons, same as before:
// - MIGRATION_DATABASE_URL (arcnave_admin): owns the tables and is a
//   Postgres superuser, so it bypasses RLS unconditionally (ADR-015).
//   Used only to seed/clean up fixture data, and as the negative
//   control proving this suite isn't vacuous.
// - DATABASE_URL (arcnave_app): the runtime role RLS is actually
//   meant to constrain. This is what the isolation assertions use.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const DATABASE_URL = process.env.DATABASE_URL;

async function seedTwoTenants(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const tenantA = `test_a_${suffix}`;
  const tenantB = `test_b_${suffix}`;

  for (const collegeId of [tenantA, tenantB]) {
    await adminPool.query(
      'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $1)',
      [collegeId],
    );
    await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role)
       VALUES ($1, $2, $3, 'x', 'staff')`,
      [collegeId, `user_${collegeId}`, `${collegeId}@example.com`],
    );
  }

  return { tenantA, tenantB };
}

async function cleanupTenants(adminPool, tenantA, tenantB) {
  for (const collegeId of [tenantA, tenantB]) {
    await adminPool.query('DELETE FROM users WHERE college_id = $1', [collegeId]);
    await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [collegeId]);
  }
}

async function runIsolationTest(endMode) {
  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const { tenantA, tenantB } = await seedTwoTenants(adminPool);

  // max: 1 forces exactly one physical connection, so a "new" logical
  // checkout for the second transaction is guaranteed to hand back
  // the same physical one — verified explicitly via pg_backend_pid()
  // below, not just assumed from the pool config.
  const appPool = new Pool({ connectionString: DATABASE_URL, max: 1 });

  try {
    const client1 = await appPool.connect();
    let pidBefore;
    try {
      await client1.query('BEGIN');
      pidBefore = (await client1.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;

      await client1.query("SELECT set_config('app.current_tenant', $1, true)", [tenantA]);
      const rowsA = await client1.query('SELECT college_id FROM users');
      assert.deepEqual(rowsA.rows.map((r) => r.college_id), [tenantA]);

      if (endMode === 'commit') {
        await client1.query('COMMIT');
      } else {
        await client1.query('ROLLBACK');
      }
    } finally {
      client1.release();
    }

    // New logical client, same pooled connection (max: 1). No tenant
    // context has been set on it yet — fail-closed must hold: zero
    // rows, not tenant A's row leaking across the transaction
    // boundary.
    const client2 = await appPool.connect();
    try {
      await client2.query('BEGIN');
      const pidAfter = (await client2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      assert.equal(
        pidAfter,
        pidBefore,
        'test setup bug: pool did not reuse the same physical connection — this test would prove nothing',
      );

      const leaked = await client2.query('SELECT college_id FROM users');
      assert.deepEqual(
        leaked.rows,
        [],
        `tenant context leaked across a transaction boundary (previous transaction ended via ${endMode})`,
      );

      await client2.query("SELECT set_config('app.current_tenant', $1, true)", [tenantB]);
      const rowsB = await client2.query('SELECT college_id FROM users');
      assert.deepEqual(rowsB.rows.map((r) => r.college_id), [tenantB]);
      await client2.query('COMMIT');
    } finally {
      client2.release();
    }
  } finally {
    await appPool.end();
    await cleanupTenants(adminPool, tenantA, tenantB);
    await adminPool.end();
  }
}

test('tenant isolation on a pooled connection — end via commit', async () => {
  await runIsolationTest('commit');
});

test('tenant isolation on a pooled connection — end via rollback', async () => {
  await runIsolationTest('rollback');
});

test('arcnave_admin bypasses RLS (negative control)', async () => {
  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const { tenantA, tenantB } = await seedTwoTenants(adminPool);
  try {
    // No tenant context set at all — arcnave_admin isn't subject to
    // the policy regardless (ADR-015). This is what proves the two
    // tests above would actually catch a regression (e.g.
    // DATABASE_URL accidentally pointed at the admin role) rather
    // than passing vacuously — if RLS were silently not filtering at
    // all, this test would look identical to the isolation tests.
    const result = await adminPool.query(
      'SELECT college_id FROM users WHERE college_id IN ($1, $2)',
      [tenantA, tenantB],
    );
    const seen = new Set(result.rows.map((r) => r.college_id));
    assert.deepEqual(seen, new Set([tenantA, tenantB]));
  } finally {
    await cleanupTenants(adminPool, tenantA, tenantB);
    await adminPool.end();
  }
});
