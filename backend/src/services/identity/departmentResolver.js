'use strict';

// Internal resolver module, only ever required by
// services/identityService.js (see positionResolver.js's docstring for
// the full "why internal, why no cross-resolver calls" reasoning —
// identical here).
//
// Resolves which departments a position is mapped to, from
// position_department_assignments (an exclusive-lock join table — one
// active assignment per department, enforced at the DB
// level; a position CAN own more than one department's mapping, e.g. a
// Level 2 "Dean of Engineering" seat spanning several departments —
// the direction that's exclusive is department -> position, not
// position -> department).

const positionRepository = require('../../repositories/positionRepository');

async function resolveMappedDepartments(client, positionId) {
  const rows = await positionRepository.findActiveDepartmentAssignmentsForPosition(client, positionId);
  return rows.map((row) => row.department_id);
}

module.exports = { resolveMappedDepartments };
