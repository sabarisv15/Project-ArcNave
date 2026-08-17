'use strict';

// The single public façade over the Position/Institutional Position
// Account/Occupant model (ADR-021). PositionResolver / ModuleResolver
// / DepartmentResolver / AssignmentResolver / VisibilityResolver /
// PositionSlotResolver live as plain-function internal modules under
// services/identity/*, never exposed to routes or AI tools directly,
// never calling each other — only this façade composes them.
// Routes/AI tools/workflowChainService must only ever require THIS
// file, never services/identity/* or repositories/positionRepository.js
// directly (mirrors CLAUDE.md rule 1 — "every AI tool calls a Business
// Service" — one layer down: identityService is that Business Service
// for identity/capability questions).
//
// Wired into Authorization (middleware/rbac.js, via
// middleware/identity.js), Workflow Routing (workflowChainService.js),
// Visibility/Data Scope (actorContextService.js), and Audit Identity
// (auditLogRepository.js) as of Phase 1. resolveCapabilities()'s return
// shape is frozen (see docs/adr/ADR-022-Identity-Resolver-Contract.md)
// — consumers build directly on it without reshaping it independently.
// resolvePositionOccupant() below is a second, later public entry
// point added in Phase 1's own conformance pass, once workflowChainService's
// actual need (a reverse, slot -> occupant lookup — resolveCapabilities
// only ever resolves the forward, user -> capabilities direction) turned
// out not to be covered by the frozen contract; adding it here keeps
// this file the sole owner of Position/Account/Occupant reads without
// touching resolveCapabilities()'s own shape at all.

const positionResolver = require('./identity/positionResolver');
const moduleResolver = require('./identity/moduleResolver');
const departmentResolver = require('./identity/departmentResolver');
const assignmentResolver = require('./identity/assignmentResolver');
const visibilityResolver = require('./identity/visibilityResolver');
const positionSlotResolver = require('./identity/positionSlotResolver');
const classResolver = require('./identity/classResolver');
const positionRepository = require('../repositories/positionRepository');

const PRINCIPAL_LEVEL = 1;
const LEVEL2 = 2;
const HOD_LEVEL = 3;
const STAFF_LEVEL = 4;
const CLASS_TUTOR_TYPE = 'class_tutor';

// resolveCapabilitiesForPosition given a positionAccountId with no
// matching position_accounts row (or whose position_id no longer
// resolves) — shouldn't happen in practice by the time middleware/
// identity.js reaches this (a Position Account access token's `sub` IS
// the position_account_id, minted only for an account that exists),
// but this function makes no assumption about future callers.
class PositionAccountNotFoundError extends Error {}

// The new model has no `role` string of its own (v1's whole point is
// to stop keying authorization off a flat users.role column) — but
// permissions.js/PERMISSION_ROLES, which IS keyed off role strings,
// needs something directly comparable. This derives the legacy-shaped
// role label a position implies, purely for comparison purposes:
// Level 1 -> 'principal', Level 3 -> 'hod', no active Level 1/3
// position -> 'staff' (the ADR-021 Level 4/person-centric default —
// see visibilityResolver's own docstring for why "no position found"
// is the expected staff case, not an error). A position holding BOTH
// is impossible today (nothing creates two positions for one user
// yet), but if it ever happens, Level 1 wins — same "lower level
// number outranks higher" precedent visibilityResolver already
// applies.
function deriveEffectiveRole(positions) {
  if (positions.some((p) => p.level === PRINCIPAL_LEVEL)) return 'principal';
  if (positions.some((p) => p.level === HOD_LEVEL)) return 'hod';
  return 'staff';
}

