'use strict';

// Internal resolver module, only ever required by
// services/identityService.js (see positionResolver.js's docstring for
// the full "why internal, why no cross-resolver calls" reasoning —
// identical here).
//
// Resolves which modules a position exclusively owns, from
// position_module_assignments (an exclusive-lock join table — one
// active assignment per college+module, enforced at the DB level).

const positionRepository = require('../../repositories/positionRepository');

async function resolveOwnedModules(client, positionId) {
  const rows = await positionRepository.findActiveModuleAssignmentsForPosition(client, positionId);
  return rows.map((row) => row.module_key);
}

module.exports = { resolveOwnedModules };
