'use strict';

// Business logic for the Super Admin Portal API: platform-admin login,
// college creation, and principal invitation.
//
// invitePrincipal is Option B from Module-00-Platform.md's Known
// Limitations writeup (now resolved): this module records an
// invitation row and hands back a bearer token, but never writes to
// `users` itself — creating the actual account happens on the tenant
// side (see routes/invitations.js), through the normal RLS-protected
// tenant write path. arcnave_platform has no GRANT on
// users/refresh_tokens/audit_log/configurations (see the ported
// migrations) and gets none here either — only SELECT/INSERT/UPDATE
// on principal_invitations (0002 migration), so even a bug in this
// file could not reach tenant data.
//
// No per-request transaction wrapping here, unlike tenant routes —
// deliberately, not an oversight. Every operation in this pass is a
// single statement (one SELECT for login, one INSERT for college
// creation); Postgres autocommits a standalone statement with no
// explicit BEGIN, so there is no cross-statement atomicity requirement
// to protect the way tenant routes have one (set_config(...) and the
// query it scopes MUST share one transaction, or RLS fails closed on
// the very next statement — see tenant.js). Routes call these
// functions with `platformPool` directly, not a checked-out client;
// node-postgres's Pool exposes the same .query() interface, and
// letting the pool manage checkout/release per call is simpler than
// introducing a request-scoped transaction middleware this pass has
// no actual need for.

