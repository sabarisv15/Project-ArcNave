'use strict';

// Live-Postgres integration test for Module 10's first Analytics
// slice — no route/HTTP layer exists yet (see .ai/TASK.md), so this
// calls analyticsService directly against a real, tenant-scoped
// transaction, same BEGIN + set_config('app.current_tenant', ...)
// pattern rls-tenant-isolation.test.js uses, rather than a mocked
// client: the entire point of this slice is a real SQL JOIN across
// two RLS-protected tables, which a mock would trivially hide a
// tenant-leak bug behind.
//
// Connects as arcnave_app (DATABASE_URL), the role RLS actually
// constrains — same reasoning rls-tenant-isolation.test.js gives for
// not using MIGRATION_DATABASE_URL (arcnave_admin, a superuser that
// bypasses RLS) for the assertions themselves. MIGRATION_DATABASE_URL
// is used only to seed/clean up fixtures, same split every other
// integration test in this suite already uses.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const analyticsService = require('../src/services/analyticsService');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const DATABASE_URL = process.env.DATABASE_URL;

async function seedTenant(adminPool, label) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeId = `analytics${label}${suffix}`;
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [collegeId, `analyticstenant${label}${suffix}`],
  );
  const user = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, 'x', 'staff', true) RETURNING id`,
    [collegeId, `marker${label}${suffix}`, `marker${label}${suffix}@example.com`],
  );
  const userId = user.rows[0].id;

  const classA = await adminPool.query(
    `INSERT INTO classes (college_id, class_name, timetable_status) VALUES ($1, $2, 'Approved') RETURNING id`,
    [collegeId, `Analytics Class A ${suffix}`],
  );
  const classB = await adminPool.query(
    `INSERT INTO classes (college_id, class_name, timetable_status) VALUES ($1, $2, 'Approved') RETURNING id`,
    [collegeId, `Analytics Class B ${suffix}`],
  );

  // Class A: two sessions, 40 students each, 2 then 1 absent -> 77/80 present = 96.25%.
  await adminPool.query(
    `INSERT INTO attendance_sessions (college_id, class_id, session_date, hour_index, marked_by_user_id, absent_student_ids, total_students)
     VALUES ($1, $2, '2026-07-01', 1, $3, '["s1","s2"]', 40)`,
    [collegeId, classA.rows[0].id, userId],
  );
  await adminPool.query(
    `INSERT INTO attendance_sessions (college_id, class_id, session_date, hour_index, marked_by_user_id, absent_student_ids, total_students)
     VALUES ($1, $2, '2026-07-02', 1, $3, '["s3"]', 40)`,
    [collegeId, classA.rows[0].id, userId],
  );
  // Class B: one session, 20 students, 0 absent -> 100%.
  await adminPool.query(
    `INSERT INTO attendance_sessions (college_id, class_id, session_date, hour_index, marked_by_user_id, absent_student_ids, total_students)
     VALUES ($1, $2, '2026-07-01', 1, $3, '[]', 20)`,
    [collegeId, classB.rows[0].id, userId],
  );
  // A soft-deleted session for class B — must be excluded from the aggregate.
  await adminPool.query(
    `INSERT INTO attendance_sessions (college_id, class_id, session_date, hour_index, marked_by_user_id, absent_student_ids, total_students, deleted_at)
     VALUES ($1, $2, '2026-07-03', 2, $3, '["s9","s8","s7","s6","s5"]', 5, now())`,
    [collegeId, classB.rows[0].id, userId],
  );

  return { collegeId, classIds: { a: classA.rows[0].id, b: classB.rows[0].id } };
}

async function cleanupTenant(adminPool, tenant) {
  // audit_log.user_id FKs users(id) — must go before the users delete
  // below (task #17's login audit logging).
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM attendance_sessions WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM classes WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [tenant.collegeId]);
}

async function withTenantClient(appPool, collegeId, fn) {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

test('AnalyticsService.getAttendanceRateByClass', async (t) => {
  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const appPool = new Pool({ connectionString: DATABASE_URL });

  const tenantA = await seedTenant(adminPool, 'a');
  const tenantB = await seedTenant(adminPool, 'b');

  t.after(async () => {
    await cleanupTenant(adminPool, tenantA);
    await cleanupTenant(adminPool, tenantB);
    await adminPool.end();
    await appPool.end();
  });

  await t.test('computes attendance rate per class, excluding soft-deleted sessions', async () => {
    const rows = await withTenantClient(appPool, tenantA.collegeId, (client) => (
      analyticsService.getAttendanceRateByClass(client)
    ));

    assert.equal(rows.length, 2);

    const classARow = rows.find((r) => r.classId === tenantA.classIds.a);
    assert.equal(classARow.sessionsCount, 2);
    assert.equal(classARow.totalMarked, 80);
    assert.equal(classARow.totalPresent, 77); // 80 - (2 + 1) absent
    assert.equal(classARow.attendanceRatePercent, 96.25);

    const classBRow = rows.find((r) => r.classId === tenantB.classIds.b);
    assert.equal(classBRow, undefined, 'class from a different tenant leaked into the aggregate');

    const ownClassBRow = rows.find((r) => r.classId === tenantA.classIds.b);
    assert.equal(ownClassBRow.sessionsCount, 1, 'soft-deleted session must not count');
    assert.equal(ownClassBRow.totalMarked, 20);
    assert.equal(ownClassBRow.totalPresent, 20);
    assert.equal(ownClassBRow.attendanceRatePercent, 100);
  });

  await t.test('filters by classId', async () => {
    const rows = await withTenantClient(appPool, tenantA.collegeId, (client) => (
      analyticsService.getAttendanceRateByClass(client, { classId: tenantA.classIds.a })
    ));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].classId, tenantA.classIds.a);
  });

  await t.test('cross-tenant isolation: tenant B never sees tenant A\'s classes', async () => {
    const rows = await withTenantClient(appPool, tenantB.collegeId, (client) => (
      analyticsService.getAttendanceRateByClass(client)
    ));
    assert.ok(rows.every((r) => r.classId === tenantB.classIds.a || r.classId === tenantB.classIds.b));
  });

  await t.test('a class with no attendance_sessions is simply absent from the result, not a null-filled row', async () => {
    const untouchedClass = await adminPool.query(
      `INSERT INTO classes (college_id, class_name, timetable_status) VALUES ($1, 'Untouched Class', 'Approved') RETURNING id`,
      [tenantA.collegeId],
    );
    try {
      const rows = await withTenantClient(appPool, tenantA.collegeId, (client) => (
        analyticsService.getAttendanceRateByClass(client, { classId: untouchedClass.rows[0].id })
      ));
      assert.equal(rows.length, 0);
    } finally {
      await adminPool.query('DELETE FROM classes WHERE id = $1', [untouchedClass.rows[0].id]);
    }
  });
});
