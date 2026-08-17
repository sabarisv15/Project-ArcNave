'use strict';

// Phase 2 (Position Account Auth). Step 6 delivered the recursive
// invite-guard (assertCanInvite/RECURSIVE_INVITERS) for Group (a)'s
// scope — Level 1/2/3. Step 7 adds the orchestration routes actually
// need: inviteToPosition (idempotent position provisioning + the
// invitation row + email) and acceptInvitation (credential bootstrap).
// Step 10 extends the guard with Class Tutor's 'ownDepartmentOnly' rule
// and adds ensureClassTutorPositionForInvite — both isolated (not yet
// wired into inviteToPosition, which still only branches on LEVEL3;
// that wiring is plan step 18).
//
// level/position_type are the two things that decide who may invite
// whom — never a role string, never req.jwtClaims.role. Level 1/2's
// rule is "actor is a Platform Admin" (a structurally different auth
// entirely — arcnave_platform's own JWT, no capabilities object at
// all); Level 3's rule reads the INVITING actor's own PERSONAL
// capabilities (identityService.resolveCapabilities, their ordinary
// users login) — an HOD inviting a Class Tutor, once that lands, acts
// from their ordinary login too, never a Position Account session
// inviting another Position Account.
//
// Scope note on what inviteToPosition/acceptInvitation do NOT do: this
// step bootstraps a Position Account's own CREDENTIALS only (its
// password_hash) — it does not link a position_occupant. Who currently
// OCCUPIES a position is a separate, already-partially-built concern
// (staffService.ensureHodPosition/swapHodOccupant,
// authService.provisionLevel1PositionForNewPrincipal) that the plan's
// own step 21 (reassignPositionOccupant, uniform across every level)
// is what unifies — not duplicated ad hoc here. A freshly-accepted
// Position Account can be occupant-linked through those existing
// mechanisms exactly as it is today.

const config = require('../config');
const security = require('../security');
const positionRepository = require('../repositories/positionRepository');
const positionAccountInvitationRepository = require('../repositories/positionAccountInvitationRepository');
const collegeProfileRepository = require('../repositories/collegeProfileRepository');
const notificationService = require('./notificationService');
const { logWarn } = require('../logging/logger');

const LEVEL1 = 1;
const LEVEL2 = 2;
const LEVEL3 = 3;
const STRUCTURAL_LEVEL_TITLES = { [LEVEL1]: 'Principal', [LEVEL2]: 'Level 2' };

class PositionInvitationForbiddenError extends Error {}

// Thrown for a level/position_type combination this guard has no rule
// for yet (Level 4 with no position_type never reaches this at all —
// plain staff get no invitation flow; Level 4 + 'class_tutor' is a
// real future combination, just not wired until step 10) — distinct
// from PositionInvitationForbiddenError: this is "not built yet," not
// "you're not allowed."
class PositionInvitationLevelNotSupportedError extends Error {}

const STAFF_LEVEL = 4;
const CLASS_TUTOR_TYPE = 'class_tutor';

const RECURSIVE_INVITERS = {
  1: { scopeCheck: 'platform_admin' },
  2: { scopeCheck: 'platform_admin' },
  // RS-IDN-004: L2 is optional; no L3 action may require one to exist.
  // The required actor level for creating/reassigning an L3 seat is L1,
  // not L2 — L2's and L3's occupants are both configured exclusively by L1.
  3: { requiredActorLevel: LEVEL1, scopeCheck: 'sameCollegeAnyDept' },
  [CLASS_TUTOR_TYPE]: { requiredActorLevel: LEVEL3, scopeCheck: 'ownDepartmentOnly' },
};

function inviterKeyFor({ level, positionType }) {
  if (level === 4 && positionType === 'class_tutor') return 'class_tutor';
  return level;
}