const crypto = require('crypto');
const config = require('../config');
const security = require('../security');
const platformRepository = require('../repositories/platformRepository');
const principalInvitationRepository = require('../repositories/principalInvitationRepository');
const principalInviteVerificationRepository = require('../repositories/principalInviteVerificationRepository');
const platformCollegeRepository = require('../repositories/platformCollegeRepository');
const platformStatsRepository = require('../repositories/platformStatsRepository');
const platformAuditLogRepository = require('../repositories/platformAuditLogRepository');
const platformSettingsRepository = require('../repositories/platformSettingsRepository');
const wizardEmailVerificationRepository = require('../repositories/wizardEmailVerificationRepository');
const platformAuditService = require('./platformAuditService');
const notificationService = require('./notificationService');
const departmentRepository = require('../repositories/departmentRepository');
const academicService = require('./academicService');
const structuralAuthorizationKeyRepository = require('../repositories/structuralAuthorizationKeyRepository');
const collegeCampusRepository = require('../repositories/collegeCampusRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const onboardingTemplateRepository = require('../repositories/onboardingTemplateRepository');

// Generic platform-admin authentication failure — same single-
// message-for-every-failure-mode reasoning as AuthError in
// authService.js: unknown username and wrong password must look
// identical to the caller.
class PlatformAuthError extends Error {}

// bootstrapPlatformAdmin given no username/email/password — the three
// things a platform_admins row needs. Raised before any repository
// call, same as every other pre-query guard in this codebase.
class PlatformAdminValidationError extends Error {}

// bootstrapPlatformAdmin called when a platform_admins row already
// exists — this session's own task: "a safe first platform-admin setup
// method that does not require manually inserting database data,"
// which by definition must stop working the moment a first admin is
// real, or it would just be an unauthenticated way to create more.
class PlatformAlreadyBootstrappedError extends Error {}

// college_id or subdomain already exists (colleges' two UNIQUE
// constraints).
class DuplicateCollegeError extends Error {}

// createCollege/updateCollege given a subscription_status outside the
// two real license states. No DB CHECK constraint for this (same
// "validate in application code, not the schema" convention
// position_type's own migration comment documents) — enforced here
// instead.
class InvalidLicenseError extends Error {}

// updateCollege given a college_id with no matching row.
class CollegeUpdateNotFoundError extends Error {}

const VALID_LICENSES = ['trial', 'full'];

function assertValidLicense(subscriptionStatus) {
  if (subscriptionStatus !== undefined && !VALID_LICENSES.includes(subscriptionStatus)) {
    throw new InvalidLicenseError(`subscription_status must be one of ${JSON.stringify(VALID_LICENSES)}`);
  }
}

// invitePrincipal's target college_id doesn't exist. Raised from a
// foreign_key_violation (23503) on the INSERT — principal_invitations
// has exactly one FK (college_id -> colleges), so any 23503 here
// unambiguously means this; no separate existence check needed,
// same reasoning as DuplicateCollegeError's unique_violation catch
// above.
class CollegeNotFoundError extends Error {}

// resendPrincipalInvitation/revokePrincipalInvitation given an
// invitationId with no matching row.
class PrincipalInvitationNotFoundError extends Error {}

// resendPrincipalInvitation/revokePrincipalInvitation given an
// invitation that's already accepted or already revoked — neither can
// be resent or revoked again. One error class for both sub-cases,
// same "the caller only needs to know this isn't actionable" reasoning
// workflowService.WorkflowRequestAlreadyResolvedError already uses for
// its own two terminal states.
class PrincipalInvitationNotPendingError extends Error {}

// verifyPrincipalInviteCode given a (collegeId, email) with no live
// (unconsumed, unexpired) verification challenge — never requested, or
// the earlier sendPrincipalInviteVerificationCode's code already
// expired.
class PrincipalInviteVerificationNotFoundError extends Error {}

// verifyPrincipalInviteCode against a challenge that has already hit
// config.otp.maxAttempts mismatched guesses — same cap as the MFA/phone
// OTP flows.
class PrincipalInviteVerificationMaxAttemptsError extends Error {}

// verifyPrincipalInviteCode given a code that does not match the live
// challenge's code_hash.
class PrincipalInviteVerificationCodeMismatchError extends Error {}

// This session's own task: "a safe first platform-admin setup method
// that does not require manually inserting database data." Safe means
// two things: (1) it can never create a SECOND admin once one exists —
// enforced at the DB level by platformRepository.bootstrapPlatformAdmin's
// atomic INSERT ... WHERE NOT EXISTS, not a check-then-insert this
// service could race against itself; (2) deliberately unauthenticated
// (there is no admin yet to authenticate as — the same structural
// reason /invitations/accept is this codebase's other unauthenticated
// tenant-side route), but that only stays safe because of (1): the
// window in which this route does anything at all is exactly "zero
// platform_admins rows exist," which in practice means once at
// first deploy.
//
// A minimum password length is enforced here — nowhere else in this
// codebase validates password strength (activateUser always generates
// its own random one), but every other credential-creation path is
// gated behind an existing authenticated actor; this is the one
// exception, so it gets its own floor.
const MIN_BOOTSTRAP_PASSWORD_LENGTH = 8;

async function bootstrapPlatformAdmin(pool, { username, email, password }) {
  if (!username || !email || !password) {
    throw new PlatformAdminValidationError('username, email, and password are required');
  }
  if (password.length < MIN_BOOTSTRAP_PASSWORD_LENGTH) {
    throw new PlatformAdminValidationError(`password must be at least ${MIN_BOOTSTRAP_PASSWORD_LENGTH} characters`);
  }

  const passwordHash = await security.hashPassword(password);
  const admin = await platformRepository.bootstrapPlatformAdmin(pool, { username, email, passwordHash });
  if (admin === null) {
    throw new PlatformAlreadyBootstrappedError('a platform admin already exists; bootstrap can only run once');
  }
  return admin;
}

async function login(pool, { username, password }) {
  const admin = await platformRepository.getPlatformAdminByUsername(pool, username);
  if (!admin || !(await security.verifyPassword(password, admin.password_hash))) {
    throw new PlatformAuthError('Invalid username or password');
  }
  const accessToken = security.createPlatformAccessToken({ adminId: admin.id });
  return { accessToken, tokenType: 'bearer' };
}

// level1PositionTitle/level3PositionTitle: the Platform Admin's own
// names for the college's Level 1 and Level 3 positions ("Principal"/
// "Director", "HOD"/"Head of Section", ...) — ADR-021, and its
// Create/Edit College customization amendment for level3. Both
// optional; a college created without either behaves exactly as every
// college did before these fields existed (positionRepository/
// authService's/staffService's own defaults apply at accept/
// department-creation time, not here — see
// provisionLevel1PositionForNewPrincipal's and ensureHodPosition's own
// comments). Stored on `colleges` now, purely so they survive the
// create-college -> invite -> accept gap; not used anywhere in this
// function itself.
//
// storageTier: free-text, no validation — genuinely undecided product
// scope (see the migration's own comment), purely a label for now.
//
// subscriptionStatus (license): validated against VALID_LICENSES
// above; defaults to 'trial' at the repository layer (matching
// colleges' own DB DEFAULT) when omitted, same as every college
// created before this became a real, settable field.
//
// principalEmail: optional — when given, invitePrincipal fires in the
// same call as college creation instead of requiring a second,
// separate API call from the Platform Admin (decision: fold "invite
// inline" into createCollege rather than removing the standalone
// invite-principal route, which stays for re-inviting/inviting later).
// invitePrincipal's own CollegeNotFoundError can't fire here — the
// college this function just created always exists by the time this
// runs.
async function createCollege(pool, {
  collegeId, name, subdomain, createdBy, ipAddress,
  level1PositionTitle, level3PositionTitle, storageTier, subscriptionStatus, principalEmail,
  principalFullName, principalDesignation, principalPhone, principalAddress,
  ...profileFields
}) {
  assertValidLicense(subscriptionStatus);

  let college;
  try {
    college = await platformRepository.createCollege(pool, {
      collegeId, name, subdomain, createdBy, level1PositionTitle, level3PositionTitle, storageTier, subscriptionStatus,
      ...profileFields,
    });
  } catch (err) {
    // 23505 = unique_violation (Postgres SQLSTATE) — colleges has two
    // UNIQUE constraints (college_id, subdomain), either one failing
    // lands here. No need to distinguish which for the caller, same
    // as the deleted Python version's single DuplicateCollegeError
    // catching both.
    if (err.code === '23505') {
      throw new DuplicateCollegeError('college_id or subdomain already exists');
    }
    throw err;
  }

  await platformAuditService.record(pool, {
    actorAdminId: createdBy,
    action: 'college.created',
    entity: 'college',
    entityId: college.college_id,
    ipAddress,
    metadata: { name, subdomain },
  });

  let invitation = null;
  if (principalEmail) {
    invitation = await invitePrincipal(pool, {
      collegeId: college.college_id,
      email: principalEmail,
      createdBy,
      ipAddress,
      fullName: principalFullName,
      designation: principalDesignation,
      phone: principalPhone,
      address: principalAddress,
    });
  }

  return { college, invitation };
}

// Create/Edit College customization — the edit half of createCollege.
// college_id/subdomain are immutable (see platformRepository.
// updateCollege's own comment). Stage 8a / D13 / RS-GOV-013: license
// (subscriptionStatus) is the only field left editable here — name,
// level1/level3 position titles and storage tier all moved to the
// tenant side (collegeProfileRepository.js / the `storage`
// configuration category), so platformRepository.EDITABLE_COLUMNS no
// longer accepts them even if a caller still sends them.
async function updateCollege(pool, collegeId, {
  subscriptionStatus, actorAdminId, ipAddress,
}) {
  assertValidLicense(subscriptionStatus);

  const existing = await platformRepository.findCollegeById(pool, collegeId);
  if (existing === null) {
    throw new CollegeUpdateNotFoundError(`no college with college_id ${JSON.stringify(collegeId)}`);
  }

  const college = await platformRepository.updateCollege(pool, collegeId, { subscriptionStatus });

  await platformAuditService.record(pool, {
    actorAdminId,
    action: 'college.updated',
    entity: 'college',
    entityId: collegeId,
    ipAddress,
    metadata: { subscriptionStatus },
  });

  return college;
}

// Records an invitation and emails the raw token to the invitee
// (notificationService.sendPrincipalInvitationEmail — NotificationService
// exists now, Module 8) — this session's own task instruction: an
// invitation token must never be returned in an API response, only
// delivered via the existing notification flow. The raw token is
// never persisted — only its hash, via security.js's existing
// generateRefreshToken/hashRefreshToken, reused verbatim rather than
// duplicated: an invitation token has the same threat-model shape as a
// refresh token (server-generated high-entropy randomness), so the
// same reasoning for SHA-256 over argon2 applies unchanged.
function generateInviteVerificationCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashInviteVerificationCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

// Step 1 of the Invite L1 Principal flow: emails a 6-digit code to the
// address the admin typed, before any invitation exists. Same
// generate/hash/expire/email shape as authService.js's issueMfaChallenge,
// duplicated rather than shared because that one is keyed by an
// existing users row (user_id) and this one has none yet — only a
// (collegeId, email) pair.
async function sendPrincipalInviteVerificationCode(platformPool, { collegeId, email, ipAddress }) {
  const college = await platformRepository.findCollegeById(platformPool, collegeId);
  if (college === null) {
    throw new CollegeNotFoundError(`No college with college_id ${JSON.stringify(collegeId)}`);
  }

  const code = generateInviteVerificationCode();
  const expiresAt = new Date(Date.now() + config.otp.expireMinutes * 60 * 1000);
  const challenge = await principalInviteVerificationRepository.create(platformPool, {
    collegeId, email, codeHash: hashInviteVerificationCode(code), expiresAt,
  });

  const sendResult = await notificationService.sendMfaCodeEmail(platformPool, {
    to: email, code, expireMinutes: config.otp.expireMinutes,
  });

  await platformAuditService.record(platformPool, {
    actorAdminId: null, action: 'principal_invite_verification.sent', entity: 'principal_invite_verifications', entityId: challenge.id, ipAddress, metadata: { collegeId, email, deliveryStatus: sendResult.status },
  });

  return { challengeId: challenge.id, expiresAt: challenge.expires_at };
}

// Step 2: verifies the code against the live challenge. On success the
// row is marked consumed — invitePrincipal below checks for a recent
// consumed row before it will actually send an invitation, so this is
// a real gate, not just a UI step the frontend could skip past.
async function verifyPrincipalInviteCode(platformPool, { collegeId, email, code }) {
  const challenge = await principalInviteVerificationRepository.findLatestActive(platformPool, { collegeId, email });
  if (challenge === null) {
    throw new PrincipalInviteVerificationNotFoundError('no live verification code for this email — request a new one');
  }
  if (challenge.attempts >= config.otp.maxAttempts) {
    throw new PrincipalInviteVerificationMaxAttemptsError('too many incorrect attempts — request a new code');
  }
  if (hashInviteVerificationCode(code) !== challenge.code_hash) {
    await principalInviteVerificationRepository.incrementAttempts(platformPool, challenge.id);
    throw new PrincipalInviteVerificationCodeMismatchError('code does not match');
  }
  await principalInviteVerificationRepository.markConsumed(platformPool, challenge.id);
  return { verified: true };
}

// OnboardingWizard's L1 Head "Email" real OTP — same generate/hash/
// expire/email shape as sendPrincipalInviteVerificationCode above, but
// with no collegeId (no college row exists yet at Step 1 of the
// wizard) and no CollegeNotFoundError guard to match. Reuses the same
// PrincipalInviteVerification* error classes on the verify side below —
// identical meaning ("no live challenge" / "too many attempts" /
// "mismatch"), just a different table behind it.
async function sendWizardEmailVerificationCode(platformPool, { email, actorAdminId, ipAddress }) {
  const code = generateInviteVerificationCode();
  const expiresAt = new Date(Date.now() + config.otp.expireMinutes * 60 * 1000);
  const challenge = await wizardEmailVerificationRepository.create(platformPool, {
    email, codeHash: hashInviteVerificationCode(code), expiresAt,
  });

  const sendResult = await notificationService.sendMfaCodeEmail(platformPool, {
    to: email, code, expireMinutes: config.otp.expireMinutes,
  });

  await platformAuditService.record(platformPool, {
    actorAdminId, action: 'wizard_email_verification.sent', entity: 'wizard_email_verifications', entityId: challenge.id, ipAddress, metadata: { email, deliveryStatus: sendResult.status },
  });

  return { challengeId: challenge.id, expiresAt: challenge.expires_at };
}

async function verifyWizardEmailCode(platformPool, { email, code }) {
  const challenge = await wizardEmailVerificationRepository.findLatestActive(platformPool, { email });
  if (challenge === null) {
    throw new PrincipalInviteVerificationNotFoundError('no live verification code for this email — request a new one');
  }
  if (challenge.attempts >= config.otp.maxAttempts) {
    throw new PrincipalInviteVerificationMaxAttemptsError('too many incorrect attempts — request a new code');
  }
  if (hashInviteVerificationCode(code) !== challenge.code_hash) {
    await wizardEmailVerificationRepository.incrementAttempts(platformPool, challenge.id);
    throw new PrincipalInviteVerificationCodeMismatchError('code does not match');
  }
  await wizardEmailVerificationRepository.markConsumed(platformPool, challenge.id);
  return { verified: true };
}

// NOT server-gated on verification: invitePrincipal keeps its original
// contract (existing tests/integrations call it directly, unconditionally
// — see tests/principal-invitation.test.js, plus platform-service.test.js's
// own "no DB" pool={} calls, which would break against any DB-touching
// pre-check here). sendPrincipalInviteVerificationCode/
// verifyPrincipalInviteCode above exist purely for the new 3-step UI to
// call in sequence before this — an additive frontend flow, not a new
// backend precondition on the underlying invite action.
async function invitePrincipal(pool, {
  collegeId, email, createdBy, ipAddress, fullName, designation, phone, address,
}) {
  const rawToken = security.generateRefreshToken();
  const expiresAt = new Date(Date.now() + config.principalInvitationExpireHours * 60 * 60 * 1000);
  let invitation;
  try {
    invitation = await principalInvitationRepository.createInvitation(pool, {
      collegeId,
      email,
      tokenHash: security.hashRefreshToken(rawToken),
      createdBy,
      expiresAt,
      fullName,
      designation,
      phone,
      address,
    });
  } catch (err) {
    // 23503 = foreign_key_violation.
    if (err.code === '23503') {
      throw new CollegeNotFoundError(`No college with college_id ${JSON.stringify(collegeId)}`);
    }
    throw err;
  }

  await notificationService.sendPrincipalInvitationEmail(pool, {
    to: invitation.email,
    collegeId: invitation.college_id,
    token: rawToken,
    expiresAt: invitation.expires_at,
  });

  await platformAuditService.record(pool, {
    actorAdminId: createdBy,
    action: 'invitation.created',
    entity: 'principal_invitation',
    entityId: invitation.id,
    ipAddress,
    metadata: { collegeId: invitation.college_id, email: invitation.email },
  });

  return {
    invitationId: invitation.id,
    collegeId: invitation.college_id,
    email: invitation.email,
    expiresAt: invitation.expires_at,
  };
}

// Shared load+validate for resendPrincipalInvitation/
// revokePrincipalInvitation: the invitation must exist and must still
// be pending (never accepted, never revoked) — same "load then
// validate" shape financeService.loadPendingFeeStructureApproval
// already established for a different table.
async function loadPendingInvitation(pool, invitationId) {
  const invitation = await principalInvitationRepository.getInvitationById(pool, invitationId);
  if (invitation === null) {
    throw new PrincipalInvitationNotFoundError(`invitation ${JSON.stringify(invitationId)} does not exist`);
  }
  if (invitation.accepted_at !== null || invitation.revoked_at !== null) {
    throw new PrincipalInvitationNotPendingError(`invitation ${JSON.stringify(invitationId)} is no longer pending`);
  }
  return invitation;
}

// Rotates the invitation's token and expiry, then re-sends the email —
// the same row, not a new invitation, so accepting the OLD token (if
// it leaked, e.g. from a mis-delivered email) stops being possible the
// moment a fresh one is issued.
// `email` optionally redirects this resend to a different inbox
// (typo-correction case) — the same call rotates token/expiry either
// way. Notification always goes to the invitation's row AFTER the
// update (invitation.email), not the pre-update `existing.email`, so
// an overridden address actually receives the mail.
// resend's own, looser check — deliberately NOT loadPendingInvitation
// above (that one still gates revoke: you can't revoke an
// already-revoked row). Only accepted_at is terminal for resend; a
// revoked invitation is explicitly revivable (Invitations screen's
// "SEND INVITATION" action on a revoked row).
async function loadResendableInvitation(pool, invitationId) {
  const invitation = await principalInvitationRepository.getInvitationById(pool, invitationId);
  if (invitation === null) {
    throw new PrincipalInvitationNotFoundError(`invitation ${JSON.stringify(invitationId)} does not exist`);
  }
  if (invitation.accepted_at !== null) {
    throw new PrincipalInvitationNotPendingError(`invitation ${JSON.stringify(invitationId)} is no longer pending`);
  }
  return invitation;
}

async function resendPrincipalInvitation(pool, invitationId, { email, actorAdminId, ipAddress } = {}) {
  await loadResendableInvitation(pool, invitationId);

  const rawToken = security.generateRefreshToken();
  const expiresAt = new Date(Date.now() + config.principalInvitationExpireHours * 60 * 60 * 1000);
  const invitation = await principalInvitationRepository.resendInvitation(pool, invitationId, {
    tokenHash: security.hashRefreshToken(rawToken),
    expiresAt,
    email,
  });
  if (invitation === null) {
    // Lost a race against a concurrent accept/revoke between the load
    // above and this update — re-check to report the real reason.
    throw new PrincipalInvitationNotPendingError(`invitation ${JSON.stringify(invitationId)} is no longer pending`);
  }

  await notificationService.sendPrincipalInvitationEmail(pool, {
    to: invitation.email,
    collegeId: invitation.college_id,
    token: rawToken,
    expiresAt: invitation.expires_at,
  });

  await platformAuditService.record(pool, {
    actorAdminId,
    action: 'invitation.resent',
    entity: 'principal_invitation',
    entityId: invitation.id,
    ipAddress,
    metadata: { collegeId: invitation.college_id, email: invitation.email },
  });

  return {
    invitationId: invitation.id,
    collegeId: invitation.college_id,
    email: invitation.email,
    expiresAt: invitation.expires_at,
  };
}

// No email on revoke — nothing to tell the invitee that isn't already
// implied by the token simply no longer working.
async function revokePrincipalInvitation(pool, invitationId, { actorAdminId, ipAddress } = {}) {
  await loadPendingInvitation(pool, invitationId);

  const invitation = await principalInvitationRepository.revokeInvitation(pool, invitationId);
  if (invitation === null) {
    throw new PrincipalInvitationNotPendingError(`invitation ${JSON.stringify(invitationId)} is no longer pending`);
  }

  await platformAuditService.record(pool, {
    actorAdminId,
    action: 'invitation.revoked',
    entity: 'principal_invitation',
    entityId: invitation.id,
    ipAddress,
    metadata: { collegeId: invitation.college_id, email: invitation.email },
  });

  return {
    invitationId: invitation.id,
    collegeId: invitation.college_id,
    email: invitation.email,
    revokedAt: invitation.revoked_at,
  };
}

// Platform Admin module build, Phase C — Organizations screen list.
async function listColleges(pool, { limit, offset, search } = {}) {
  return platformCollegeRepository.listColleges(pool, { limit, offset, search });
}

// Invitations screen list — principal-only, matching what this
// backend actually provisions from the platform level (see the plan's
// "Invitations: Principal-only" scoping decision).
async function listInvitations(pool, {
  limit, offset, status, search,
} = {}) {
  return principalInvitationRepository.listInvitations(pool, {
    limit, offset, status, search,
  });
}

// Invitations screen stat row.
async function getInvitationsSummary(pool) {
  return principalInvitationRepository.getInvitationsSummary(pool);
}

async function listAuditLogs(pool, {
  limit, offset, action, actorAdminId, fromDate, toDate, search,
} = {}) {
  return platformAuditLogRepository.listEntries(pool, {
    limit, offset, action, actorAdminId, fromDate, toDate, search,
  });
}

async function getSettings(pool) {
  return platformSettingsRepository.getSettings(pool);
}

async function updateSettings(pool, {
  platformName, supportEmail, defaultTimezone, dateFormat, itemsPerPage, defaultLicense = 'trial', actorAdminId, ipAddress,
}) {
  if (!platformName) {
    throw new PlatformAdminValidationError('platformName is required');
  }
  assertValidLicense(defaultLicense);

  const settings = await platformSettingsRepository.updateSettings(pool, {
    platformName, supportEmail, defaultTimezone, dateFormat, itemsPerPage, defaultLicense,
  });

  await platformAuditService.record(pool, {
    actorAdminId,
    action: 'settings.updated',
    entity: 'platform_settings',
    entityId: null,
    ipAddress,
    metadata: {
      platformName, defaultTimezone, dateFormat, itemsPerPage, defaultLicense,
    },
  });

  return settings;
}

// Dashboard summary — composed from several small, focused queries
// (per-source repositories) rather than one large join, so each piece
// stays readable and independently testable, per the plan's own
// guidance for this endpoint.
async function getDashboardSummary(pool) {
  const [
    organizationsCount, organizationsNewThisWeek, pendingInvitationsCount, pendingInvitationsExpiringSoon,
    trialCollegesCount, trialCollegesExpiringSoon, activeUsersCount, recentColleges, recentActivity, systemHealth,
  ] = [
    await platformCollegeRepository.countColleges(pool),
    await platformCollegeRepository.countNewThisWeek(pool),
    await principalInvitationRepository.countPending(pool),
    await principalInvitationRepository.countExpiringSoon(pool),
    await platformCollegeRepository.countTrialColleges(pool),
    await platformCollegeRepository.countTrialCollegesExpiringSoon(pool),
    await platformStatsRepository.sumActiveUsers(pool),
    await platformCollegeRepository.recentColleges(pool, { limit: 5 }),
    await platformAuditLogRepository.listEntries(pool, { limit: 5 }),
    await platformStatsRepository.systemHealthSummary(pool),
  ];

  return {
    organizationsCount,
    organizationsNewThisWeek,
    pendingInvitationsCount,
    pendingInvitationsExpiringSoon,
    trialCollegesCount,
    trialCollegesExpiringSoon,
    activeUsersCount,
    recentColleges,
    recentActivity,
    systemHealth,
  };
}

// --- RS-GOV-003/008/010/011/012, RS-GOV-005/006: organization
// provisioning lifecycle, department risk split, structural
// authorization keys. ---

class ProvisioningTransitionError extends Error {}
class ReadinessGateNotSatisfiedError extends Error {}
class OnboardingDepartmentNotAllowedError extends Error {}
class StructuralKeyValidationError extends Error {}
class StructuralKeyNotFoundError extends Error {}
class StructuralKeyNotUsableError extends Error {}
class StructuralKeyActionMismatchError extends Error {}

const STRUCTURAL_ACTION_TYPES = [
  'l2_configuration', 'affiliation_change', 'add_campus', 'department_merge_rename', 'accreditation_change',
];
const STRUCTURAL_KEY_EXPIRY_DAYS = 7;

// RS-GOV-003: onboarding-time department creation is Platform-Admin-
// only and only while the college is still `provisioning` — it is the
// input to the Readiness gate (RS-GOV-011). Post-onboarding additions
// stay L1's own unrestricted action (routes/departments.js, unchanged
// by this rule — see RS-GOV-008's table).
async function createDepartmentAtOnboarding(tenantClient, platformPool, {
  collegeId, name, approvedIntake, courseDuration, defaultSections,
}, { actorAdminId, ipAddress }) {
  const college = await platformRepository.findCollegeById(platformPool, collegeId);
  if (college === null) {
    throw new CollegeNotFoundError(`no college with college_id ${JSON.stringify(collegeId)}`);
  }
  if (college.provisioning_status !== 'provisioning') {
    throw new OnboardingDepartmentNotAllowedError(
      `college ${JSON.stringify(collegeId)} is no longer in onboarding (provisioning_status ${JSON.stringify(college.provisioning_status)}) — use the tenant-side add-department action instead`,
    );
  }
  // RS-CLS-002: same requirement collegeProfileService.createDepartment
  // enforces for L1's own post-onboarding path — no platform-wide
  // section-count default exists (product decision), so Platform Admin
  // must supply both here too, before a department can ever be created
  // without the classes this rule says must exist immediately.
  if (!Number.isInteger(courseDuration) || courseDuration < 2) {
    throw new academicService.ClassGenerationValidationError('courseDuration must be an integer of at least 2');
  }
  if (!Number.isInteger(defaultSections) || defaultSections < 1) {
    throw new academicService.ClassGenerationValidationError('defaultSections must be a positive integer');
  }

  let department;
  try {
    department = await departmentRepository.create(tenantClient, {
      collegeId, name, approvedIntake, courseDuration, defaultSections, createdAtOnboarding: true,
    });
  } catch (err) {
    if (err.code === '23505') {
      throw new DuplicateCollegeError(`department ${JSON.stringify(name)} already exists at this college`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(tenantClient, {
    collegeId, userId: null, action: 'department_created_onboarding', entity: 'departments', entityId: department.id, metadata: { name, actorAdminId },
  });
  await platformAuditService.record(platformPool, {
    actorAdminId, action: 'department.created_onboarding', entity: 'department', entityId: department.id, ipAddress, metadata: { collegeId, name },
  });

  const classes = await academicService.generateClassesForDepartment(tenantClient, {
    departmentId: department.id, collegeId, name, courseDuration, defaultSections,
  }, { actorUserId: null });

  return { ...department, generatedClasses: classes };
}

// Mirrors createDepartmentAtOnboarding's gate exactly (same
// OnboardingDepartmentNotAllowedError — the restriction is generic to
// "an onboarding-only catalog action attempted outside provisioning",
// not department-specific): Platform-Admin-only, only while
// `provisioning_status === 'provisioning'`. No class-generation side
// effect (that's departments' own thing) and no file bytes stored —
// see 1759500000000's own comment for why this doesn't touch
// DocumentService.
async function createTemplateAtOnboarding(tenantClient, platformPool, {
  collegeId, name, fileType,
}, { actorAdminId, ipAddress }) {
  const college = await platformRepository.findCollegeById(platformPool, collegeId);
  if (college === null) {
    throw new CollegeNotFoundError(`no college with college_id ${JSON.stringify(collegeId)}`);
  }
  if (college.provisioning_status !== 'provisioning') {
    throw new OnboardingDepartmentNotAllowedError(
      `college ${JSON.stringify(collegeId)} is no longer in onboarding (provisioning_status ${JSON.stringify(college.provisioning_status)}) — document templates can only be added during onboarding`,
    );
  }

  let template;
  try {
    template = await onboardingTemplateRepository.create(tenantClient, { collegeId, name, fileType });
  } catch (err) {
    if (err.code === '23505') {
      throw new DuplicateCollegeError(`template ${JSON.stringify(name)} already exists at this college`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(tenantClient, {
    collegeId, userId: null, action: 'document_template_created_onboarding', entity: 'onboarding_document_templates', entityId: template.id, metadata: { name, fileType, actorAdminId },
  });
  await platformAuditService.record(platformPool, {
    actorAdminId, action: 'document_template.created_onboarding', entity: 'onboarding_document_template', entityId: template.id, ipAddress, metadata: { collegeId, name, fileType },
  });

  return template;
}

async function markCollegeReady(platformPool, collegeId, { actorAdminId, ipAddress }) {
  const college = await platformRepository.transitionProvisioningStatus(platformPool, collegeId, {
    fromStatuses: ['provisioning'], toStatus: 'ready',
  });
  if (college === null) {
    throw new ProvisioningTransitionError(`college ${JSON.stringify(collegeId)} is not in 'provisioning' — cannot mark ready`);
  }
  await platformAuditService.record(platformPool, {
    actorAdminId, action: 'college.marked_ready', entity: 'college', entityId: collegeId, ipAddress, metadata: null,
  });
  return college;
}

// RS-GOV-010: "onboarding cancelled midway leaves the college
// permanently in `provisioning` with a distinct terminal marker" —
// `cancelled` is that marker. Only reachable from `provisioning`,
// terminal (no route back), same as `archived`.
async function cancelOnboarding(platformPool, collegeId, { actorAdminId, ipAddress }) {
  const college = await platformRepository.transitionProvisioningStatus(platformPool, collegeId, {
    fromStatuses: ['provisioning'], toStatus: 'cancelled',
  });
  if (college === null) {
    throw new ProvisioningTransitionError(`college ${JSON.stringify(collegeId)} is not in 'provisioning' — cannot cancel onboarding`);
  }
  await platformAuditService.record(platformPool, {
    actorAdminId, action: 'college.onboarding_cancelled', entity: 'college', entityId: collegeId, ipAddress, metadata: null,
  });
  return college;
}

// RS-GOV-011: the one-time readiness gate, evaluated only on this
// transition. Read-only against tenant-scoped tables — callers must
// supply a tenant-context connection (see routes/platform.js's
// openTenantTransaction usage), since arcnave_platform has no grant on
// departments/students/classes at all (ADR-010 isolation).
async function checkReadinessGate(tenantClient, collegeId) {
  return departmentRepository.findOnboardingDepartmentsMissingStudents(tenantClient, collegeId);
}

async function activateCollege(tenantClient, platformPool, collegeId, { actorAdminId, ipAddress }) {
  const missing = await checkReadinessGate(tenantClient, collegeId);
  if (missing.length > 0) {
    throw new ReadinessGateNotSatisfiedError(
      `${missing.length} onboarding department(s) still have no enrolled student: ${missing.map((d) => d.name).join(', ')}`,
    );
  }

  const college = await platformRepository.transitionProvisioningStatus(platformPool, collegeId, {
    fromStatuses: ['ready'], toStatus: 'active',
  });
  if (college === null) {
    throw new ProvisioningTransitionError(`college ${JSON.stringify(collegeId)} is not in 'ready' — cannot activate`);
  }
  await platformAuditService.record(platformPool, {
    actorAdminId, action: 'college.activated', entity: 'college', entityId: collegeId, ipAddress, metadata: null,
  });
  return college;
}

// RS-GOV-012: reactivation/archival are direct Platform Admin status
// actions, never key-gated. Automatic terms-acceptance reactivation
// isn't built — no terms-acceptance flow exists anywhere in this
// codebase yet (a real, separate gap, not silently assumed done);
// every reactivation here is the "for any other reason" direct path
// the rule already names as the fallback.
async function suspendCollege(platformPool, collegeId, { actorAdminId, ipAddress }) {
  const college = await platformRepository.transitionProvisioningStatus(platformPool, collegeId, {
    fromStatuses: ['active'], toStatus: 'suspended',
  });
  if (college === null) throw new ProvisioningTransitionError(`college ${JSON.stringify(collegeId)} is not 'active' — cannot suspend`);
  await platformAuditService.record(platformPool, {
    actorAdminId, action: 'college.suspended', entity: 'college', entityId: collegeId, ipAddress, metadata: null,
  });
  return college;
}

// license is optional on both reactivate and restore below: the
// Reactivate/Restore modal lets the admin pick a license tier in the
// same step (the college may come back on a different plan than it
// left on), applied via the same platformRepository.updateCollege path
// updateCollege(pool, collegeId, {...}) already uses — not a new write
// path, just invoked from here too when a license is supplied.
async function reactivateCollege(platformPool, collegeId, { actorAdminId, ipAddress, license }) {
  assertValidLicense(license);
  let college = await platformRepository.transitionProvisioningStatus(platformPool, collegeId, {
    fromStatuses: ['suspended'], toStatus: 'active',
  });
  if (college === null) throw new ProvisioningTransitionError(`college ${JSON.stringify(collegeId)} is not 'suspended' — cannot reactivate`);
  if (license !== undefined) {
    college = await platformRepository.updateCollege(platformPool, collegeId, { subscriptionStatus: license });
  }
  await platformAuditService.record(platformPool, {
    actorAdminId, action: 'college.reactivated', entity: 'college', entityId: collegeId, ipAddress, metadata: { license: license ?? null },
  });
  return college;
}

async function archiveCollege(platformPool, collegeId, { actorAdminId, ipAddress }) {
  const college = await platformRepository.transitionProvisioningStatus(platformPool, collegeId, {
    fromStatuses: ['active', 'suspended'], toStatus: 'archived',
  });
  if (college === null) throw new ProvisioningTransitionError(`college ${JSON.stringify(collegeId)} is not 'active' or 'suspended' — cannot archive`);
  await platformAuditService.record(platformPool, {
    actorAdminId, action: 'college.archived', entity: 'college', entityId: collegeId, ipAddress, metadata: null,
  });
  return college;
}

// RS-GOV-012 never actually named an archived -> active path (see this
// function group's own header comment above) — added here as a
// distinct, explicit Platform Admin action ("Restore"), not folded
// into reactivateCollege, since the two start from different terminal-
// adjacent states (suspended is reversible by design; archived was
// modeled as terminal until now) and a UI should never let one button
// silently cover both.
async function restoreCollege(platformPool, collegeId, { actorAdminId, ipAddress, license }) {
  assertValidLicense(license);
  let college = await platformRepository.transitionProvisioningStatus(platformPool, collegeId, {
    fromStatuses: ['archived'], toStatus: 'active',
  });
  if (college === null) throw new ProvisioningTransitionError(`college ${JSON.stringify(collegeId)} is not 'archived' — cannot restore`);
  if (license !== undefined) {
    college = await platformRepository.updateCollege(platformPool, collegeId, { subscriptionStatus: license });
  }
  await platformAuditService.record(platformPool, {
    actorAdminId, action: 'college.restored', entity: 'college', entityId: collegeId, ipAddress, metadata: { license: license ?? null },
  });
  return college;
}

// Organizations page stat row.
async function getOrganizationsSummary(platformPool) {
  return platformCollegeRepository.getOrganizationsSummary(platformPool);
}

// RS-GOV-005/006: L1 generates (from their own tenant login), Platform
// Admin redeems (from the platform side) — same cross-boundary shape
// as invitePrincipal/acceptInvitation. actionPayload is fixed at
// generation time; redemption never accepts a payload from Platform
// Admin, only the token — "each key authorizes exactly one specific
// change, named at generation time."
async function generateStructuralAuthorizationKey(tenantClient, {
  collegeId, actionType, actionPayload,
}, { actorUserId }) {
  if (!STRUCTURAL_ACTION_TYPES.includes(actionType)) {
    throw new StructuralKeyValidationError(`actionType must be one of ${JSON.stringify(STRUCTURAL_ACTION_TYPES)}`);
  }
  if (!actionPayload || typeof actionPayload !== 'object') {
    throw new StructuralKeyValidationError('actionPayload is required');
  }

  // RS-GOV-006 cardinality: generating a new key invalidates any prior
  // unused one for this college, before the new row is created.
  await structuralAuthorizationKeyRepository.cancelAllGeneratedForCollege(tenantClient, collegeId);

  const rawToken = security.generateRefreshToken();
  const expiresAt = new Date(Date.now() + STRUCTURAL_KEY_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const key = await structuralAuthorizationKeyRepository.createKey(tenantClient, {
    collegeId, actionType, actionPayload, tokenHash: security.hashRefreshToken(rawToken), generatedBy: actorUserId, expiresAt,
  });

  await auditLogRepository.createAuditLogEntry(tenantClient, {
    collegeId, userId: actorUserId, action: 'structural_authorization_key_generated', entity: 'structural_authorization_keys', entityId: key.id, metadata: { actionType },
  });

  return { keyId: key.id, rawToken, actionType: key.action_type, expiresAt: key.expires_at };
}

async function cancelStructuralAuthorizationKey(tenantClient, collegeId, keyId, { actorUserId }) {
  const existing = await structuralAuthorizationKeyRepository.findById(tenantClient, keyId);
  if (existing === null || existing.college_id !== collegeId) {
    throw new StructuralKeyNotFoundError(`no structural authorization key ${JSON.stringify(keyId)} for this college`);
  }
  const cancelled = await structuralAuthorizationKeyRepository.cancelKey(tenantClient, keyId);
  if (cancelled === null) {
    throw new StructuralKeyNotUsableError(`key ${JSON.stringify(keyId)} is not in a cancellable state`);
  }
  await auditLogRepository.createAuditLogEntry(tenantClient, {
    collegeId, userId: actorUserId, action: 'structural_authorization_key_cancelled', entity: 'structural_authorization_keys', entityId: keyId, metadata: null,
  });
  return cancelled;
}

// Looks up and validates a raw token without consuming it — the
// caller (routes/platform.js) executes the requested sections FIRST
// (see executeStructuralActions), and only calls
// markStructuralKeyRedeemed after that succeeds, so an ordinary
// technical/data-validation failure during execution never consumes
// the key (RS-GOV-006). actionType is optional here: since any valid,
// unexpired key now unlocks the whole 5-section wizard (the key proves
// the college requested SOME structural change; which section(s)
// actually get filled in is Platform Admin's call at redemption —
// see executeStructuralActions' own header comment), no caller
// currently passes it. Kept as an optional param for a future caller
// that does want the old strict single-type match.
async function loadRedeemableStructuralKey(platformPool, { rawToken, actionType }) {
  const key = await structuralAuthorizationKeyRepository.findByTokenHash(platformPool, security.hashRefreshToken(rawToken));
  if (key === null) {
    throw new StructuralKeyNotFoundError('no structural authorization key matches this token');
  }
  if (key.status !== 'generated' || new Date(key.expires_at).getTime() <= Date.now()) {
    throw new StructuralKeyNotUsableError(`key is ${key.status === 'generated' ? 'expired' : key.status}, not usable`);
  }
  if (actionType !== undefined && key.action_type !== actionType) {
    throw new StructuralKeyActionMismatchError(`key authorizes ${JSON.stringify(key.action_type)}, not ${JSON.stringify(actionType)}`);
  }
  return key;
}

async function markStructuralKeyRedeemed(platformPool, keyId, { actorAdminId, ipAddress }) {
  const redeemed = await structuralAuthorizationKeyRepository.redeemKey(platformPool, keyId, { redeemedBy: actorAdminId });
  if (redeemed === null) {
    throw new StructuralKeyNotUsableError(`key ${JSON.stringify(keyId)} was no longer redeemable at commit time`);
  }
  await platformAuditService.record(platformPool, {
    actorAdminId, action: 'structural_authorization_key_redeemed', entity: 'structural_authorization_keys', entityId: keyId, ipAddress, metadata: { collegeId: redeemed.college_id, actionType: redeemed.action_type },
  });
  return redeemed;
}

// RS-GOV-008: the one action_type wired to a real executor in this
// slice — department merge/rename. Runs against a tenant-context
// connection (departments/classes are RLS-protected). Called by
// routes/platform.js's redeem route between loadRedeemableStructuralKey
// and markStructuralKeyRedeemed.
// userId is always null here, never actorAdminId — audit_log.user_id
// is an FK into `users`, and a Platform Admin (the only actor that
// ever reaches this function) has no `users` row at all. The admin's
// identity is still fully recoverable: platformService's own redeem
// route separately records structural_authorization_key_redeemed in
// platform_audit_log with the real actor_admin_id, and this entry's
// metadata carries the same key/action facts to cross-reference.
async function executeDepartmentMergeOrRename(tenantClient, collegeId, actionPayload, { actorAdminId }) {
  const {
    mode, approvedIntake, courseDuration, effectiveDate,
  } = actionPayload;
  if (mode === 'rename') {
    const { departmentId, name } = actionPayload;
    const department = await departmentRepository.renameDepartmentWithDetails(tenantClient, departmentId, {
      name, approvedIntake, courseDuration, effectiveDate,
    });
    if (department === null) {
      throw new StructuralKeyValidationError(`department ${JSON.stringify(departmentId)} no longer exists or was already merged away`);
    }
    await auditLogRepository.createAuditLogEntry(tenantClient, {
      collegeId, userId: null, action: 'department_renamed', entity: 'departments', entityId: department.id, metadata: { name, actorAdminId },
    });
    return department;
  }
  if (mode === 'merge') {
    const { sourceDepartmentIds, targetDepartmentId, name } = actionPayload;
    const target = await departmentRepository.mergeDepartments(tenantClient, {
      sourceDepartmentIds, targetDepartmentId, name, approvedIntake, courseDuration, effectiveDate,
    });
    if (target === null) {
      throw new StructuralKeyValidationError(`target department ${JSON.stringify(targetDepartmentId)} no longer exists`);
    }
    await auditLogRepository.createAuditLogEntry(tenantClient, {
      collegeId, userId: null, action: 'departments_merged', entity: 'departments', entityId: target.id, metadata: { sourceDepartmentIds, actorAdminId },
    });
    return target;
  }
  throw new StructuralKeyValidationError(`unknown department_merge_rename mode ${JSON.stringify(mode)}`);
}

// --- RS-GOV-005 structural-action wizard: the other 4 executors. ---
//
// Business decision behind all four (recorded here, not just in the
// frontend): the VALUES are entered and verified by Platform Admin at
// redemption time, not by the college's L1 at generation time. A
// college self-reporting its own NAAC grade or NBA validity with no
// independent check would let ARCNAVE display unverified — possibly
// false — accreditation facts to the public. The struct key still
// proves the college requested a change of this kind; it no longer
// carries the answer. This is a deliberate reversal of RS-GOV-006's
// original "named at generation time" framing for these fields —
// department merge/rename above is UNCHANGED (L1 already names the
// exact department + new name at generation; Platform Admin only
// executes it, since there's no equivalent falsifiable-claim risk).

async function executeL2Configuration(platformPool, collegeId, payload, { actorAdminId, ipAddress }) {
  const {
    l2Enabled, l3ReportsViaL2, l2PermittedModules, effectiveDate,
  } = payload;
  if (l2Enabled === undefined) {
    throw new StructuralKeyValidationError('l2Enabled is required');
  }
  // l2_duty_module is deliberately untouched here — it's an onboarding-
  // time field (OnboardingWizard.jsx), not part of this wizard's form;
  // omitting the key from this update (not even null) leaves whatever
  // value onboarding set alone, same "only touch what's present"
  // behavior updateStructuralFields already gives every other caller.
  const college = await platformRepository.updateStructuralFields(platformPool, collegeId, {
    l2Enabled,
    l3ReportsViaL2: l2Enabled ? (l3ReportsViaL2 ?? false) : false,
    l2PermittedModules: l2Enabled ? (l2PermittedModules ?? []) : [],
    l2EffectiveDate: effectiveDate,
  });
  if (college === null) throw new CollegeNotFoundError(`no college with college_id ${JSON.stringify(collegeId)}`);
  await platformAuditService.record(platformPool, {
    actorAdminId, action: 'college.l2_configuration_changed', entity: 'college', entityId: collegeId, ipAddress, metadata: payload,
  });
  return college;
}

async function executeAffiliationChange(platformPool, collegeId, payload, { actorAdminId, ipAddress }) {
  const { affiliatingUniversity, effectiveDate } = payload;
  if (!affiliatingUniversity) {
    throw new StructuralKeyValidationError('affiliatingUniversity is required');
  }
  const college = await platformRepository.updateStructuralFields(platformPool, collegeId, {
    affiliatingUniversity, affiliationEffectiveDate: effectiveDate,
  });
  if (college === null) throw new CollegeNotFoundError(`no college with college_id ${JSON.stringify(collegeId)}`);
  await platformAuditService.record(platformPool, {
    actorAdminId, action: 'college.affiliation_changed', entity: 'college', entityId: collegeId, ipAddress, metadata: payload,
  });
  return college;
}

async function executeAccreditationChange(platformPool, collegeId, payload, { actorAdminId, ipAddress }) {
  const {
    accreditingBody, naacCgpa, nbaPoints, nbaValidTill, effectiveDate,
  } = payload;
  if (accreditingBody !== 'NAAC' && accreditingBody !== 'NBA') {
    throw new StructuralKeyValidationError('accreditingBody must be "NAAC" or "NBA" — the only two with real tracked fields');
  }
  const fields = accreditingBody === 'NAAC'
    ? { naacAccredited: true, naacCgpa }
    : { nbaPoints, nbaValidTill };
  fields.accreditationEffectiveDate = effectiveDate;
  const college = await platformRepository.updateStructuralFields(platformPool, collegeId, fields);
  if (college === null) throw new CollegeNotFoundError(`no college with college_id ${JSON.stringify(collegeId)}`);
  await platformAuditService.record(platformPool, {
    actorAdminId, action: 'college.accreditation_changed', entity: 'college', entityId: collegeId, ipAddress, metadata: payload,
  });
  return college;
}

// Tenant-scoped (college_campuses has RLS, like departments) — runs
// against the same tenant transaction as executeDepartmentMergeOrRename.
async function executeAddCampus(tenantClient, collegeId, payload, { actorAdminId }) {
  const {
    name, city, campusType, effectiveDate,
  } = payload;
  if (!name) throw new StructuralKeyValidationError('campus name is required');
  const campus = await collegeCampusRepository.create(tenantClient, {
    collegeId, name, city, campusType, effectiveDate,
  });
  await auditLogRepository.createAuditLogEntry(tenantClient, {
    collegeId, userId: null, action: 'campus_added', entity: 'college_campuses', entityId: campus.id, metadata: { name, city, campusType, actorAdminId },
  });
  return campus;
}

// One redemption, up to 5 independent sections (RS-GOV-005's own
// wizard shape) — each optional; only the ones present in `sections`
// get applied. Not a single all-or-nothing transaction: l2Config/
// affiliation/accreditation write platformPool (colleges table),
// department/campus write the tenant pool (departments/
// college_campuses) — two separate connections/roles by design
// (ADR-010), so true cross-pool atomicity isn't available. Sections
// are applied in a fixed order and the first failure stops the rest;
// whatever already committed to its own pool stays committed (a real,
// documented limitation, not silently glossed over) — the caller
// (routes/platform.js) only marks the key redeemed if every requested
// section in this call succeeded.
async function executeStructuralActions(tenantClient, platformPool, collegeId, sections, { actorAdminId, ipAddress }) {
  const results = {};
  if (sections.l2Config) {
    results.l2Config = await executeL2Configuration(platformPool, collegeId, sections.l2Config, { actorAdminId, ipAddress });
  }
  if (sections.affiliation) {
    results.affiliation = await executeAffiliationChange(platformPool, collegeId, sections.affiliation, { actorAdminId, ipAddress });
  }
  if (sections.accreditation) {
    results.accreditation = await executeAccreditationChange(platformPool, collegeId, sections.accreditation, { actorAdminId, ipAddress });
  }
  if (sections.campus) {
    results.campus = await executeAddCampus(tenantClient, collegeId, sections.campus, { actorAdminId });
  }
  if (sections.department) {
    results.department = await executeDepartmentMergeOrRename(tenantClient, collegeId, sections.department, { actorAdminId });
  }
  return results;
}

module.exports = {
  PlatformAuthError,
  PlatformAdminValidationError,
  PlatformAlreadyBootstrappedError,
  DuplicateCollegeError,
  CollegeNotFoundError,
  InvalidLicenseError,
  CollegeUpdateNotFoundError,
  PrincipalInvitationNotFoundError,
  PrincipalInvitationNotPendingError,
  PrincipalInviteVerificationNotFoundError,
  PrincipalInviteVerificationMaxAttemptsError,
  PrincipalInviteVerificationCodeMismatchError,
  bootstrapPlatformAdmin,
  login,
  createCollege,
  updateCollege,
  invitePrincipal,
  sendPrincipalInviteVerificationCode,
  verifyPrincipalInviteCode,
  sendWizardEmailVerificationCode,
  verifyWizardEmailCode,
  resendPrincipalInvitation,
  revokePrincipalInvitation,
  listColleges,
  listInvitations,
  getInvitationsSummary,
  listAuditLogs,
  getSettings,
  updateSettings,
  getDashboardSummary,
  getOrganizationsSummary,
  ProvisioningTransitionError,
  ReadinessGateNotSatisfiedError,
  OnboardingDepartmentNotAllowedError,
  StructuralKeyValidationError,
  StructuralKeyNotFoundError,
  StructuralKeyNotUsableError,
  StructuralKeyActionMismatchError,
  createDepartmentAtOnboarding,
  createTemplateAtOnboarding,
  markCollegeReady,
  cancelOnboarding,
  checkReadinessGate,
  activateCollege,
  suspendCollege,
  reactivateCollege,
  archiveCollege,
  restoreCollege,
  generateStructuralAuthorizationKey,
  cancelStructuralAuthorizationKey,
  loadRedeemableStructuralKey,
  markStructuralKeyRedeemed,
  executeDepartmentMergeOrRename,
  executeStructuralActions,
};
