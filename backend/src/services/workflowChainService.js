'use strict';

// BusinessRules.md Configurable approval workflow: "ARCNAVE shall
// provide a configurable workflow engine that allows each institution
// to define approval hierarchies for different modules... Different
// modules may use different chains, such as Tutor, HOD, Principal, or
// College Admin combinations." (College Admin is excluded from the
// role vocabulary below — BusinessRules.md's own College Admin —
// final model made College Admin an ARCNAVE support employee with no
// seat in any tenant, so it can never be a resolvable in-tenant
// approver; see Staff/Multi-tenancy.)
//
// This is the ONE real engine every submitX workflow function in this
// codebase should eventually call instead of hardcoding its own
// approverChain array inline (academicService.submitTimetableForApproval/
// financeService.submitFeeStructureApproval/curriculumService.
// requestCurriculumMigration/attendanceService.requestAttendanceCorrection/
// studentService.requestInternalTransfer+requestInterCollegeTransfer+
// requestLifecycleStatusChange all still build their own chain inline
// today — retrofitting each is mechanical once this resolver exists,
// deliberately left for a fast-follow, not bundled into this same
// change: swapping the approver-resolution logic under N already-
// working, already-tested submit functions in one sweep is real
// regression risk this slice chooses not to take at once).
// academicService.submitTimetableForApproval is retrofitted here as
// the one proof this resolver actually works end to end.
//
// "Workflow changes apply only to new requests" needs no separate
// version-tracking column: workflowService.submitRequest already
// snapshots the resolved approver_chain into the workflow_requests row
// itself (JSONB, written once at submission) — a later config change
// can never retroactively alter an already-submitted row, since
// nothing re-reads config for an existing request. That guarantee
// already existed structurally; this file only adds where the chain
// comes from.
//
// DEFAULT_CHAINS matches every existing hardcoded chain in this
// codebase exactly — an institution that never configures anything
// gets identical behavior to today, not a behavior change by omission.

const configurationService = require('./configurationService');
const identityService = require('./identityService');
const workflowDelegationRepository = require('../repositories/workflowDelegationRepository');
const auditLogRepository = require('../repositories/auditLogRepository');

const WORKFLOW_CHAIN_CONFIG_CATEGORY = 'workflow_chains';

const DEFAULT_CHAINS = {
  timetable_approval: ['hod', 'principal'],
  curriculum_migration: ['principal'],
  attendance_correction: ['tutor'],
  mark_correction: ['tutor'],
  student_transfer: ['principal'],
  student_lifecycle_change: ['principal'],
  // BusinessRules.md Data retention and archival: "restoration of
  // archived records follows the institution's approval workflow."
  record_restoration: ['principal'],
  // RS-STF-002 (D10): staff registration's own hod -> principal chain,
  // now resolved through this same configurable resolver instead of
  // staffService's own hardcoded findHodForDepartment/findPrincipal
  // lookups — an institution can now configure an extra step into it,
  // same as every other entityType here.
  staff_registration: ['hod', 'principal'],
  // RS-CLS-007: "Approve: L3 only" — a single-step chain, floored at
  // HOD_LEVEL below so no institution config can weaken it to a
  // tutor-only approval (same shape student_lifecycle_change's own
  // floor already enforces).
  substitute_assignment: ['hod'],
  // RS-FIN-003: fee corrections were still hardcoding
  // `[{ role: 'hod', ... }]` inline in financeService.requestFeeCorrection
  // instead of going through this resolver — the ONLY reason this key
  // didn't already exist alongside every other correction-style chain
  // above. No floor: RS-WFL-003's table names only Timetable approval
  // (L1) and the student-transition floor (L3), neither of which
  // covers this entityType.
  fee_correction: ['hod'],
  // notificationService.submitForApproval's own inline
  // `[{ role: 'principal', ... }]` — same gap, same fix, same "no
  // RS-WFL-003 floor applies" reasoning as fee_correction above. Key
  // matches the entityType notificationService already passes to
  // workflowService.submitRequest ('notification'), same convention
  // every other key here already follows (e.g. substitute_assignment).
  notification: ['principal'],
};

const KNOWN_ROLES = ['principal', 'hod', 'tutor'];
const PRINCIPAL_LEVEL = 1;
const HOD_LEVEL = 3;

