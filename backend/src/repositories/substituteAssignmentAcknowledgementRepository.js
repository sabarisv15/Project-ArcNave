'use strict';

// Query mechanics for `substitute_assignment_acknowledgements` only —
// no UPDATE/DELETE, same immutable-fact treatment the migration's own
// comment describes. academicService.acknowledgeSubstituteAssignment
// treats a duplicate insert (UNIQUE(substitute_assignment_id)) as
// idempotent by checking findByAssignmentId first, not by relying on
// this repository to swallow a constraint violation.

async function create(client, { collegeId, substituteAssignmentId, acknowledgedByUserId }) {
  const result = await client.query(
    `INSERT INTO substitute_assignment_acknowledgements
       (college_id, substitute_assignment_id, acknowledged_by_user_id)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [collegeId, substituteAssignmentId, acknowledgedByUserId],
  );
  return result.rows[0];
}

async function findByAssignmentId(client, substituteAssignmentId) {
  const result = await client.query(
    'SELECT * FROM substitute_assignment_acknowledgements WHERE substitute_assignment_id = $1',
    [substituteAssignmentId],
  );
  return result.rows[0] || null;
}

module.exports = { create, findByAssignmentId };