// The one public entry point. Resolves everything the legacy system's
// two separate mechanisms (permissions.js's role -> PERMISSION_ROLES
// lookup, actorContextService's role -> scope resolution) together
// produce for one user, from the new position/module/department data
// instead of users.role — a structure directly comparable to both.
//
// Returns:
//   {
//     userId, collegeId,
//     positions: [{ positionId, level, title, positionAccountId,
//                    currentOccupantUserId, moduleKeys, departmentIds }],
//     effectiveRole: 'principal' | 'hod' | 'staff',
//     scopeLevel: 'college' | 'department' | 'self_assigned',
//     departmentIds: string[],
//     assignedClassIds: string[],
//   }
//
// Never throws for "no position found" (that's the ordinary staff
// case) — only lets a genuine DB error propagate, same "the caller
// decides what a failure means" precedent every other service in this
// codebase follows. Any caller that needs to swallow errors (e.g. a
// best-effort comparison against a legacy value) is responsible for
// that at its own call site — that guard doesn't live in this
// function, so resolveCapabilities itself stays a normal, honestly-
// throwing function every caller can trust.
async function resolveCapabilities(client, { userId, collegeId }) {
  const activePositions = await positionResolver.resolveActivePositions(client, { collegeId, userId });

  // Sequential, not Promise.all: every resolver call below shares the
  // SAME connection (`client` is one pg Client/PoolClient — normally
  // the single per-request transaction connection tenant.js opens). A
  // single connection can only ever run one query at a time; issuing
  // several concurrently against it doesn't parallelize anything real
  // (pg itself just queues them) and node-postgres now deprecation-
  // warns on exactly this pattern. No behavior changes from being
  // sequential — this model has at most one or two active positions
  // per user in practice, so the extra round-trips are negligible.
  const positions = [];
  for (const position of activePositions) {
    // eslint-disable-next-line no-await-in-loop -- deliberately sequential, single shared connection (see comment above)
    const moduleKeys = await moduleResolver.resolveOwnedModules(client, position.positionId);
    // eslint-disable-next-line no-await-in-loop -- see above
    const departmentIds = await departmentResolver.resolveMappedDepartments(client, position.positionId);
    // eslint-disable-next-line no-await-in-loop -- see above
    const currentOccupantUserId = await assignmentResolver.resolveCurrentOccupantUserId(client, position.positionAccountId);
    positions.push({
      ...position, moduleKeys, departmentIds, currentOccupantUserId,
    });
  }

  // 4-login authorization architecture (2026-08-09): resolveCapabilities
  // (the personal-login path) no longer feeds a tutor-of-record class
  // into visibility scope — see visibilityResolver.js's own file-level
  // comment. resolveActiveClassTutorPosition remains exported below for
  // its legitimate informational uses (e.g. staffService.getOwnProfile's
  // is_class_tutor display flag) — it must never again be wired into
  // this function's own scope resolution.
  const visibility = await visibilityResolver.resolveVisibilityScope(client, {
    userId,
    positions,
    resolveDepartmentIds: (positionId) => departmentResolver.resolveMappedDepartments(client, positionId),
  });

  return {
    userId,
    collegeId,
    positions,
    effectiveRole: deriveEffectiveRole(positions),
    scopeLevel: visibility.scopeLevel,
    departmentIds: visibility.departmentIds,
    assignedClassIds: visibility.assignedClassIds,
  };
}

// Generic, identity-focused reverse lookup: given a structural slot —
// a college-wide level (e.g. { collegeId, level: 1 } for "this
// college's Principal"), a department (e.g. { collegeId,
// departmentId } for "whoever currently owns this department," Level
// 3 or a Principal-configured Level 2 alike, per Identity-
// Architecture.md §5.2), or — Phase 2 step 9 — a class (e.g.
// { collegeId, classId } for "this class's Class Tutor") — who
// currently occupies it? Not workflow-specific: any consumer needing
// "who holds this position right now" belongs on this same entry
// point, never a direct positionRepository/resolver call of its own.
// Returns null for a vacant slot (no position provisioned yet, or no
// active occupant) — the ordinary case, not an error, same convention
// resolveCapabilities itself follows for "no active position."
async function resolvePositionOccupant(client, {
  collegeId, level, departmentId, classId,
}) {
  const position = await positionSlotResolver.resolvePositionForSlot(client, {
    collegeId, level, departmentId, classId,
  });
  if (position === null) {
    return null;
  }
  return assignmentResolver.resolveCurrentOccupantUserId(client, position.positionAccountId);
}

// Phase 2 step 9 — the *reverse* direction studentService's tutor-reading
// call sites need (a user asking "which class do I tutor," not "who
// tutors this class"): filters this user's active positions down to a
// Class Tutor seat (position_type='class_tutor') and resolves its
// mapped class via classResolver. A class_tutor position maps to at
// most one class in practice (position_class_assignments' unique
// active-per-class index), so this returns a single classId, not a
// list — matching the semantics of the `classes.tutor_user_id` column
// it replaces (also a single value, enforced globally UNIQUE). Returns
// null if the user holds no active Class Tutor position, or holds one
// with no active class mapped yet — the ordinary case, not an error.
async function resolveActiveClassTutorPosition(client, { userId, collegeId }) {
  const position = await positionRepository.findActiveClassTutorPositionForUser(client, { collegeId, userId });
  if (position === null) {
    return null;
  }
  const classIds = await classResolver.resolveMappedClasses(client, position.position_id);
  return classIds[0] || null;
}

