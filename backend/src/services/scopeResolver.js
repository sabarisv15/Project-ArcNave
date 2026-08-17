'use strict';

// Given an ActorContext and a target resource, answers "is this actor
// authorized" purely from scopeLevel + the actor's own resolved ids —
// never a role-string comparison. Callers that used to branch on
// `actorRole === 'hod'` branch on `actorContext.scopeLevel ===
// SCOPE_LEVELS.DEPARTMENT` instead; visibilityService.js is the first
// caller migrated onto this.

const { SCOPE_LEVELS } = require('../constants/scopeLevels');

function isAuthorizedForCollege(actorContext) {
  return actorContext.scopeLevel === SCOPE_LEVELS.COLLEGE;
}

function isAuthorizedForDepartment(actorContext, departmentId) {
  if (actorContext.scopeLevel === SCOPE_LEVELS.COLLEGE) {
    return true;
  }
  if (actorContext.scopeLevel === SCOPE_LEVELS.DEPARTMENT) {
    return actorContext.departmentIds.includes(departmentId);
  }
  return false;
}

// Department-scoped actors (hod) are not authorized for an individual
// class through this check alone — a caller resolving a class first
// resolves its department_id and calls isAuthorizedForDepartment,
// same as visibilityService.js's assertCanViewStudent hod branch does
// (enumerating "every class in a department" is classRepository's
// job, not the scope resolver's).
function isAuthorizedForClass(actorContext, classId) {
  if (actorContext.scopeLevel === SCOPE_LEVELS.COLLEGE) {
    return true;
  }
  if (actorContext.scopeLevel === SCOPE_LEVELS.SELF_ASSIGNED) {
    return actorContext.assignedClassIds.includes(classId);
  }
  return false;
}

module.exports = {
  isAuthorizedForCollege,
  isAuthorizedForDepartment,
  isAuthorizedForClass,
};
