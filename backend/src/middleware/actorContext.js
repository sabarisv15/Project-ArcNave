'use strict';

const asyncHandler = require('./asyncHandler');
const { buildActorContext } = require('../services/actorContextService');

// Runs after requireAuth (req.jwtClaims is a verified access claim)
// and after tenantMiddleware (req.dbClient/req.collegeId are set) —
// builds ActorContext ONCE per request and caches it on
// req.actorContext. Purely additive for this pass: nothing reads
// req.actorContext yet, req.jwtClaims/req.collegeId are untouched,
// and no route currently mounts this middleware — it exists as a
// standalone, independently testable unit that a later milestone
// wires into the route stack.
async function actorContextMiddleware(req, res, next) {
  req.actorContext = await buildActorContext(req.dbClient, {
    actorId: req.jwtClaims.sub,
    tenantId: req.collegeId,
    role: req.jwtClaims.role,
  });
  next();
}

module.exports = { actorContextMiddleware: asyncHandler(actorContextMiddleware) };
