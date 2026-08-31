'use strict';

// Central read-access authorization for every place student/class/
// staff data is reachable — one shared resolution instead of the
// tutor/hod/principal logic that used to be duplicated per-service
// (studentService.js's own assertCanViewStudent, before this file
// existed). CLAUDE.md rule 1/4: this is a Business Service, calls
// other Business Services (staffService) and repositories, never
// touches another repository's table through a repository-to-
// repository call.
//
// Every hod/principal check resolves the REAL assignment from
// staff+users (never the JWT role claim alone) via staffService's own
// findHodForDepartment/findPrincipal/findHodDepartmentId — the same
// "resolve the real assignment, don't just trust the role string"
// discipline studentService.js established first.

const classRepository = require('../repositories/classRepository');
const studentRepository = require('../repositories/studentRepository');
const staffRepository = require('../repositories/staffRepository');
const staffService = require('./staffService');
const identityService = require('./identityService');
const scopeResolver = require('./scopeResolver');
const { buildActorContext } = require('./actorContextService');
const { SCOPE_LEVELS } = require('../constants/scopeLevels');

// Every public function below accepts EITHER the legacy
// {actorUserId, actorRole[, collegeId]} shape (built into an
// ActorContext internally, per-call) OR an already-built ActorContext
// directly — dual-input support so existing callers (studentService,
// routes/*) keep working unchanged while a caller that already has an
// ActorContext (e.g. a route sitting behind middleware/actorContext.js
// in a later milestone) can pass it straight through without a
// redundant rebuild. An ActorContext is distinguished from the legacy
// shape by the presence of `scopeLevel` — the legacy shape never has
// that key.
function isActorContext(input) {
  return input !== null && typeof input === 'object' && 'scopeLevel' in input;
}

async function resolveActorContext(client, input, tenantIdOverride) {
  if (isActorContext(input)) {
    return input;
  }
  const { actorUserId, actorRole, collegeId } = input;
  const tenantId = tenantIdOverride !== undefined ? tenantIdOverride : collegeId;
  const actorContext = await buildActorContext(client, {
    actorId: actorUserId,
    role: actorRole,
    tenantId,
  });

  // 4-login authorization architecture (2026-08-09): buildActorContext
  // resolves purely from actorUserId (identityService.resolveCapabilities
  // — the personal-login path, which deliberately no longer merges in a
  // tutor-of-record class, see visibilityResolver.js's own comment).
  // For an actorRole of 'class_tutor' specifically — i.e. this read is
  // authenticated via a genuine L4 Position Account login, not a
  // personal Staff login — that same login's OWN class must still be
  // readable; resolved directly and live here, the same targeted check
  // every write-path L4 authorization already uses, rather than
  // widening buildActorContext's personal-login resolution (which
  // would re-introduce the leak this architecture removes). Never
  // applied for actorRole 'staff' — that would be exactly the leak.
  if (actorRole === 'class_tutor' && tenantId !== undefined) {
    const tutorClassId = await identityService.resolveActiveClassTutorPosition(client, {
      userId: actorUserId,
      collegeId: tenantId,
    });
    if (tutorClassId !== null && !actorContext.assignedClassIds.includes(tutorClassId)) {
      return { ...actorContext, assignedClassIds: [...actorContext.assignedClassIds, tutorClassId] };
    }
  }

  return actorContext;
}

// Cheap accessors that read straight through either input shape
// without triggering buildActorContext's DB lookups — used to decide
// *whether* a full ActorContext is even worth resolving (e.g. a role
// that can never pass a given check has no reason to pay for a
// department/class lookup first).
function actorIdOf(input) {
  return isActorContext(input) ? input.actorId : input.actorUserId;
}

function actorRoleOf(input) {
  return isActorContext(input) ? input.role : input.actorRole;
}

// The one error every visibility check throws — a caller only needs to
// know "not allowed to view this," not which of several checks failed,
// same reasoning studentService.StudentNotAuthorizedError already
// settled on for the write-side equivalent.
class VisibilityForbiddenError extends Error {}

async function assertIsHodOfDepartment(client, collegeId, departmentId, actorUserId) {
  let hod;
  try {
    hod = await staffService.findHodForDepartment(client, collegeId, departmentId);
  } catch (err) {
    if (err instanceof staffService.StaffHodNotFoundError) {
      throw new VisibilityForbiddenError(`no hod found for department ${JSON.stringify(departmentId)}`);
    }
    throw err;
  }
  if (hod.user_id !== actorUserId) {
    throw new VisibilityForbiddenError(
      `user ${JSON.stringify(actorUserId)} is not the hod of department ${JSON.stringify(departmentId)}`,
    );
  }
}