// RS-WFL-003 (D6, ADL-012 — structural pattern P2): "Some modules
// hard-code a mandatory minimum approval level that no institution
// configuration can remove." Names TWO floors, both enforced here:
// timetable_approval's L1 (Principal — RS-ACA-004: "mandatory final
// approver, not configurable away") and student_lifecycle_change's L3
// (RS-STU-007: "mandatory minimum floor"). Lower number = more
// authority (matches identityService's own PRINCIPAL_LEVEL=1/
// HOD_LEVEL=3/STAFF_LEVEL=4 convention) — a chain satisfies a floor if
// at least one of its resolved roles has a level at or above
// (numerically at-or-below) the floor. A chain resolving to `['tutor']`
// alone violates the L3 floor; `['hod']`, `['hod', 'principal']`, or
// `['principal']` alone all satisfy it, matching RS-STU-007's own "the
// chain MAY extend approval further up... but MUST NEVER configure
// these as Tutor-only." timetable_approval's floor is stricter still:
// only `principal` itself satisfies level <= 1, so an institution
// cannot configure timetable_approval to skip Principal at all.
const ROLE_LEVELS = { principal: PRINCIPAL_LEVEL, hod: HOD_LEVEL, tutor: 4 };
const ENTITY_APPROVAL_FLOORS = {
  timetable_approval: PRINCIPAL_LEVEL, student_lifecycle_change: HOD_LEVEL, substitute_assignment: HOD_LEVEL,
};

class WorkflowChainValidationError extends Error {}
class WorkflowChainUnknownEntityTypeError extends Error {}
class WorkflowChainUnknownRoleError extends Error {}

// resolveApproverChain resolved a chain for an entityType with a
// mandatory floor (ENTITY_APPROVAL_FLOORS above) whose roles never
// reach it — an institution-configured chain that omits the floor
// role entirely (e.g. `student_lifecycle_change: ['tutor']`). Raised
// before any role is resolved to a real user, same "reject the shape
// before touching data" discipline assertValidApproverChain already
// uses.
class WorkflowChainFloorViolationError extends Error {}

// departmentId required for 'hod', classId required for 'tutor' — a
// chain naming one of those roles without the context to resolve it
// is a caller bug (missing context), not a business-data problem.
class WorkflowChainMissingContextError extends Error {}

// Resolves 'principal'/'hod' via identityService.resolvePositionOccupant
// (ADR-022) instead of staffService's users.role-based lookups or any
// direct positionRepository/resolver access of this file's own —
// workflow routing is one of the four consumers Phase 1 moves onto the
// Position model as the single source of truth, and identityService is
// its sole entry point, never a second, parallel "who is the HOD/
// Principal" implementation. staffService.ensureHodPosition/
// swapHodOccupant (staffService.js) keep a department's Level 3
// occupant in sync on every HOD/Acting-HOD change, so an active HOD
// In-Charge appointee is simply the current occupant here too — no
// separate in-charge fallback needed, unlike the
// staffService.findHodForDepartment lookup this replaces.
async function resolveRoleUserId(client, role, { collegeId, classId, departmentId }) {
  if (role === 'principal') {
    const userId = await identityService.resolvePositionOccupant(client, { collegeId, level: PRINCIPAL_LEVEL });
    if (userId === null) {
      throw new WorkflowChainMissingContextError(`college ${JSON.stringify(collegeId)} has no active Principal to resolve a "principal" chain step`);
    }
    return userId;
  }
  if (role === 'hod') {
    if (!departmentId) {
      throw new WorkflowChainMissingContextError('departmentId is required to resolve an "hod" chain step');
    }
    const userId = await identityService.resolvePositionOccupant(client, { collegeId, departmentId });
    if (userId === null) {
      throw new WorkflowChainMissingContextError(`department ${JSON.stringify(departmentId)} has no active HOD (permanent or acting) to resolve an "hod" chain step`);
    }
    return userId;
  }
  if (role === 'tutor') {
    if (!classId) {
      throw new WorkflowChainMissingContextError('classId is required to resolve a "tutor" chain step');
    }
    // Phase 2 step 11: classes.tutor_user_id -> the Position/Account/
    // Occupant model, same swap resolveRoleUserId already made for
    // 'principal'/'hod' in Phase 1 — classRepository is no longer
    // consulted for this role at all.
    const userId = await identityService.resolvePositionOccupant(client, { collegeId, classId });
    if (userId === null) {
      throw new WorkflowChainMissingContextError(`class ${JSON.stringify(classId)} has no tutor assigned to resolve a "tutor" chain step`);
    }
    return userId;
  }
  throw new WorkflowChainUnknownRoleError(`role ${JSON.stringify(role)} is not a known chain role (${KNOWN_ROLES.join(', ')})`);
}