// The one thing this step delivers: given who's asking (a Platform
// Admin, or a tenant actor's own resolved PERSONAL capabilities) and
// what they want to invite someone into (targetLevel/targetPositionType/
// targetCollegeId), may they? Throws, never returns false — same
// "the guard fails loudly" convention every other assert* function in
// this codebase follows (e.g. assertLevelAllowsPositionLogin).
function assertCanInvite({
  actorIsPlatformAdmin, actorCapabilities, targetLevel, targetPositionType, targetCollegeId, targetDepartmentId,
}) {
  const key = inviterKeyFor({ level: targetLevel, positionType: targetPositionType });
  const rule = RECURSIVE_INVITERS[key];
  if (!rule) {
    throw new PositionInvitationLevelNotSupportedError(
      `no invite rule defined yet for level ${JSON.stringify(targetLevel)}${targetPositionType ? ` position_type ${JSON.stringify(targetPositionType)}` : ''}`,
    );
  }

  if (rule.scopeCheck === 'platform_admin') {
    if (!actorIsPlatformAdmin) {
      throw new PositionInvitationForbiddenError('only a Platform Admin may invite to this level');
    }
    return;
  }

  if (actorIsPlatformAdmin) {
    throw new PositionInvitationForbiddenError('a Platform Admin may not invite to this level');
  }
  if (!actorCapabilities || !Array.isArray(actorCapabilities.positions)) {
    throw new PositionInvitationForbiddenError('actor has no resolved capabilities');
  }
  const holdsRequiredLevel = actorCapabilities.positions.some((p) => p.level === rule.requiredActorLevel);
  if (!holdsRequiredLevel) {
    throw new PositionInvitationForbiddenError(
      `actor must hold an active level ${rule.requiredActorLevel} position to invite level ${JSON.stringify(targetLevel)}`,
    );
  }

  if (rule.scopeCheck === 'sameCollegeAnyDept') {
    if (actorCapabilities.collegeId !== targetCollegeId) {
      throw new PositionInvitationForbiddenError('actor and target position must belong to the same college');
    }
    return;
  }

  // 'ownDepartmentOnly' (Class Tutor, step 10): the inviting HOD's own
  // resolved department scope (actorCapabilities.departmentIds — their
  // ordinary PERSONAL login, per this file's own top-of-file note, not
  // a Position Account session) must include the target class's
  // department. Reuses the same departmentIds the visibility resolver
  // already computes for an HOD rather than re-deriving it here.
  if (rule.scopeCheck === 'ownDepartmentOnly') {
    if (!Array.isArray(actorCapabilities.departmentIds) || !actorCapabilities.departmentIds.includes(targetDepartmentId)) {
      throw new PositionInvitationForbiddenError('actor is not the HOD of the target class\'s department');
    }
    return;
  }

  throw new PositionInvitationLevelNotSupportedError(`scopeCheck ${JSON.stringify(rule.scopeCheck)} not implemented yet`);
}

// inviteToPosition given a position whose position_accounts row
// already exists — a fresh invite is only for FIRST-time credential
// bootstrap. Resending credentials to an already-provisioned account,
// or reassigning it to a new occupant, is the plan's own later step
// (21/22, reassignPositionOccupant) — deliberately not folded in here.
class PositionAccountAlreadyProvisionedError extends Error {}

// acceptInvitation given a token with no matching, unrevoked,
// unaccepted, unexpired position_account_invitations row. One generic
// message for every case — same don't-let-the-error-message-be-an-
// oracle reasoning as authService.InvitationInvalidError.
class PositionInvitationInvalidError extends Error {}

// inviteToPosition/acceptInvitation given a missing required field
// (departmentId for a Level 3 invite, a password that fails
// complexity) — raised before any repository call, same "guard first"
// shape every other service in this codebase uses.
class PositionInvitationValidationError extends Error {}

const PASSWORD_COMPLEXITY_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/;

// Idempotent find-or-create for the ONE structural position a college
// has at a given level (L1/L2 — mirrors
// authService.provisionLevel1PositionForNewPrincipal's/
// positionRepository.findActivePositionByCollegeAndLevel's own
// idempotency shape). createdBy may be null here (a Platform Admin has
// no users.id — see the migration relaxing positions.created_by's NOT
// NULL for exactly this reason); a tenant actor invitation never hits
// this path (Level 1/2 invites are Platform-Admin-only per
// RECURSIVE_INVITERS).
async function ensureStructuralPosition(client, { collegeId, level, title, createdBy }) {
  const existing = await positionRepository.findActivePositionByCollegeAndLevel(client, collegeId, level);
  if (existing) return existing;
  return positionRepository.createPosition(client, {
    collegeId, level, title: title || STRUCTURAL_LEVEL_TITLES[level] || `Level ${level}`, createdBy,
  });
}

