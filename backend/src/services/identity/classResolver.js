'use strict';

// Internal resolver module, only ever required by
// services/identityService.js (see positionResolver.js's docstring for
// the full "why internal, why no cross-resolver calls" reasoning —
// identical here).
//
// Resolves which classes a position is mapped to, from
// position_class_assignments — mirrors departmentResolver.js exactly,
// FK'd to classes(id) instead of departments(id). In practice this is
// always zero or one class for a Level 4 + position_type='class_tutor'
// position (the unique index enforces one active tutor per class, not
// one class per position — see the migration's own comment), but this
// resolver makes no such assumption itself, same as departmentResolver
// not assuming Level 3 caps out at one department.

const positionRepository = require('../../repositories/positionRepository');

async function resolveMappedClasses(client, positionId) {
  const rows = await positionRepository.findActiveClassAssignmentsForPosition(client, positionId);
  return rows.map((row) => row.class_id);
}

module.exports = { resolveMappedClasses };
