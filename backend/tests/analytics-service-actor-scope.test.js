'use strict';

// Regression coverage for AnalyticsService.getAttendanceRateForActor's
// per-role scoping — added after a live UAT pass reported the tutor
// (staff, SELF_ASSIGNED scope) seeing an empty attendance rate for a
// class the HOD (DEPARTMENT scope) correctly saw data for. Root-cause
// investigation (re-run against a clean seed, and again after
// reapplying the exact department/class fixture the original report
// was taken under) could not reproduce the discrepancy — every
// component in the chain (classRepository.findByTutorUserId,
// facultyAllocationRepository.findByStaffUserId,
// visibilityService.getVisibleClassIds's SELF_ASSIGNED branch,
// analyticsRepository.attendanceRateByClass) returned correct,
// consistent data for the tutor's own class both directly and through
// the full HTTP -> askAgent -> tool pipeline. This test exists to make
// that parity a checked invariant going forward, not to fix a defect
// that was never actually reproduced in analyticsService itself.
//
// Same live-Postgres integration style analytics-service.test.js
// already uses (a real RLS-scoped transaction, not a mock), since the
// whole point is a real cross-table scope resolution a mock would
// hide a regression behind.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const analyticsService = require('../src/services/analyticsService');
const { seedHodPosition, seedClassTutorPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const DATABASE_URL = process.env.DATABASE_URL;

async function seedTenant(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeId = `attscope${suffix}`;
  await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)', [
    collegeId,
    `attscopetenant${suffix}`,
  ]);

  const dept = await adminPool.query('INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id', [
    collegeId,
    `Dept ${suffix}`,
  ]);
  const departmentId = dept.rows[0].id;

  const otherDept = await adminPool.query('INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id', [
    collegeId,
    `Other Dept ${suffix}`,
  ]);
  const otherDepartmentId = otherDept.rows[0].id;

  const tutorUser = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, 'x', 'staff', true) RETURNING id`,
    [collegeId, `tutor${suffix}`, `tutor${suffix}@example.com`],
  );
  const tutorUserId = tutorUser.rows[0].id;

  const hodUser = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, 'x', 'hod', true) RETURNING id`,
    [collegeId, `hod${suffix}`, `hod${suffix}@example.com`],
  );
  const hodUserId = hodUser.rows[0].id;

  await seedHodPosition(adminPool, { collegeId, userId: hodUserId, departmentId });

  await adminPool.query(
    `INSERT INTO staff (college_id, user_id, staff_code, full_name, department_id)
     VALUES ($1, $2, $3, 'Test Tutor', $4)`,
    [collegeId, tutorUserId, `TUT-${suffix}`, departmentId],
  );
  await adminPool.query(
    `INSERT INTO staff (college_id, user_id, staff_code, full_name, department_id)
     VALUES ($1, $2, $3, 'Test HOD', $4)`,
    [collegeId, hodUserId, `HOD-${suffix}`, departmentId],
  );

  const ownClass = await adminPool.query(
    `INSERT INTO classes (college_id, class_name, timetable_status, department_id)
     VALUES ($1, $2, 'Approved', $3) RETURNING id`,
    [collegeId, `Own Class ${suffix}`, departmentId],
  );
  const ownClassId = ownClass.rows[0].id;
  // Phase 2 step 19: tutorUser's tutor-of-record status moved off
  // classes.tutor_user_id onto the real Position/Account/Occupant
  // fixture — the SELF_ASSIGNED scope this test exists to prove now
  // resolves through identityService.resolveActiveClassTutorPosition,
  // not this column.
  await seedClassTutorPosition(adminPool, {
    collegeId,
    userId: tutorUserId,
    classId: ownClassId,
  });

  // A second class in the SAME department the tutor does not tutor —
  // proves the HOD's department scope is broader than the tutor's own
  // SELF_ASSIGNED scope, not just a coincidental match.
  const deptOnlyClass = await adminPool.query(
    `INSERT INTO classes (college_id, class_name, timetable_status, department_id)
     VALUES ($1, $2, 'Approved', $3) RETURNING id`,
    [collegeId, `Dept-only Class ${suffix}`, departmentId],
  );
  const deptOnlyClassId = deptOnlyClass.rows[0].id;

  // A class in a different department entirely — must never appear
  // for either the tutor or this HOD.
  const otherDeptClass = await adminPool.query(
    `INSERT INTO classes (college_id, class_name, timetable_status, department_id)
     VALUES ($1, $2, 'Approved', $3) RETURNING id`,
    [collegeId, `Other Dept Class ${suffix}`, otherDepartmentId],
  );
  const otherDeptClassId = otherDeptClass.rows[0].id;

  await adminPool.query(
    `INSERT INTO attendance_sessions (college_id, class_id, session_date, hour_index, marked_by_user_id, absent_student_ids, total_students)
     VALUES ($1, $2, '2026-07-01', 1, $3, '[]', 10)`,
    [collegeId, ownClassId, tutorUserId],
  );
  await adminPool.query(
    `INSERT INTO attendance_sessions (college_id, class_id, session_date, hour_index, marked_by_user_id, absent_student_ids, total_students)
     VALUES ($1, $2, '2026-07-01', 1, $3, '["s1"]', 10)`,
    [collegeId, deptOnlyClassId, hodUserId],
  );
  await adminPool.query(
    `INSERT INTO attendance_sessions (college_id, class_id, session_date, hour_index, marked_by_user_id, absent_student_ids, total_students)
     VALUES ($1, $2, '2026-07-01', 1, $3, '[]', 5)`,
    [collegeId, otherDeptClassId, hodUserId],
  );

  return {
    collegeId,
    tutorUserId,
    hodUserId,
    ownClassId,
    deptOnlyClassId,
    otherDeptClassId,
  };
}