// Decision 4 (Phase 2 plan) / the Institutional Identity Context: a
// SEPARATE derivation from deriveEffectiveRole above, deliberately not
// reused — deriveEffectiveRole answers "what does this PERSON's whole
// set of positions imply," which is exactly the union this function
// must never produce. Pure function of one position's level +
// position_type only.
function deriveEffectiveRoleAndScopeForPosition({ level, positionType }) {
  if (level === PRINCIPAL_LEVEL) return { effectiveRole: 'principal', scopeLevel: 'college' };
  if (level === LEVEL2) return { effectiveRole: 'level2', scopeLevel: 'department' };
  if (level === HOD_LEVEL) return { effectiveRole: 'hod', scopeLevel: 'department' };
  if (level === STAFF_LEVEL && positionType === CLASS_TUTOR_TYPE) {
    return { effectiveRole: 'class_tutor', scopeLevel: 'class' };
  }
  return { effectiveRole: 'staff', scopeLevel: 'department' };
}

// The Institutional Identity Context's one public entry point (Phase 2
// decision 4) — sits ALONGSIDE resolveCapabilities, never modifying its
// frozen ADR-022 shape. Resolves capabilities for exactly ONE Position
// Account, never unioned with any other position the same occupant
// might also hold personally or via a second Position Account. Called
// from middleware/identity.js's 'position_access' branch once step 5
// wires it — not consumed by anything yet at this step.
async function resolveCapabilitiesForPosition(client, { positionAccountId }) {
  const account = await positionRepository.findPositionAccountById(client, positionAccountId);
  if (account === null) {
    throw new PositionAccountNotFoundError(`position account ${JSON.stringify(positionAccountId)} does not exist`);
  }

  const position = await positionRepository.findPositionById(client, account.position_id);
  if (position === null) {
    throw new PositionAccountNotFoundError(`position ${JSON.stringify(account.position_id)} does not exist`);
  }

  const moduleKeys = await moduleResolver.resolveOwnedModules(client, position.id);
  const departmentIds = await departmentResolver.resolveMappedDepartments(client, position.id);
  const classIds = await classResolver.resolveMappedClasses(client, position.id);
  const currentOccupantUserId = await assignmentResolver.resolveCurrentOccupantUserId(client, positionAccountId);

  const { effectiveRole, scopeLevel } = deriveEffectiveRoleAndScopeForPosition({
    level: position.level, positionType: position.position_type,
  });

  return {
    positionAccountId,
    positionId: position.id,
    level: position.level,
    positionType: position.position_type,
    title: position.title,
    collegeId: account.college_id,
    currentOccupantUserId,
    moduleKeys,
    departmentIds,
    classIds,
    effectiveRole,
    scopeLevel,
  };
}

// ADR-023's "who is actually asking" resolution (routes/ai.js's
// buildAiIdentityContext already applies this for the AI path —
// resolveCapabilities returns userId at the top level; a Position
// Account seat login's own claims.sub is the position_account_id,
// never a userId, so resolveCapabilitiesForPosition returns
// currentOccupantUserId, the real human currently holding that seat,
// instead). Capability Coverage Audit finding (this session): every
// ordinary GUI route still passed req.jwtClaims.sub straight through
// as actorUserId, which is correct for a personal login but is the
// position_account_id — not a real users.id — for a seat login, so
// "who did this" was silently wrong for every seat-login action any
// such route reached. Extracted here as the one shared resolution
// instead of duplicating the AI route's inline `||` chain a second
// time; routes/classes.js and routes/students.js are the first
// callers (scoped to this session's own work — the same substitution
// is still needed at every other route that reads req.jwtClaims.sub
// as an actorUserId, a real, tracked, NOT-yet-fixed gap).
function resolveActorUserId(capabilities) {
  return (capabilities && (capabilities.userId || capabilities.currentOccupantUserId)) || null;
}

module.exports = {
  resolveCapabilities,
  resolvePositionOccupant,
  resolveCapabilitiesForPosition,
  resolveActiveClassTutorPosition,
  resolveActorUserId,
  // Stage 8e / D17 — reused as-is by positionAccountAuthService.js to map
  // a position's level/positionType onto the same role string the 'auth'
  // configuration category's mfaRoles scoping already uses for personal
  // users, never a second mapping.
  deriveEffectiveRoleAndScopeForPosition,
  PositionAccountNotFoundError,
};