async function assertIsPrincipalOfCollege(client, collegeId, actorUserId) {
  let principal;
  try {
    principal = await staffService.findPrincipal(client, collegeId);
  } catch (err) {
    if (err instanceof staffService.StaffPrincipalNotFoundError) {
      throw new VisibilityForbiddenError(`no principal found for college ${JSON.stringify(collegeId)}`);
    }
    throw err;
  }
  if (principal.user_id !== actorUserId) {
    throw new VisibilityForbiddenError(
      `user ${JSON.stringify(actorUserId)} is not the principal of college ${JSON.stringify(collegeId)}`,
    );
  }
}

// staff: tutor-of-record OR faculty-allocated (subject teacher) —
// broader than write access (studentService.assertCanModifyStudent
// stays tutor-only on purpose, per this session's own constraint, and
// does not call this function). hod: every class in their own, real,
// verified department. principal: unrestricted within the tenant (RLS
// already scopes reads to one college, so null here means exactly
// that, not literally every class in the DB). Anything else: no
// visibility, per this session's own task ("no student-private class
// visibility unless explicitly allowed").
// actorRole === undefined means an internal system caller — also
// unrestricted, same convention studentService.js already established
// for getStudent/listStudents.
async function getVisibleClassIds(client, input) {
  const actorContext = await resolveActorContext(client, input);
  // actorRole === undefined means an internal system caller —
  // unrestricted, same convention studentService.js already
  // established. This is not a scope level (no role means no
  // role->scope mapping to resolve), so it stays an explicit
  // exception rather than folding into scopeResolver.
  if (actorContext.role === undefined || scopeResolver.isAuthorizedForCollege(actorContext)) {
    return null;
  }
  if (actorContext.scopeLevel === SCOPE_LEVELS.SELF_ASSIGNED) {
    return actorContext.assignedClassIds;
  }
  if (actorContext.scopeLevel === SCOPE_LEVELS.DEPARTMENT) {
    if (actorContext.departmentIds.length === 0) {
      return [];
    }
    const classes = await classRepository.findByDepartmentId(client, actorContext.departmentIds[0]);
    return classes.map((cls) => cls.id);
  }
  return [];
}

async function assertCanViewClass(client, classId, input) {
  const actorContext = await resolveActorContext(client, input);
  const visibleIds = await getVisibleClassIds(client, actorContext);
  if (visibleIds === null || visibleIds.includes(classId)) {
    return;
  }
  throw new VisibilityForbiddenError(
    `role ${JSON.stringify(actorContext.role)} (user ${JSON.stringify(actorContext.actorId)}) may not view class ${JSON.stringify(classId)}`,
  );
}

// studentOrId may be an already-resolved student row (the common case
// — every existing caller already did its own findById for a 404
// check first) or a bare id.
async function resolveStudent(client, studentOrId) {
  if (studentOrId !== null && typeof studentOrId === 'object') {
    return studentOrId;
  }
  return studentRepository.findById(client, studentOrId);
}