// Level 3's own idempotent find-or-create, keyed by department — a
// position-only counterpart to staffService.ensureHodPosition (that
// function also creates a placeholder position_accounts row in the
// same call, which this deliberately does NOT do: this invite flow
// needs the account's official_email to be the real invitee's email,
// not ensureHodPosition's fixed internal placeholder domain — the two
// call sites have genuinely different needs from the same idempotent
// position lookup, so this isn't a duplicate of that function, it's a
// narrower one).
// title: an explicit caller-supplied title wins (e.g. an inviter who
// typed a one-off label for this specific seat); otherwise falls back
// to the college's own configured level3_position_title (Stage 8a),
// then the ARCNAVE default — same three-tier fallback
// ensureStructuralPosition already uses for L1/L2 via title ||
// STRUCTURAL_LEVEL_TITLES[level]. Previously this function silently
// ignored inviteToPosition's own `title` argument for Level 3
// specifically (a real bug — Level 1/2 honored it, Level 3 never did).
async function ensureHodPositionForInvite(client, {
  collegeId, departmentId, title, createdBy,
}) {
  const existingAssignment = await positionRepository.findActiveDepartmentAssignment(client, departmentId);
  if (existingAssignment) {
    return positionRepository.findPositionById(client, existingAssignment.position_id);
  }
  const chosenTitle = title || await collegeProfileRepository.getLevel3PositionTitle(client, collegeId);
  const position = await positionRepository.createPosition(client, {
    collegeId, level: LEVEL3, title: chosenTitle || 'HOD', createdBy,
  });
  await positionRepository.createPositionDepartmentAssignment(client, {
    collegeId, positionId: position.id, departmentId, assignedBy: createdBy,
  });
  return position;
}

// Class Tutor's own idempotent find-or-create, keyed by class — mirrors
// ensureHodPositionForInvite exactly, one level down (department ->
// class). Isolated at this step (not yet called from inviteToPosition,
// which still only branches on LEVEL3 — wiring Class Tutor invites
// through this is plan step 18, once assignClassTutor/routes/classes.js
// migration lands).
async function ensureClassTutorPositionForInvite(client, {
  collegeId, classId, title, createdBy,
}) {
  const existingAssignment = await positionRepository.findActiveClassAssignment(client, classId);
  if (existingAssignment) {
    return positionRepository.findPositionById(client, existingAssignment.position_id);
  }
  const chosenTitle = title || await collegeProfileRepository.getLevel4PositionTitle(client, collegeId);
  const position = await positionRepository.createPosition(client, {
    collegeId, level: STAFF_LEVEL, title: chosenTitle || 'Class Tutor', createdBy, positionType: CLASS_TUTOR_TYPE,
  });
  await positionRepository.createPositionClassAssignment(client, {
    collegeId, positionId: position.id, classId, assignedBy: createdBy,
  });
  return position;
}

