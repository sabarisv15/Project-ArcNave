'use strict';

// The three read/write authorization scopes an ActorContext can
// resolve to. A scope level answers "how wide is this actor's
// reach," independent of which role produced it — see
// roleScopeLevels.js for the role -> scope-level mapping and
// services/scopeResolver.js for the checks built on top of these.
const SCOPE_LEVELS = Object.freeze({
  SELF_ASSIGNED: 'self_assigned',
  DEPARTMENT: 'department',
  COLLEGE: 'college',
});

module.exports = { SCOPE_LEVELS };