async function assertCanViewStudent(client, studentOrId, input) {
  const student = await resolveStudent(client, studentOrId);
  if (student === null) {
    return; // caller's own 404, not this function's concern
  }

  const actorRole = actorRoleOf(input);
  const actorId = actorIdOf(input);

  // Each branch below only resolves an ActorContext (which is what
  // triggers staffService/classRepository/facultyAllocationRepository
  // lookups) when the role could plausibly pass the check — same
  // "only look up what this role needs" shape the original per-role
  // branches had, now expressed via scopeResolver instead of inline
  // role-string logic.
  //
  // Capability Coverage Audit finding (this session): 'class_tutor'
  // added — a genuine Position Account seat login's effectiveRole,
  // missing here the same way it was missing from
  // studentService.assertCanModifyStudent (see that fix's own
  // comment). buildActorContext re-resolves scopeLevel/assignedClassIds
  // from the DB independently of this string (it only decides whether
  // resolving is worth attempting at all), so admitting 'class_tutor'
  // here is sufficient — no other change needed in this function.
  if (actorRole === 'staff' || actorRole === 'class_tutor') {
    if (student.class_id !== null) {
      const actorContext = await resolveActorContext(client, input, student.college_id);
      if (scopeResolver.isAuthorizedForClass(actorContext, student.class_id)) {
        return;
      }
    }
    throw new VisibilityForbiddenError(
      `user ${JSON.stringify(actorId)} does not tutor or teach student ${JSON.stringify(student.id)}'s class`,
    );
  }

  if (actorRole === 'hod') {
    const sourceClass = student.class_id ? await classRepository.findById(client, student.class_id) : null;
    if (sourceClass === null || !sourceClass.department_id) {
      throw new VisibilityForbiddenError(
        `student ${JSON.stringify(student.id)} has no department-linked class to authorize against`,
      );
    }
    // Kept as a direct call to assertIsHodOfDepartment (forward
    // direction: department -> its one real hod, via
    // staffService.findHodForDepartment) rather than routing through
    // ActorContext.departmentIds (reverse direction: actor -> their
    // one real department, via staffService.findHodDepartmentId).
    // Both resolve the same real assignment and are logically
    // equivalent (a department has exactly one hod), but existing
    // callers (studentService.js's own assertIsHodOfDepartment
    // wrapper) and this file's own tests are wired to the forward
    // lookup specifically — switching the lookup direction here would
    // be an internal implementation change with no observable
    // authorization difference, but is not required by this pass and
    // only adds risk.
    await assertIsHodOfDepartment(client, student.college_id, sourceClass.department_id, actorId);
    return;
  }

  if (actorRole === 'principal') {
    // Kept as a direct, REAL-verified call (staffService.findPrincipal
    // + user_id match) rather than scopeResolver.isAuthorizedForCollege
    // — ActorContext.scopeLevel for 'principal' is a pure role->scope
    // mapping with no DB verification behind it (see
    // roleScopeLevels.js), and other callers (getVisibleClassIds,
    // assertCanViewStaff below) rely on exactly that unverified trust
    // already. Verifying here but not there would be a scoping
    // behavior change this pass may not make.
    await assertIsPrincipalOfCollege(client, student.college_id, actorId);
    return;
  }

  throw new VisibilityForbiddenError(`role ${JSON.stringify(actorRole)} may not view students`);
}

// target: { staffId } or { userId } to resolve one, or an
// already-resolved staff row (skips the lookup). GET /staff/:id names
// a staff.id (the profile row), not a user_id, so routes/staff.js
// passes { staffId }.
async function resolveStaffTarget(client, target) {
  if (target !== null && typeof target === 'object') {
    if (target.staffId !== undefined) {
      return staffRepository.findById(client, target.staffId);
    }
    if (target.userId !== undefined) {
      return staffRepository.findByUserId(client, target.userId);
    }
    return target;
  }
  return staffRepository.findById(client, target);
}

// self always. hod sees their own (real, verified) department's staff.
// principal sees the whole college directory — a staff row has no
// student-linked or aadhaar field to withhold (unlike documents/
// students), so "operational/profile staff directory" is exactly this
// table, college-wide. Ordinary staff cannot view another staff
// member's profile. (College Admin previously got the same
// college-wide reach here; BusinessRules.md's College Admin — final
// model removed it as a tenant role entirely, so that carve-out is
// gone too — see middleware/permissions.js's own note.)
async function assertCanViewStaff(client, target, input) {
  const staff = await resolveStaffTarget(client, target);
  if (staff === null) {
    return null;
  }

  const actorId = actorIdOf(input);
  if (staff.user_id === actorId) {
    return staff;
  }

  const actorRole = actorRoleOf(input);
  // 'principal' resolves to the college scope level (unverified — see
  // assertCanViewStudent's comment on the same trade-off). No
  // ActorContext is resolved at all for a role that can never pass
  // either check below — same "nothing to look up" outcome the
  // original role-string branches had for e.g. a plain 'staff' actor.
  if (actorRole !== 'principal' && actorRole !== 'hod') {
    throw new VisibilityForbiddenError(
      `role ${JSON.stringify(actorRole)} (user ${JSON.stringify(actorId)}) may not view staff ${JSON.stringify(staff.id)}`,
    );
  }

  const actorContext = await resolveActorContext(client, input, staff.college_id);
  if (scopeResolver.isAuthorizedForCollege(actorContext)) {
    return staff;
  }
  if (staff.department_id && scopeResolver.isAuthorizedForDepartment(actorContext, staff.department_id)) {
    return staff;
  }
  throw new VisibilityForbiddenError(
    `role ${JSON.stringify(actorContext.role)} (user ${JSON.stringify(actorContext.actorId)}) may not view staff ${JSON.stringify(staff.id)}`,
  );
}

module.exports = {
  VisibilityForbiddenError,
  assertIsHodOfDepartment,
  assertIsPrincipalOfCollege,
  getVisibleClassIds,
  assertCanViewClass,
  assertCanViewStudent,
  resolveStaffTarget,
  assertCanViewStaff,
};
