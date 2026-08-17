'use strict';

// Internal resolver module, only ever required by
// services/identityService.js (see positionResolver.js's docstring for
// the full "why internal, why no cross-resolver calls" reasoning —
// identical here).
//
// Resolves a position -> its current active occupant user_id, i.e. the
// inverse direction of positionResolver (which goes user -> positions).
// Both read the same position_occupants table; this resolver is the
// one workflowChainService will eventually call to answer "who
// currently holds this position" when routing an approval.

const positionRepository = require('../../repositories/positionRepository');

async function resolveCurrentOccupantUserId(client, positionAccountId) {
  const occupant = await positionRepository.findActiveOccupant(client, positionAccountId);
  return occupant ? occupant.user_id : null;
}

module.exports = { resolveCurrentOccupantUserId };