// BusinessRules.md: "temporary delegation supports start date, end
// date, reason, and delegated approver." Checked per resolved role,
// after the base resolution above — a delegation substitutes the
// approver, it never changes which roles a chain requires.
async function applyDelegationIfActive(client, role, baseUserId, { collegeId, departmentId, date }) {
  const delegation = await workflowDelegationRepository.findActive(client, {
    collegeId, role, departmentId: role === 'hod' ? departmentId : null, date,
  });
  return delegation === null ? baseUserId : delegation.delegate_user_id;
}

// BusinessRules.md: "each institution configures its own approval
// chain per module." Reads category 'workflow_chains', key
// entityType — falls back to DEFAULT_CHAINS[entityType] when the
// institution hasn't configured this module (or hasn't configured
// anything at all yet), never a hard failure for an unconfigured but
// otherwise-known module.
async function resolveApproverChain(client, {
  collegeId, entityType, classId, departmentId,
}, { date } = {}) {
  if (!collegeId || !entityType) {
    throw new WorkflowChainValidationError('collegeId and entityType are required');
  }

  const config = await configurationService.getConfiguration(client, { collegeId, category: WORKFLOW_CHAIN_CONFIG_CATEGORY });
  const configuredChain = config && config.configuration ? config.configuration[entityType] : undefined;
  const roles = configuredChain || DEFAULT_CHAINS[entityType];
  if (!roles) {
    throw new WorkflowChainUnknownEntityTypeError(`no chain configured or defaulted for entityType ${JSON.stringify(entityType)}`);
  }

  const floor = ENTITY_APPROVAL_FLOORS[entityType];
  if (floor !== undefined && !roles.some((role) => ROLE_LEVELS[role] <= floor)) {
    throw new WorkflowChainFloorViolationError(
      `entityType ${JSON.stringify(entityType)}'s chain ${JSON.stringify(roles)} never reaches its mandatory floor (level ${floor}) — RS-WFL-003`,
    );
  }

  const effectiveDate = date || new Date().toISOString().slice(0, 10);
  const chain = [];
  for (let i = 0; i < roles.length; i += 1) {
    const role = roles[i];
    // eslint-disable-next-line no-await-in-loop
    const baseUserId = await resolveRoleUserId(client, role, { collegeId, classId, departmentId });
    // eslint-disable-next-line no-await-in-loop
    const userId = await applyDelegationIfActive(client, role, baseUserId, { collegeId, departmentId, date: effectiveDate });
    chain.push({ step: i + 1, role, user_id: userId });
  }

  return chain;
}

async function createDelegation(client, {
  role, departmentId, delegateUserId, startDate, endDate, reason,
}, { actorUserId, collegeId } = {}) {
  if (!KNOWN_ROLES.includes(role)) {
    throw new WorkflowChainUnknownRoleError(`role ${JSON.stringify(role)} is not a known chain role (${KNOWN_ROLES.join(', ')})`);
  }
  if (!delegateUserId || !startDate) {
    throw new WorkflowChainValidationError('delegateUserId and startDate are required');
  }

  const delegation = await workflowDelegationRepository.create(client, {
    collegeId, role, departmentId, delegateUserId, startDate, endDate, reason, delegatedByUserId: actorUserId,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId, userId: actorUserId, action: 'workflow_delegation_created', entity: 'workflow_delegations', entityId: delegation.id, metadata: { role },
  });

  return delegation;
}

async function revokeDelegation(client, id, { actorUserId } = {}) {
  const delegation = await workflowDelegationRepository.revoke(client, id, { revokedByUserId: actorUserId });
  if (delegation === null) {
    return null;
  }
  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: delegation.college_id, userId: actorUserId, action: 'workflow_delegation_revoked', entity: 'workflow_delegations', entityId: id, metadata: null,
  });
  return delegation;
}

async function listDelegations(client, collegeId) {
  return workflowDelegationRepository.listForCollege(client, collegeId);
}

module.exports = {
  WORKFLOW_CHAIN_CONFIG_CATEGORY,
  DEFAULT_CHAINS,
  WorkflowChainValidationError,
  WorkflowChainUnknownEntityTypeError,
  WorkflowChainUnknownRoleError,
  WorkflowChainMissingContextError,
  WorkflowChainFloorViolationError,
  resolveApproverChain,
  // Exported for RS-ATT-004/RS-ASM-003's discretionary escalation
  // option (D9/D7, ADL-009/ADL-014): attendanceService/assessmentService
  // resolve a single "who is the hod/principal to escalate this specific
  // correction to" without going through resolveApproverChain's whole-
  // chain shape — the one real consumer this file's own header comment
  // already anticipated for role resolution outside a fresh chain.
  resolveRoleUserId,
  createDelegation,
  revokeDelegation,
  listDelegations,
};
