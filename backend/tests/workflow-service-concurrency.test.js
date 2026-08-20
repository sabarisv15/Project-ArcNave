'use strict';

// Regression test for the P1 finding from the pre-launch audit:
// workflowService.approveRequest/rejectRequest/escalateRequest read
// status='Pending' in JS (loadPendingStepForActor) then wrote with no
// guard — two concurrent approvals of the same step could both pass
// the read before either wrote, double-inserting approval_history and
// firing every downstream caller's own side effect twice (every real
// caller across the codebase only proceeds after approveRequest
// resolves without throwing — see academicService.js/attendanceService.js/
// etc.'s own `const resolved = await workflowService.approveRequest(...)`
// call sites).
//
// Fixed by workflowRepository.updatePendingStatus (a conditional
// `UPDATE ... WHERE status = 'Pending'`, whose own row lock is what
// actually serializes two concurrent transactions — see its own
// comment) plus reordering workflowService.js so that guarded update
// runs BEFORE recordAction/the audit log, not just adding the guard.
//
// This test proves it with two REAL, separately-connected concurrent
// Postgres transactions — same rigor as rls-tenant-isolation.test.js,
// not a single-connection simulation, since a single connection cannot
// exhibit the race this bug actually had.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const workflowService = require('../src/services/workflowService');
const workflowRepository = require('../src/repositories/workflowRepository');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const DATABASE_URL = process.env.DATABASE_URL;

async function seedFixture(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeId = `wfrace${suffix}`;
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $1)',
    [collegeId],
  );
  const requester = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role)
     VALUES ($1, 'wfracerequester', 'wfracerequester@example.com', 'x', 'staff') RETURNING id`,
    [collegeId],
  );
  const approver = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role)
     VALUES ($1, 'wfraceapprover', 'wfraceapprover@example.com', 'x', 'hod') RETURNING id`,
    [collegeId],
  );
  return { collegeId, requesterId: requester.rows[0].id, approverId: approver.rows[0].id };
}

async function cleanupFixture(adminPool, collegeId) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM approval_history WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM workflow_requests WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [collegeId]);
}

async function withTransaction(pool, collegeId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

test('workflowService.approveRequest is race-safe under two genuinely concurrent transactions', async (t) => {
  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const appPool = new Pool({ connectionString: DATABASE_URL });
  const fixture = await seedFixture(adminPool);

  t.after(async () => {
    await cleanupFixture(adminPool, fixture.collegeId);
    await adminPool.end();
    await appPool.end();
  });

  const request = await withTransaction(appPool, fixture.collegeId, (client) => workflowService.submitRequest(client, {
    collegeId: fixture.collegeId,
    entityType: 'test_entity',
    entityId: crypto.randomUUID(),
    requestedByUserId: fixture.requesterId,
    origin: 'human',
    approverChain: [{ step: 1, role: 'hod', user_id: fixture.approverId }],
  }));

  // Deterministically forces the exact TOCTOU window the bug lived in,
  // instead of hoping two Promise.all'd requests happen to race on
  // real wall-clock I/O timing. Verified empirically that the naive
  // version doesn't work: a first draft of this test fired both
  // attempts via Promise.all against genuinely separate connections,
  // and it PASSED even against the unfixed code (confirmed by
  // temporarily reverting the fix) — on a fast local Postgres,
  // request A's whole transaction routinely finishes before request
  // B's own read even fires, so the two never actually overlap and
  // the bug never gets exercised. A flaky test that can pass against
  // known-broken code is worse than no test.
  //
  // Instead: intercept workflowRepository.findById — the exact read
  // loadPendingStepForActor uses — so request B's read returns the
  // SAME pre-resolution ('Pending', step 1) snapshot request A read,
  // no matter when B's own call actually fires. B's subsequent WRITE
  // still goes through the real guarded/unguarded repository call,
  // against the real, by-then-already-resolved row in real Postgres —
  // that write is what this test actually verifies, and it is not
  // mocked. This is the standard, deterministic way to reproduce a
  // check-then-act race: control the timing of the "check," let the
  // "act" hit the real system unmodified.
  let readCount = 0;
  const originalFindById = workflowRepository.findById.bind(workflowRepository);
  let staleSnapshot = null;
  t.mock.method(workflowRepository, 'findById', async (client, id) => {
    readCount += 1;
    if (readCount === 1) {
      const row = await originalFindById(client, id);
      staleSnapshot = { ...row };
      return row;
    }
    return { ...staleSnapshot };
  });

  // Two separate connections, two separate transactions — same as two
  // real HTTP requests each inside their own tenantTransaction.js-
  // managed transaction would be. A runs to full completion (read,
  // write, commit) first, which is what populates staleSnapshot above;
  // B then runs with its read forced stale, so its write is attempted
  // exactly as if it had read concurrently with A but only got around
  // to writing after A had already resolved the request.
  async function attemptApprove(label) {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [fixture.collegeId]);
      const result = await workflowService.approveRequest(client, request.id, { actorUserId: fixture.approverId });
      await client.query('COMMIT');
      return { label, outcome: 'resolved', result };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      return { label, outcome: 'rejected', err };
    } finally {
      client.release();
    }
  }

  const first = await attemptApprove('A');
  const second = await attemptApprove('B');
  const outcomes = [first, second];

  const resolved = outcomes.filter((o) => o.outcome === 'resolved');
  const rejected = outcomes.filter((o) => o.outcome === 'rejected');

  assert.equal(resolved.length, 1, 'expected exactly one of the two concurrent approvals to win');
  assert.equal(rejected.length, 1, 'expected exactly one of the two concurrent approvals to lose');
  assert.ok(
    rejected[0].err instanceof workflowService.WorkflowRequestAlreadyResolvedError,
    `expected the loser to fail with WorkflowRequestAlreadyResolvedError, got ${rejected[0].err}`,
  );
  assert.equal(resolved[0].result.status, 'Approved');

  // The real proof: exactly one approval_history row, not two — the
  // loser must never have written one at all (this is what the
  // approve-before-recordAction reordering, not just the guard,
  // buys — see workflowService.js's own comment).
  const historyRows = await adminPool.query(
    "SELECT action FROM approval_history WHERE workflow_request_id = $1",
    [request.id],
  );
  assert.equal(historyRows.rows.length, 1, `expected exactly 1 approval_history row, got ${historyRows.rows.length}`);
  assert.equal(historyRows.rows[0].action, 'Approved');

  // Same for the audit log — exactly one workflow_request_approved row.
  const auditRows = await adminPool.query(
    "SELECT action FROM audit_log WHERE entity = 'workflow_requests' AND entity_id = $1 AND action = 'workflow_request_approved'",
    [request.id],
  );
  assert.equal(auditRows.rows.length, 1, `expected exactly 1 audit_log row, got ${auditRows.rows.length}`);

  // And the request itself only ever advanced once — a single-step
  // chain, so 'Approved' is terminal; a double-apply bug would have
  // been invisible here (status can't go past 'Approved'), which is
  // exactly why the approval_history/audit_log row counts above are
  // the real assertions, not this one alone.
  const finalRequest = await adminPool.query('SELECT status FROM workflow_requests WHERE id = $1', [request.id]);
  assert.equal(finalRequest.rows[0].status, 'Approved');
});
