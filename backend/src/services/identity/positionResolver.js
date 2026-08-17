'use strict';

// Internal resolver module, NOT a separately-callable service (see
// ADR-022). Only services/identityService.js may require this file;
// it must never be required directly by a route, an AI tool, or
// another resolver module — resolvers never call each other,
// mirroring CLAUDE.md's "repositories never call other repositories"
// one layer up.
//
// Resolves which position(s) a user actively occupies, in a given
// college, from position_occupants (ADR-021's append-only occupant
// ledger) — the pure "Position" half of the
// Position -> Institutional Position Account -> Occupant model.

const positionRepository = require('../../repositories/positionRepository');

// Returns every position this user currently, actively occupies in
// this college — normally zero or one (Level 1/Level 3 seats each have
// exactly one active occupant at a time, per the unique-active-per-
// account index), but the shape is a list because
// nothing in the schema forbids a person from occupying more than one
// position at once (e.g. a HOD who is also given a Level 2 module-lead
// seat) — callers that need a single "primary" position should apply
// their own tie-break (identityService uses highest level = lowest
// number, i.e. Level 1 outranks Level 3), not assume this resolver
// picks one for them.
async function resolveActivePositions(client, { collegeId, userId }) {
  const rows = await positionRepository.findActivePositionsForUser(client, { collegeId, userId });
  return rows.map((row) => ({
    positionId: row.position_id,
    level: row.level,
    title: row.title,
    positionAccountId: row.position_account_id,
  }));
}

module.exports = { resolveActivePositions };
