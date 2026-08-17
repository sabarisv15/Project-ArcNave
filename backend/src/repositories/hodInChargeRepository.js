'use strict';

// Query mechanics for `hod_in_charge_appointments` only — no business
// logic (that's StaffService's job). No delete — an appointment, once
// made, is a permanent fact; revoke() sets revoked_at, it never
// removes the row (see the migration's file-level comment).

async function create(client, {
  collegeId, departmentId, facultyUserId, appointedByUserId, reason,
}) {
  const result = await client.query(
    `INSERT INTO hod_in_charge_appointments
       (college_id, department_id, faculty_user_id, appointed_by_user_id, reason)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [collegeId, departmentId, facultyUserId, appointedByUserId, reason || null],
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM hod_in_charge_appointments WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findActiveForDepartment(client, collegeId, departmentId) {
  const result = await client.query(
    `SELECT * FROM hod_in_charge_appointments
     WHERE college_id = $1 AND department_id = $2 AND revoked_at IS NULL`,
    [collegeId, departmentId],
  );
  return result.rows[0] || null;
}

async function listForDepartment(client, departmentId) {
  const result = await client.query(
    'SELECT * FROM hod_in_charge_appointments WHERE department_id = $1 ORDER BY created_at DESC',
    [departmentId],
  );
  return result.rows;
}

async function revoke(client, id, { revokedByUserId }) {
  const result = await client.query(
    `UPDATE hod_in_charge_appointments SET revoked_at = now(), revoked_by_user_id = $2
     WHERE id = $1 AND revoked_at IS NULL
     RETURNING *`,
    [id, revokedByUserId],
  );
  return result.rows[0] || null;
}

module.exports = {
  create, findById, findActiveForDepartment, listForDepartment, revoke,
};