async function cleanupTenant(adminPool, tenant) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [tenant.collegeId]);
  await cleanupPositionRows(adminPool, tenant.collegeId);
  await adminPool.query('DELETE FROM attendance_sessions WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM classes WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [tenant.collegeId]);
  await adminPool.query('DELETE FROM departments WHERE college_id = $1', [tenant.collegeId]);
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

test('AnalyticsService.getAttendanceRateForActor', async (t) => {
  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const appPool = new Pool({ connectionString: DATABASE_URL });

  const tenant = await seedTenant(adminPool);

  t.after(async () => {
    await cleanupTenant(adminPool, tenant);
    await adminPool.end();
    await appPool.end();
  });

  // 4-login authorization architecture (2026-08-09): this actor is now
  // the L4 Position Account login (actorRole 'class_tutor') — this
  // test originally used 'staff' (tutorUser's personal login), which
  // is exactly the merge this architecture removes. See the dedicated
  // regression test right below for what tutorUser's personal login
  // now correctly sees instead (nothing, for the tutored-but-not-
  // taught class).
  await t.test(
    'tutor (class_tutor Position Account login, SELF_ASSIGNED) sees only their own tutored class',
    async () => {
      const rows = await withTenantClient(appPool, tenant.collegeId, (client) =>
        analyticsService.getAttendanceRateForActor(client, {
          actorUserId: tenant.tutorUserId,
          actorRole: 'class_tutor',
          collegeId: tenant.collegeId,
        }),
      );

      assert.equal(rows.length, 1);
      assert.equal(rows[0].classId, tenant.ownClassId);
      assert.equal(rows[0].sessionsCount, 1);
      assert.equal(rows[0].totalMarked, 10);
      assert.equal(rows[0].totalPresent, 10);
      assert.equal(rows[0].attendanceRatePercent, 100);
    },
  );

  // 4-login authorization architecture (2026-08-09) — the critical
  // regression case: tutorUser genuinely occupies ownClass's L4 seat,
  // but this call uses their personal Staff login. Sees nothing —
  // Position Occupancy alone must not widen a personal login's read
  // scope either.
  await t.test(
    "tutorUser's personal Staff login sees nothing, even though that person occupies ownClass's L4 seat",
    async () => {
      const rows = await withTenantClient(appPool, tenant.collegeId, (client) =>
        analyticsService.getAttendanceRateForActor(client, {
          actorUserId: tenant.tutorUserId,
          actorRole: 'staff',
          collegeId: tenant.collegeId,
        }),
      );

      assert.deepEqual(rows, []);
    },
  );

  await t.test("hod (DEPARTMENT scope) sees every class in their department, including the tutor's", async () => {
    const rows = await withTenantClient(appPool, tenant.collegeId, (client) =>
      analyticsService.getAttendanceRateForActor(client, {
        actorUserId: tenant.hodUserId,
        actorRole: 'hod',
        collegeId: tenant.collegeId,
      }),
    );

    const classIds = rows.map((r) => r.classId).sort();
    assert.deepEqual(classIds, [tenant.deptOnlyClassId, tenant.ownClassId].sort());
    assert.ok(
      !classIds.includes(tenant.otherDeptClassId),
      'a class from a different department must not appear for this HOD',
    );
  });

  await t.test(
    'tutor and hod see IDENTICAL attendance data for the class they share — the exact parity the ' +
      'original UAT report found broken',
    async () => {
      const [tutorRows, hodRows] = await Promise.all([
        withTenantClient(appPool, tenant.collegeId, (client) =>
          analyticsService.getAttendanceRateForActor(client, {
            actorUserId: tenant.tutorUserId,
            actorRole: 'class_tutor',
            collegeId: tenant.collegeId,
          }),
        ),
        withTenantClient(appPool, tenant.collegeId, (client) =>
          analyticsService.getAttendanceRateForActor(client, {
            actorUserId: tenant.hodUserId,
            actorRole: 'hod',
            collegeId: tenant.collegeId,
          }),
        ),
      ]);

      const tutorOwnClassRow = tutorRows.find((r) => r.classId === tenant.ownClassId);
      const hodOwnClassRow = hodRows.find((r) => r.classId === tenant.ownClassId);

      assert.ok(tutorOwnClassRow, 'tutor must see their own class');
      assert.ok(hodOwnClassRow, "hod must see the tutor's class too (it's in their department)");
      assert.deepEqual(tutorOwnClassRow, hodOwnClassRow);
    },
  );
});