// The one thing this step adds beyond the guard: idempotently
// provisions the target position (never a second row for the same
// college+level or department), creates its position_accounts row
// with the REAL invitee email (first-time bootstrap only — see
// PositionAccountAlreadyProvisionedError above), records the
// invitation, and emails the raw token. Never returns the raw token —
// same rule every other invitation flow in this codebase follows.
async function inviteToPosition(client, {
  collegeId, level, departmentId, title, email, actorIsPlatformAdmin, actorCapabilities, invitedBy,
}) {
  assertCanInvite({
    actorIsPlatformAdmin, actorCapabilities, targetLevel: level, targetPositionType: null, targetCollegeId: collegeId,
  });

  // positions.created_by REFERENCES users(id) — a Platform Admin's id
  // lives in platform_admins, not users, so it can never legally fill
  // this column (see the migration relaxing this to nullable for
  // exactly this reason). invitedBy itself (used below for the
  // invitation row, which has no such FK) still carries the REAL
  // actor id either way — this null-ing is scoped to the position's
  // own provenance column only.
  const positionCreatedBy = actorIsPlatformAdmin ? null : invitedBy;

  let position;
  if (level === LEVEL3) {
    if (!departmentId) {
      throw new PositionInvitationValidationError('departmentId is required for a Level 3 invite');
    }
    position = await ensureHodPositionForInvite(client, {
      collegeId, departmentId, title, createdBy: positionCreatedBy,
    });
  } else {
    position = await ensureStructuralPosition(client, {
      collegeId, level, title, createdBy: positionCreatedBy,
    });
  }

  const existingAccount = await positionRepository.findPositionAccountByPositionId(client, position.id);
  if (existingAccount) {
    throw new PositionAccountAlreadyProvisionedError(
      `position ${JSON.stringify(position.id)} already has a Position Account`,
    );
  }

  // A random, never-used placeholder hash — real credentials are set
  // by acceptInvitation once the invitee presents the token. Same
  // "placeholder now, real value at the actual moment it's known"
  // shape staffService.ensureHodPosition already establishes for its
  // own placeholder password, just generated fresh per invite rather
  // than a fixed value.
  const placeholderHash = await security.hashPassword(security.generateTemporaryPassword());
  const account = await positionRepository.createPositionAccount(client, {
    collegeId, positionId: position.id, officialEmail: email, passwordHash: placeholderHash,
  });

  const rawToken = security.generateRefreshToken();
  const expiresAt = new Date(Date.now() + config.principalInvitationExpireHours * 60 * 60 * 1000);
  const invitation = await positionAccountInvitationRepository.createInvitation(client, {
    collegeId,
    positionId: position.id,
    level,
    positionType: position.position_type,
    email,
    tokenHash: security.hashRefreshToken(rawToken),
    createdBy: invitedBy,
    expiresAt,
  });

  await notificationService.sendPositionAccountInvitationEmail(client, {
    to: email, collegeId, positionTitle: position.title, token: rawToken, expiresAt: invitation.expires_at,
  });

  return { invitation, position, account };
}

// Pre-transaction lookup — same shape as
// authService.lookupPendingInvitation: called on a short-lived,
// un-scoped connection BEFORE the caller knows which collegeId to open
// a real tenant transaction against (routes/positionAccountInvitations.js's
// accept route can't rely on tenantMiddleware's normal resolution any
// more than routes/invitations.js's own accept route can).
async function lookupPendingInvitation(client, token) {
  const tokenHash = security.hashRefreshToken(token || '');
  const invitation = await positionAccountInvitationRepository.getInvitationByTokenHash(client, tokenHash);

  if (invitation === null) {
    throw new PositionInvitationInvalidError('invitation token does not exist');
  }
  if (invitation.revoked_at !== null) {
    throw new PositionInvitationInvalidError(`invitation ${JSON.stringify(invitation.id)} was revoked`);
  }
  if (invitation.accepted_at !== null) {
    // Possible-theft signal, not a routine rejection — same asymmetry
    // authService.lookupPendingInvitation's own reuse-detection has.
    logWarn('position_account_invitation_reuse_detected', {
      collegeId: invitation.college_id,
      invitationId: invitation.id,
      originallyAcceptedAt: invitation.accepted_at,
    });
    throw new PositionInvitationInvalidError(`invitation ${JSON.stringify(invitation.id)} was already accepted`);
  }
  if (invitation.expires_at.getTime() <= Date.now()) {
    throw new PositionInvitationInvalidError(`invitation ${JSON.stringify(invitation.id)} has expired`);
  }

  return invitation;
}

// The post-transaction half: client is the tenant-scoped transaction
// already opened against invitation.college_id. Sets the Position
// Account's real password (it was a random placeholder until now) and
// marks the invitation accepted — credential bootstrap only, see this
// file's own scope note at the top for why occupant-linking isn't
// part of this function.
async function acceptInvitation(client, invitation, { password }) {
  if (!PASSWORD_COMPLEXITY_RE.test(password || '')) {
    throw new PositionInvitationValidationError(
      'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a symbol',
    );
  }

  const account = await positionRepository.findPositionAccountByPositionId(client, invitation.position_id);
  if (account === null) {
    throw new PositionInvitationInvalidError(`no Position Account exists for invitation ${JSON.stringify(invitation.id)}`);
  }

  await positionRepository.updatePositionAccountCredentials(client, account.id, await security.hashPassword(password));
  const wasAccepted = await positionAccountInvitationRepository.markInvitationAccepted(client, invitation.id);
  if (!wasAccepted) {
    throw new PositionInvitationInvalidError('This invitation has already been used');
  }

  return account;
}

// reassignPositionOccupant given a positionAccountId with no matching
// position_accounts row.
class PositionAccountReassignmentNotFoundError extends Error {}

