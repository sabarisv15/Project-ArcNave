'use strict';

// Builds ActorContext — the one-pass resolution of "who is this actor
// and what can they reach" that middleware/identity.js caches on
// req.capabilities/req.actorContext, and that visibilityService.js's
// dual-input support builds internally from a legacy
// {actorUserId, actorRole} call.
//
// Phase 1 (Capability Resolver integration): this used to derive
// scope/department/class reach itself from users.role + staffService/
// classRepository/facultyAllocationRepository lookups — a second,
// independent implementation of exactly what identityService.
// resolveCapabilities already does from Position/Occupant data. That
// duplication is gone: this is now a thin adapter from
// resolveCapabilities' output onto the ActorContext shape
// visibilityService.js (and its ~30 existing call sites across the
// app) already expect, so none of them need to change. `role` is
// still accepted for signature compatibility but is no longer the
// source of truth for the returned context — capabilities.effectiveRole
// is, so a position holder's real, current standing always wins over
// whatever role string a caller happens to pass in.
const identityService = require('./identityService');

// campusIds is reserved for future multi-campus colleges — every
// college is currently single-campus, so this is just [tenantId].
async function buildActorContext(client, { actorId, tenantId }) {
  const capabilities = await identityService.resolveCapabilities(client, { userId: actorId, collegeId: tenantId });

  return {
    actorId,
    tenantId,
    role: capabilities.effectiveRole,
    scopeLevel: capabilities.scopeLevel,
    departmentIds: capabilities.departmentIds,
    assignedClassIds: capabilities.assignedClassIds,
    campusIds: tenantId !== undefined && tenantId !== null ? [tenantId] : [],
  };
}

module.exports = { buildActorContext };
