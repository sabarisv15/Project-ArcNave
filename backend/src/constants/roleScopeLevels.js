'use strict';

const { SCOPE_LEVELS } = require('./scopeLevels');

// Single source of truth for role -> scope-level. Add a future role
// here (vice_principal, dean, ...) and every scope-level check picks
// it up automatically — no role-string branching to hunt down and
// update elsewhere. A role with no entry here resolves to a null
// scope level: it participates in scope-level checks as "no scope,"
// not as an accidental college-wide grant.
const ROLE_SCOPE_LEVELS = Object.freeze({
  staff: SCOPE_LEVELS.SELF_ASSIGNED,
  hod: SCOPE_LEVELS.DEPARTMENT,
  principal: SCOPE_LEVELS.COLLEGE,
});

function resolveScopeLevel(role) {
  return ROLE_SCOPE_LEVELS[role] || null;
}

module.exports = { ROLE_SCOPE_LEVELS, resolveScopeLevel };
