'use strict';

// Query mechanics for `college_campuses` only — tenant-scoped (RLS by
// college_id, same as departmentRepository.js), written only via a
// redeemed structural authorization key (RS-GOV-005 "add campus").

async function create(client, {
  collegeId, name, city, campusType, effectiveDate,
}) {
  const result = await client.query(
    `INSERT INTO college_campuses (college_id, name, city, campus_type, effective_date)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [collegeId, name, city || null, campusType || 'Satellite', effectiveDate || null],
  );
  return result.rows[0];
}

async function findByCollege(client, collegeId) {
  const result = await client.query(
    'SELECT * FROM college_campuses WHERE college_id = $1 ORDER BY created_at',
    [collegeId],
  );
  return result.rows;
}

module.exports = {
  create,
  findByCollege,
};
