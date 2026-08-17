'use strict';

// Query mechanics for `departments` only -- no business logic (that's
// a future service's job, not built in this slice). Tenant scoping
// for id-keyed lookups relies on the table's RLS policy
// (current_setting('app.current_tenant', true) -- see the migration),
// same as staffRepository.js's findById.
//
// findByCollege/findByCollegeAndName filter on college_id explicitly
// in addition to RLS, same convention as staffRepository.js's
// findByStaffCode: college_id isn't the only column in the row's key
// (UNIQUE (college_id, name)), so the explicit filter documents the
// real key rather than relying on RLS alone.
//
// `remove` is a hard DELETE, not a soft-delete: no soft-delete column
// (deleted_at/is_active) exists on this table, same open question
// already flagged for staff/students -- not decided here either.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['name', 'name'],
  ['approvedIntake', 'approved_intake'],
  ['courseDuration', 'course_duration'],
  ['defaultSections', 'default_sections'],
  ['createdAtOnboarding', 'created_at_onboarding'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO departments (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM departments WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findByCollege(client, collegeId) {
  const result = await client.query(
    'SELECT * FROM departments WHERE college_id = $1 ORDER BY name',
    [collegeId],
  );
  return result.rows;
}

async function findByCollegeAndName(client, collegeId, name) {
  const result = await client.query(
    'SELECT * FROM departments WHERE college_id = $1 AND name = $2',
    [collegeId, name],
  );
  return result.rows[0] || null;
}

async function update(client, id, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return findById(client, id);
  }

  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => fields[key]);

  const result = await client.query(
    `UPDATE departments SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

async function remove(client, id) {
  await client.query('DELETE FROM departments WHERE id = $1', [id]);
}

// RS-GOV-011 (Readiness gate): onboarding-created departments (not
// post-onboarding L1 additions — see RS-GOV-008) that have no student
// yet, via the same students.class_id -> classes.department_id path
// every other department-scoped student query already uses. Never
// re-evaluated once a college reaches `active`, so callers only ever
// invoke this during a `ready -> active` transition attempt.
async function findOnboardingDepartmentsMissingStudents(client, collegeId) {
  const result = await client.query(
    `SELECT d.id, d.name
     FROM departments d
     WHERE d.college_id = $1 AND d.created_at_onboarding = true AND d.merged_into_department_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM students s
         JOIN classes c ON c.id = s.class_id
         WHERE c.department_id = d.id
       )
     ORDER BY d.name`,
    [collegeId],
  );
  return result.rows;
}

// RS-GOV-008/RS-GOV-009: a merge/rename executed only via a redeemed
// structural authorization key (see platformService.js). Rename is a
// plain name change; merge additionally reassigns every class currently
// pointing at a source department to the target, then marks the source
// merged (never deleted — RS-DAT-001) rather than reusing plain
// `remove`. version bumps by exactly 1 per RS-GOV-009, never
// recomputed from a client-supplied value.
async function renameDepartment(client, id, name) {
  const result = await client.query(
    `UPDATE departments SET name = $2, version = version + 1, updated_at = now()
     WHERE id = $1 AND merged_into_department_id IS NULL
     RETURNING *`,
    [id, name],
  );
  return result.rows[0] || null;
}

// RS-GOV-005's struct-key wizard: a rename can also carry a revised
// intake/duration in the same sitting (the wizard's own "Annual
// Intake"/"Programme Duration" fields) — same merged_into guard as
// plain renameDepartment, extended rather than duplicated.
async function renameDepartmentWithDetails(client, id, {
  name, approvedIntake, courseDuration, effectiveDate,
}) {
  const result = await client.query(
    `UPDATE departments SET name = $2, approved_intake = COALESCE($3, approved_intake),
       course_duration = COALESCE($4, course_duration),
       structural_effective_date = COALESCE($5, structural_effective_date),
       version = version + 1, updated_at = now()
     WHERE id = $1 AND merged_into_department_id IS NULL
     RETURNING *`,
    [id, name, approvedIntake ?? null, courseDuration ?? null, effectiveDate ?? null],
  );
  return result.rows[0] || null;
}

async function mergeDepartments(client, {
  sourceDepartmentIds, targetDepartmentId, name, approvedIntake, courseDuration, effectiveDate,
}) {
  await client.query(
    'UPDATE classes SET department_id = $2 WHERE department_id = ANY($1::uuid[])',
    [sourceDepartmentIds, targetDepartmentId],
  );
  await client.query(
    `UPDATE departments SET merged_into_department_id = $2, version = version + 1, updated_at = now()
     WHERE id = ANY($1::uuid[])`,
    [sourceDepartmentIds, targetDepartmentId],
  );
  const result = await client.query(
    `UPDATE departments SET name = COALESCE($2, name), approved_intake = COALESCE($3, approved_intake),
       course_duration = COALESCE($4, course_duration),
       structural_effective_date = COALESCE($5, structural_effective_date),
       version = version + 1, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [targetDepartmentId, name ?? null, approvedIntake ?? null, courseDuration ?? null, effectiveDate ?? null],
  );
  return result.rows[0] || null;
}

module.exports = {
  create,
  findById,
  findByCollege,
  findByCollegeAndName,
  update,
  remove,
  findOnboardingDepartmentsMissingStudents,
  renameDepartment,
  renameDepartmentWithDetails,
  mergeDepartments,
};
