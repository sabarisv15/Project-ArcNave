'use strict';

// Internal resolver module, only ever required by
// services/identityService.js (see positionResolver.js's docstring for
// the full "why internal, why no cross-resolver calls" reasoning —
// identical here).
//
// Resolves a user's visibility scope (Self/Department/College-wide),
// matching services/actorContextService.js's existing role-based
// scope logic (constants/roleScopeLevels.js's ROLE_SCOPE_LEVELS) — but
// derived from position/department data instead of `users.role`. This
// output is the reference the new model must continue agreeing with
// actorContextService's own output on, for the same user, before any
// future caller (workflowChainService, RBAC/AI tool cutover) depends
// on it.
//
// Mapping (v1 domain model, frozen — Identity-Organization-Model.md):
// - An active Level 1 position (Principal-equivalent) -> COLLEGE scope,
//   same reach ROLE_SCOPE_LEVELS.principal grants today.
// - An active Level 3 position (HOD-equivalent) -> DEPARTMENT scope,
//   scoped to whichever department(s) that position is mapped to via
//   position_department_assignments (departmentResolver) — same reach
//   ROLE_SCOPE_LEVELS.hod grants today (actorContextService currently
//   only ever resolves one department for an hod; this mirrors that,
//   using the first mapped department if more than one somehow exists,
//   the same "there should only ever be one" precedent
//   positionRepository.findActivePositionByCollegeAndLevel documents).
// - No active Level 1/3 position -> SELF_ASSIGNED scope (the Level
//   4/person-centric default, per ADR-021 — Level 4 has no `positions`
//   row at all in v1, so "no position found" IS the staff case, not an
//   error) — assignedClassIds is faculty-allocated classes only
//   (facultyAllocationRepository keys on user_id, genuinely person-
//   centric). It deliberately does NOT include a tutor-of-record class
//   here anymore (4-login authorization architecture, 2026-08-09): a
//   personal Staff login's scope must never widen merely because that
//   same person currently occupies an L4 Class Tutor Position Account
//   — occupying the L4 seat is informational (identityService.
//   resolveActiveClassTutorPosition still answers "does this person
//   hold it," used for display only, e.g. staffService.getOwnProfile's
//   is_class_tutor flag); it must not grant L4 scope/authority to this,
//   the personal, login. The L4 seat's own scope is resolved
//   independently and correctly by resolveCapabilitiesForPosition
//   (identityService.js), which never calls this resolver at all.
//
// Level 2 positions have no fixed scope-level the way Level 1/3 do —
// v1's domain model leaves them Principal-configurable (Identity-
// Architecture.md §5.2 / ADR-021). The configuration mechanism is the
// same position_department_assignments table Level 3 already uses:
// if Level 1 has assigned a Level 2 position one or more departments,
// that IS the Principal-defined policy, and it resolves to DEPARTMENT
// scope over exactly those departments. No assignment configured for
// it yet (the only case that exists anywhere today) falls straight
// through to the ordinary staff/SELF_ASSIGNED default below — never a
// hardcoded Level 2-specific scope.

const facultyAllocationRepository = require('../../repositories/facultyAllocationRepository');
const { SCOPE_LEVELS } = require('../../constants/scopeLevels');

const PRINCIPAL_LEVEL = 1;
const HOD_LEVEL = 3;
const LEVEL_2 = 2;

// 4-login authorization architecture (2026-08-09): no longer merges in
// a tutor-of-record class (see the file-level comment above) — a
// personal Staff login's assignedClassIds is faculty-allocated classes
// only. Kept as its own function (rather than inlined) since it's
// still a named, independently-testable step of resolveVisibilityScope.
async function resolveAssignedClassIds(client, userId) {
  const classIds = new Set();
  const allocations = await facultyAllocationRepository.findByStaffUserId(client, userId);
  for (const allocation of allocations) {
    classIds.add(allocation.class_id);
  }
  return [...classIds];
}

// `positions` is positionResolver's output for this user (already
// resolved by the caller — identityService — so this resolver doesn't
// need to reach into position_occupants itself); `resolveDepartmentIds`
// is a function(positionId) -> Promise<string[]>, normally
// departmentResolver.resolveMappedDepartments, injected rather than
// required directly so this module never calls another resolver module
// itself (identityService is the only thing allowed to compose them).
async function resolveVisibilityScope(client, {
  userId, positions, resolveDepartmentIds,
}) {
  const principalPosition = positions.find((p) => p.level === PRINCIPAL_LEVEL);
  if (principalPosition) {
    return { scopeLevel: SCOPE_LEVELS.COLLEGE, departmentIds: [], assignedClassIds: [] };
  }

  const hodPosition = positions.find((p) => p.level === HOD_LEVEL);
  if (hodPosition) {
    const departmentIds = await resolveDepartmentIds(hodPosition.positionId);
    return { scopeLevel: SCOPE_LEVELS.DEPARTMENT, departmentIds, assignedClassIds: [] };
  }

  const level2Position = positions.find((p) => p.level === LEVEL_2);
  if (level2Position) {
    const departmentIds = await resolveDepartmentIds(level2Position.positionId);
    if (departmentIds.length > 0) {
      return { scopeLevel: SCOPE_LEVELS.DEPARTMENT, departmentIds, assignedClassIds: [] };
    }
  }

  const assignedClassIds = await resolveAssignedClassIds(client, userId);
  return { scopeLevel: SCOPE_LEVELS.SELF_ASSIGNED, departmentIds: [], assignedClassIds };
}

module.exports = { resolveVisibilityScope };
