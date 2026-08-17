'use strict';

// Phase 3 Group (c): renders the structured Identity Context block
// (Phase3-AI-Identity-Context-Integration.md decision 4) prepended to
// whatever system prompt reaches the LLM — a labeled block, not a
// prose sentence, since an LLM reasons more reliably from one. Reads
// only fields identityContext already carries (routes/ai.js's
// buildAiIdentityContext, sourced from req.capabilities) — same
// "AI is a consumer, not a decider" the Policy Gate already holds to:
// this function branches on the generic scopeLevel/role values both
// resolveCapabilities and resolveCapabilitiesForPosition produce,
// never on which resolver produced them.

const collegeProfileService = require('./collegeProfileService');
const academicService = require('./academicService');
const { SCOPE_LEVELS } = require('../constants/scopeLevels');

const ROLE_LABELS = {
  principal: 'Principal',
  level2: 'Level 2',
  hod: 'HOD',
  class_tutor: 'Class Tutor',
  staff: 'Staff',
};

// Stage 8b / RS-IDN-012 ("AI renders the institution's own labels") —
// role keys with a real college-level custom-title column
// (collegeProfileService.getProfile, extended in Stage 8a/8b to return
// level1/level3/level4_position_title). level2/staff have no
// college-level column (L2 is set per-position, staff isn't a seat at
// all) — ROLE_LABELS' generic word is the correct answer for those,
// not a gap.
const ROLE_LABEL_PROFILE_COLUMNS = {
  principal: 'level1_position_title',
  hod: 'level3_position_title',
  class_tutor: 'level4_position_title',
};

function resolveRoleLabel(role, profile) {
  const column = ROLE_LABEL_PROFILE_COLUMNS[role];
  const customLabel = column && profile ? profile[column] : null;
  return customLabel || ROLE_LABELS[role] || role || 'Unknown';
}

async function resolveScope(client, identityContext) {
  if (identityContext.scopeLevel === 'college') {
    return { scope: 'College-wide', access: 'College-level' };
  }

  if (identityContext.scopeLevel === 'department') {
    const department = identityContext.departmentId
      ? await collegeProfileService.getDepartment(client, identityContext.departmentId)
      : null;
    return {
      scope: department ? `${department.name} Department` : 'Own department',
      access: 'Department-level',
    };
  }

  if (identityContext.scopeLevel === 'self_assigned' || identityContext.scopeLevel === 'class') {
    const classIds = identityContext.classIds || [];
    if (classIds.length === 1) {
      // classRepository.findById returns the raw `SELECT *` row —
      // snake_case (class_name), not the camelCase COLUMNS mapping
      // (which only applies to inserts/updates) — see that file's own
      // findById.
      const cls = await academicService.getClass(client, classIds[0]);
      return { scope: cls ? cls.class_name : 'Own class', access: 'Class-level' };
    }
    if (classIds.length > 1) {
      return { scope: `${classIds.length} own classes`, access: 'Class-level' };
    }
    return { scope: 'Own class(es)', access: 'Class-level' };
  }

  // No scopeLevel resolved (e.g. an internal caller, or a role with no
  // scope mapping) — fails closed to "nothing," never "everything."
  return { scope: 'Unscoped', access: 'None' };
}

async function describeIdentityContext(client, identityContext) {
  const [profile, { scope, access }] = await Promise.all([
    identityContext.collegeId ? collegeProfileService.getProfile(client, identityContext.collegeId) : null,
    resolveScope(client, identityContext),
  ]);
  const institution = profile ? profile.name : identityContext.collegeId;
  const role = resolveRoleLabel(identityContext.role, profile);

  return [
    'Identity Context',
    `Role: ${role}`,
    `Scope: ${scope}`,
    `Institution: ${institution}`,
    `Access: ${access}`,
    'Restrictions: Do not answer outside this scope.',
  ].join('\n');
}

// Phase 4 Group (a): maps an already-resolved identityContext (Phase 3's
// routes/ai.js buildAiIdentityContext, itself sourced from
// req.capabilities — Personal or Institutional, no branch here on
// which) onto the exact ActorContext shape actorContextService.
// buildActorContext returns, so visibilityService.isActorContext
// recognizes it immediately and skips its own DB re-resolution — the
// Identity Context Propagation Rule (Phase4-AI-Downstream-Scope-
// Fidelity.md): consume the already-resolved context, never re-derive
// a different one from userId/role. Pure and synchronous — no DB call.
//
// scopeLevel: 'class' (an Institutional Class Tutor position) maps to
// SCOPE_LEVELS.SELF_ASSIGNED — visibilityService's own three-value enum
// is not widened; a Class Tutor's "exactly these classes" is the same
// shape as a staff member's own self_assigned scope from
// getVisibleClassIds' point of view (decision 2).
function buildActorContextForIdentity(identityContext) {
  const scopeLevel = identityContext.scopeLevel === 'class'
    ? SCOPE_LEVELS.SELF_ASSIGNED
    : identityContext.scopeLevel;

  return {
    actorId: identityContext.userId,
    tenantId: identityContext.collegeId,
    role: identityContext.role,
    scopeLevel,
    departmentIds: identityContext.departmentIds || [],
    assignedClassIds: identityContext.classIds || [],
    campusIds: identityContext.collegeId !== undefined && identityContext.collegeId !== null
      ? [identityContext.collegeId]
      : [],
  };
}

module.exports = { describeIdentityContext, buildActorContextForIdentity };