// Phase 2 step 21 (ADR-021 §10, decision 5) — the ONE reassignment
// lifecycle, uniform across Level 1/2/3 and the Class Tutor assignment
// (position_type='class_tutor'), not per-type copies. Replaces
// staffService.swapHodOccupant's/classTutorService.swapClassTutorOccupant's
// own bare occupant-swap-only behavior (built before real Position
// Account credentials existed to reset) with the full lifecycle:
//
//   1. swap the occupant link (revoke the outgoing one, if any)
//   2. session revocation — token_version bump AND a bulk refresh-token
//      revoke (belt-and-suspenders; see
//      revokeAllPositionAccountRefreshTokens's own comment for why the
//      bump alone isn't sufficient)
//   3. clear MFA/recovery state
//   4. credential reset via a FRESH invite (decision 9 — never a
//      mailed temp password), reusing the exact same
//      position_account_invitations/sendPositionAccountInvitationEmail
//      mechanism inviteToPosition already establishes for first-time
//      bootstrap — the incoming occupant sets their own real password
//      through the ordinary accept flow, never inheriting whatever the
//      outgoing occupant (or a placeholder) had.
//
// Runs unconditionally whenever the occupant actually changes — INCLUDING
// filling a previously vacant seat — not only when replacing someone,
// since a freshly-assigned occupant needs that same real credential
// reset regardless of what (if anything) the account's password_hash
// was before. Idempotent no-op if newOccupantUserId already IS the
// current occupant — nothing to reassign, so no session/credential
// reset either (that would be a surprising, unrequested side effect of
// what's supposed to be a "did nothing" call). One transaction — client
// is the caller's own already-open per-request connection, so any
// failure partway through rolls back everything above with it.
async function reassignPositionOccupant(client, { positionAccountId, newOccupantUserId, actorUserId }) {
  if (!newOccupantUserId) {
    throw new PositionInvitationValidationError('newOccupantUserId is required');
  }

  const account = await positionRepository.findPositionAccountById(client, positionAccountId);
  if (account === null) {
    throw new PositionAccountReassignmentNotFoundError(`position account ${JSON.stringify(positionAccountId)} does not exist`);
  }
  const position = await positionRepository.findPositionById(client, account.position_id);

  const currentOccupant = await positionRepository.findActiveOccupant(client, positionAccountId);
  if (currentOccupant !== null && currentOccupant.user_id === newOccupantUserId) {
    return { occupant: currentOccupant, invitation: null };
  }

  if (currentOccupant !== null) {
    await positionRepository.revokePositionOccupant(client, currentOccupant.id, { revokedBy: actorUserId });
  }

  await positionRepository.incrementPositionAccountTokenVersion(client, positionAccountId);
  await positionRepository.revokeAllPositionAccountRefreshTokens(client, positionAccountId);
  await positionRepository.clearPositionAccountMfaAndRecovery(client, positionAccountId);

  const rawToken = security.generateRefreshToken();
  const expiresAt = new Date(Date.now() + config.principalInvitationExpireHours * 60 * 60 * 1000);
  const invitation = await positionAccountInvitationRepository.createInvitation(client, {
    collegeId: account.college_id,
    positionId: position.id,
    level: position.level,
    positionType: position.position_type,
    email: account.official_email,
    tokenHash: security.hashRefreshToken(rawToken),
    createdBy: actorUserId,
    expiresAt,
  });

  await notificationService.sendPositionAccountInvitationEmail(client, {
    to: account.official_email,
    collegeId: account.college_id,
    positionTitle: position.title,
    token: rawToken,
    expiresAt: invitation.expires_at,
  });

  const occupant = await positionRepository.createPositionOccupant(client, {
    collegeId: account.college_id, positionAccountId, userId: newOccupantUserId, assignedBy: actorUserId,
  });

  return { occupant, invitation };
}

module.exports = {
  PositionInvitationForbiddenError,
  PositionInvitationLevelNotSupportedError,
  PositionAccountAlreadyProvisionedError,
  PositionInvitationInvalidError,
  PositionInvitationValidationError,
  RECURSIVE_INVITERS,
  assertCanInvite,
  ensureClassTutorPositionForInvite,
  inviteToPosition,
  lookupPendingInvitation,
  acceptInvitation,
  PositionAccountReassignmentNotFoundError,
  reassignPositionOccupant,
};
