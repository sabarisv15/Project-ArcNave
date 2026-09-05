'use strict';

// NotificationService (Module 8). Composes WorkflowService (approval)
// + external Email/SMS/WhatsApp providers, per Architecture.md 2.5.
// Two generations of behavior now coexist here, on purpose:
//
// 1. sendEmail/sendStaffCredentialsEmail — the original minimal slice.
//    UNCHANGED by this extension. sendStaffCredentialsEmail's only
//    caller (staffService.approveStaffRegistration) fires as the
//    direct, deterministic consequence of a real human approval
//    WorkflowService already recorded (the Principal's own final
//    sign-off on the registration chain) — there is no free-form or
//    AI-drafted content in that path for the new ledger below to gate,
//    so it is deliberately NOT retrofitted into it. Still send-first
//    (never a Draft row), still best-effort (a failed send never
//    throws, never rolls back the staff activation that triggered it).
//
// 2. draftNotification/submitForApproval/approveNotification/
//    rejectNotification/dispatchApprovedNotification — the real
//    `notifications`/`notification_delivery` ledger this file's
//    original comment flagged as a future gap (Architecture.md 2.8):
//    "every outbound notification is a row before it's sent... draft
//    -> approved -> dispatched." This is the path any FUTURE caller
//    with actual discretionary content (an AI-drafted announcement, a
//    bulk SMS blast, anything not already gated by a completed
//    approval) MUST use — never sendEmail directly. `notifications`
//    has no schema-level 'Pending' status (unlike workflow_requests):
//    "awaiting approval" lives entirely on the workflow_requests row a
//    Draft is submitted against (via workflow_request_id), so the two
//    tables can't drift out of sync on what counts as pending.
//    approveNotification/rejectNotification mirror
//    financeService.approveFeeStructure/rejectFeeStructure exactly —
//    status only ever moves off 'Draft' as the real consequence of
//    workflowService.approveRequest/rejectRequest actually resolving,
//    never a direct caller-supplied status write.
//
// Three real channels: email/sms/whatsapp, each via a per-vendor
// adapter under notificationProviders/ (PROVIDER_REGISTRY below) — no
// nodemailer/Twilio/HTTP calls of this file's own anymore (item 2/4 of
// this session's task). The legacy sendEmail path (staff credentials,
// password reset, principal invitation) still uses the global
// config.smtp fallback via smtpProvider; the ledger path
// (dispatchApprovedNotification) and Send Alert (item 5) resolve a
// per-college provider from college_notification_channels via
// genericSend/resolveChannelProvider. No SMTP_HOST/channel row
// configured is the expected default in dev/test: sending logs the
// message instead of attempting to send. A configured-but-failing send
// is also never fatal — delivery is recorded as failed (a real
// notification_delivery row for the ledger path, still just a log line
// for the legacy sendStaffCredentialsEmail path), not thrown, so a
// transient delivery problem never blocks the caller.
// dispatchApprovedNotification applies that same "best-effort, never
// undo the approval" philosophy to the ledger: it always advances a
// notification to 'Dispatched' after attempting delivery, recording
// whatever genericSend actually returned ('sent'/'stubbed'/'failed') in
// notification_delivery rather than blocking the status transition on
// send success — a failed send is a fact to record/retry later, not a
// reason to leave the already-approved notification stuck.

const config = require('../config');
const cryptoUtil = require('../cryptoUtil');
const { logInfo, logWarn } = require('../logging/logger');
const { appPool } = require('../db/pool');
const notificationRepository = require('../repositories/notificationRepository');
const notificationChannelRepository = require('../repositories/notificationChannelRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const workflowService = require('./workflowService');
const workflowChainService = require('./workflowChainService');
const smtpProvider = require('./notificationProviders/email/smtp');

// channel -> { providerName -> adapter module }. This is the ONLY
// place a vendor name is ever written in this file (item 2/4 of this
// session's task: "no hardcoded vendor references remain in
// NotificationService"). fcm/telegram are deliberately absent — valid
// college_notification_channels.channel values with no adapter file
// yet (see that migration's own comment); resolveChannelProvider below
// throws NotificationChannelNotImplementedError, not a silent stub, if
// a college enables one, per this session's task.
const PROVIDER_REGISTRY = {
  email: { smtp: smtpProvider },
  sms: { msg91: require('./notificationProviders/sms/msg91') },
  whatsapp: { meta: require('./notificationProviders/whatsapp/meta') },
};

// The only channel values college_notification_channels.channel is
// ever expected to hold (no DB CHECK constraint — see that migration's
// own comment). Checked BEFORE any repository call, so a garbage
// channel value fails the same visible way an unrecognized value
// always has here, rather than silently falling through to the
// "unconfigured, stub" path a real-but-not-yet-adapted channel
// (fcm/telegram) is allowed to take.
const KNOWN_CHANNELS = ['email', 'sms', 'whatsapp', 'fcm', 'telegram'];
// staffService.js itself requires notificationService.js (for
// sendStaffCredentialsEmail); this file no longer requires staffService
// at all (submitForApproval's principal lookup moved onto
// workflowChainService.resolveApproverChain), so the circular-require
// hazard that used to require deferring a staffService require to
// inside submitForApproval no longer applies here.

// Missing to/subject/body — the three things any email needs. Raised
// before touching nodemailer at all, same "guard first" shape every
// other service in this codebase uses. Also raised by draftNotification/
// submitForApproval given missing required fields — same class, same
// "guard before any work" reasoning, just a different set of required
// fields per caller.
class NotificationValidationError extends Error {}

// draftNotification/submitForApproval/approveNotification/
// rejectNotification/dispatchApprovedNotification given an id with no
// matching row — a required lookup, not an optional fetch, same
// precedent workflowService.WorkflowRequestNotFoundError/
// financeService.FeeStructureNotFoundError already set.
class NotificationNotFoundError extends Error {}

// notifications_drafted_by_user_id_fkey violated (Postgres 23503) —
// the given actorUserId doesn't exist.
class NotificationUserNotFoundError extends Error {}

// approveNotification/rejectNotification called for a notification
// with no live Pending workflow_requests row (never submitted for
// approval, or already resolved) — mirrors
// financeService.FeeStructureNoPendingRequestError exactly.
class NotificationNoPendingRequestError extends Error {}

// dispatchApprovedNotification called for a notification whose status
// isn't 'Approved' — still 'Draft' (never submitted, or submitted but
// not yet approved), already 'Dispatched' (blocks a double-send), or
// 'Rejected'. One check, one error class, regardless of which of those
// it actually is — a caller only needs to know "this isn't ready to
// dispatch," same reasoning workflowService.WorkflowRequestAlreadyResolvedError
// collapses "Approved" and "Rejected" into one rejection rather than
// enumerating every non-Pending status separately.
class NotificationNotApprovedError extends Error {}

// dispatchApprovedNotification called for a notification whose channel
// isn't in KNOWN_CHANNELS at all, or is a known channel with no
// adapter file for the college's configured provider (fcm/telegram —
// see PROVIDER_REGISTRY's own comment), since notifications.channel
// has no CHECK constraint enforcing a known set at the DB level — see
// the migration's own comment). Thrown BEFORE any send attempt or
// repository write, never swallowed into a fake 'sent'/'stubbed'
// delivery row the way a real channel's best-effort philosophy works:
// there is no sender at all to have attempted anything with. The
// notification stays 'Approved' (never advances to 'Dispatched') — the
// same "leave it retriable, don't silently mark done" reasoning a
// failed real send already gets.
class NotificationChannelNotImplementedError extends Error {}

// The one primitive this file offers: send a plain-text email, or log
// it as a stub if no SMTP provider is configured. Returns a status
// object rather than throwing on delivery failure — see the file-level
// comment for why. `client` (a DB transaction handle, unused here) is
// still the first parameter, matching every other service function in
// this codebase, even though this minimal version has no repository to
// call it with: a future slice adding the real notifications ledger
// (Architecture.md 2.8) needs it there without changing every call
// site that already threads it through.
//
// Always uses the global config.smtp fallback, via smtpProvider — this
// legacy path (staff credentials, password reset, principal invitation)
// has no per-college channel row to resolve against (no collegeId is
// even reliably available at every call site — see
// sendPrincipalInvitationEmail's own comment), so it deliberately does
// NOT go through resolveChannelProvider/college_notification_channels.
// The nodemailer call itself lives in notificationProviders/email/smtp.js,
// not here — this file has no vendor-specific code left at all (item 4
// of this session's task).
// eslint-disable-next-line no-unused-vars
async function sendEmail(client, { to, subject, body }) {
  if (!to || !subject || !body) {
    throw new NotificationValidationError('to, subject, and body are required');
  }

  const result = await smtpProvider.send(to, body, { subject });
  if (result.status === 'stubbed') {
    logWarn('notification_email_stubbed', { to, subject });
  } else if (result.status === 'sent') {
    logInfo('notification_email_sent', { to, subject });
  } else {
    logWarn('notification_email_failed', { to, subject, error: result.error });
  }
  return { channel: 'email', status: result.status, to, subject, error: result.error };
}

// college_notification_channels row -> decrypted plain credentials
// object. `config` is always stored as { encrypted: <base64> } (see
// the migration's own comment) — never plaintext at rest, reusing
// cryptoUtil's AES-256-GCM helper per this session's own task
// (encrypt any provider credentials in config jsonb at rest). No
// config row / null config means no credentials — an empty object, not
// an error, so a caller can still reach the adapter's own "not
// configured, stub" branch.
function decryptChannelConfig(row) {
  if (!row || !row.config || !row.config.encrypted) {
    return {};
  }
  return JSON.parse(cryptoUtil.decryptSecret(row.config.encrypted));
}

// Resolves { collegeId, channel } to a live channel_notification row +
// its adapter module, throwing NotificationChannelNotImplementedError
// if the channel/provider pair has no adapter file (this session's own
// requirement for fcm/telegram: "resolver must fail clearly, not
// silently"). Returns null (not a throw) when the college simply
// hasn't configured/enabled this channel yet — genericSend treats that
// as the existing "unconfigured, stub" case, unchanged behavior from
// before per-college config existed.
async function resolveChannelProvider(client, collegeId, channel) {
  const row = await notificationChannelRepository.findByCollegeAndChannel(client, collegeId, channel);
  if (!row || !row.enabled) {
    return null;
  }

  const adapter = PROVIDER_REGISTRY[channel] && PROVIDER_REGISTRY[channel][row.provider];
  if (!adapter) {
    throw new NotificationChannelNotImplementedError(
      `channel ${JSON.stringify(channel)} provider ${JSON.stringify(row.provider)} has no adapter implementation`,
    );
  }

  return { adapter, credentials: decryptChannelConfig(row) };
}

// The generic, vendor-neutral send this file now uses for every
// channel driven by college_notification_channels (dispatchApprovedNotification
// below, and classService's Send Alert path — item 5 of this session's
// task). Resolves the college's configured provider, delegates the
// actual send to that adapter's own send(to, body, opts), and always
// returns a status object rather than throwing on delivery failure —
// same best-effort philosophy every channel here already followed
// under the old hardcoded Twilio calls. `channel` must be one of
// KNOWN_CHANNELS — checked before any repository call, same "guard
// before any work" reasoning every other validation in this file uses.
async function genericSend(client, { collegeId, channel, to, body, subject }) {
  if (!to || !body) {
    throw new NotificationValidationError('to and body are required');
  }
  if (!KNOWN_CHANNELS.includes(channel)) {
    throw new NotificationChannelNotImplementedError(`channel ${JSON.stringify(channel)} is not a known value`);
  }

  const resolved = await resolveChannelProvider(client, collegeId, channel);
  if (resolved === null) {
    logWarn(`notification_${channel}_stubbed`, { to });
    return { channel, status: 'stubbed', to, body };
  }

  try {
    const result = await resolved.adapter.send(to, body, { subject, credentials: resolved.credentials });
    if (result.status === 'sent') {
      logInfo(`notification_${channel}_sent`, { to, providerId: result.providerId });
    } else {
      logWarn(`notification_${channel}_failed`, { to, error: result.error });
    }
    return {
      channel,
      status: result.status,
      to,
      body,
      providerId: result.providerId,
      error: result.error,
    };
  } catch (err) {
    logWarn(`notification_${channel}_failed`, { to, error: err.message });
    return {
      channel,
      status: 'failed',
      to,
      body,
      error: err.message,
    };
  }
}

// The one composed notification this slice actually needs:
// BusinessRules.md's Staff registration chain, "credentials are
// emailed" — plainPassword is the exact, one-time value
// authService.activateUser just generated; nothing here stores it
// again, and the caller must not either.
async function sendStaffCredentialsEmail(client, { to, username, password, staffCode }) {
  const subject = 'Your ARCNAVE staff account is now active';
  const body = [
    'Your staff registration has been approved.',
    `Staff ID: ${staffCode}`,
    `Username: ${username}`,
    `Temporary password: ${password}`,
    '',
    'Please log in and change your password as soon as possible.',
  ].join('\n');

  return sendEmail(client, { to, subject, body });
}

// This session's own task: password reset must go out through the
// existing notification flow, never in an API response. Same
// send-first, best-effort, non-ledger treatment as
// sendStaffCredentialsEmail above — a deterministic consequence of a
// real user action (their own reset request), no discretionary
// content for the ledger to gate.
async function sendPasswordResetEmail(client, { to, token }) {
  const subject = 'Reset your ARCNAVE password';
  const body = [
    'A password reset was requested for your ARCNAVE account.',
    `Reset token: ${token}`,
    '',
    'If you did not request this, you can safely ignore this email.',
  ].join('\n');

  return sendEmail(client, { to, subject, body });
}

// Business rule task #19 (institution-configurable MFA): the second-
// factor code itself must go out through the existing notification
// flow, never in an API response or a log line — same send-first,
// best-effort, non-ledger treatment as sendPasswordResetEmail above (a
// deterministic consequence of the user's own login attempt, no
// discretionary content for the ledger to gate).
async function sendMfaCodeEmail(client, { to, code, expireMinutes }) {
  const subject = 'Your ARCNAVE verification code';
  const body = [
    `Your ARCNAVE sign-in verification code is ${code}.`,
    `It expires in ${expireMinutes} minutes.`,
    '',
    'If you did not attempt to sign in, you can safely ignore this email.',
  ].join('\n');

  return sendEmail(client, { to, subject, body });
}

// This session's own task: principal invitation must go out through
// the existing notification flow, never in an API response. Same
// treatment as sendPasswordResetEmail above — the platform admin's own
// invite action is the deterministic trigger, not free-form/discretionary
// content. `client` here is realistically platformPool, not a tenant
// transaction (invitePrincipal has no tenant to scope one to yet — the
// college being invited into has no principal at all until this
// invitation is accepted) — harmless, since sendEmail never actually
// uses its own client parameter either (see that function's comment).
async function sendPrincipalInvitationEmail(client, { to, collegeId, token, expiresAt }) {
  const subject = `You've been invited to set up ARCNAVE for ${collegeId}`;
  const body = [
    `You have been invited to become the Principal administrator for college "${collegeId}" on ARCNAVE.`,
    `Invitation token: ${token}`,
    `This invitation expires at ${expiresAt.toISOString()}.`,
    '',
    'Use this token with POST /api/v1/invitations/accept to finish setting up your account.',
  ].join('\n');

  return sendEmail(client, { to, subject, body });
}

// Phase 2 (Position Account Auth) — the invite-based credential
// bootstrap for a Position Account (L1/L2/L3 today), same "never
// return the raw token in an API response, only ever email it" rule
// as sendPrincipalInvitationEmail above. `client` here can be either a
// tenant transaction (a Level 2 actor inviting an HOD) or platformPool
// (a Platform Admin inviting Level 1/2) — harmless for the same reason
// sendPrincipalInvitationEmail's own comment gives: sendEmail never
// actually uses its own client parameter.
async function sendPositionAccountInvitationEmail(client, { to, collegeId, positionTitle, token, expiresAt }) {
  const subject = `You've been invited to the ${positionTitle} office account for ${collegeId}`;
  const body = [
    `You have been invited to set up login credentials for the "${positionTitle}" institutional office account at college "${collegeId}" on ARCNAVE.`,
    `Invitation token: ${token}`,
    `This invitation expires at ${expiresAt.toISOString()}.`,
    '',
    'Use this token with POST /api/v1/position-accounts/invitations/accept to finish setting up this office account.',
  ].join('\n');

  return sendEmail(client, { to, subject, body });
}

// RS-STF-001 (D10) — the invite-based bootstrap for a plain staff hire
// (a distinct, person-centric account, never a Position Account — see
// RS-STF-010), same "never return the raw token in an API response,
// only ever email it" rule as sendPrincipalInvitationEmail above.
async function sendStaffInvitationEmail(client, { to, collegeId, token, expiresAt }) {
  const subject = `You've been invited to join ARCNAVE staff at ${collegeId}`;
  const body = [
    `You have been invited to join college "${collegeId}" on ARCNAVE as a staff member.`,
    `Invitation token: ${token}`,
    `This invitation expires at ${expiresAt.toISOString()}.`,
    '',
    'Use this token with POST /api/v1/staff/invitations/accept to finish setting up your account.',
  ].join('\n');

  return sendEmail(client, { to, subject, body });
}

// origin has no DB CHECK constraint (see the migration's own file-level
// comment) — known values ('human'|'ai') enforced here, same house
// convention workflowService.assertValidOrigin already uses for the
// identical column on workflow_requests.
const VALID_ORIGINS = ['human', 'ai'];

function assertValidOrigin(origin) {
  if (!VALID_ORIGINS.includes(origin)) {
    throw new NotificationValidationError(`origin ${JSON.stringify(origin)} is not a known value`);
  }
}

// Phase 4 frontend blueprint's ambient/waiting split (see the
// notification-kind migration's own comment) — 'waiting' is the
// default because a fresh Draft always needs the drafter to submit it.
const VALID_KINDS = ['ambient', 'waiting'];

function assertValidKind(kind) {
  if (!VALID_KINDS.includes(kind)) {
    throw new NotificationValidationError(`kind ${JSON.stringify(kind)} is not a known value`);
  }
}

// Creates a Draft row — no send, no approval request yet. subject is
// optional (not every future channel has one; email always supplies
// it in practice, but this function doesn't require it — see the
// migration's own file-level comment).
async function draftNotification(
  client,
  { collegeId, channel, toAddress, subject, body, origin = 'human', kind = 'waiting' },
  { actorUserId } = {},
) {
  if (!collegeId || !channel || !toAddress || !body || !actorUserId) {
    throw new NotificationValidationError('collegeId, channel, toAddress, body, and actorUserId are required');
  }
  assertValidOrigin(origin);
  assertValidKind(kind);

  let notification;
  try {
    notification = await notificationRepository.create(client, {
      collegeId,
      channel,
      toAddress,
      subject: subject || null,
      body,
      status: 'Draft',
      origin,
      kind,
      draftedByUserId: actorUserId,
    });
  } catch (err) {
    if (err.code === '23503' && err.constraint === 'notifications_drafted_by_user_id_fkey') {
      throw new NotificationUserNotFoundError(`actorUserId ${JSON.stringify(actorUserId)} does not exist`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'notification_drafted',
    entity: 'notifications',
    entityId: notification.id,
    metadata: null,
  });

  return notification;
}

// Submits an existing Draft for approval — resolves its approver chain
// via workflowChainService.resolveApproverChain (entityType
// 'notification', default a single-step Principal-only chain: nothing
// in BusinessRules.md scopes a notification to one department, so
// there is no HOD to resolve here either), then stores the resulting
// workflow_requests id back onto the notification. An institution can
// now configure this chain like every other one, instead of the
// hardcoded `[{ role: 'principal', ... }]` array this function used to
// build itself. Reuses the notification's OWN already-stored origin
// rather than accepting a second one — the two must always agree, so
// there is only ever one place origin is supplied.
//
// actionManifest is optional and simply forwarded to
// workflowService.submitRequest — this function has no opinion about
// its shape or contents (aiToolRegistry.js's request_notification_send
// handler is the one real caller that supplies one; the human REST
// route, routes/notifications.js, never does). Same "thin passthrough,
// not a second source of truth" reasoning this file already applies
// everywhere else.
async function submitForApproval(client, notificationId, { requestedByUserId, actionManifest } = {}) {
  if (!requestedByUserId) {
    throw new NotificationValidationError('requestedByUserId is required');
  }

  const notification = await notificationRepository.findById(client, notificationId);
  if (notification === null) {
    throw new NotificationNotFoundError(`notification ${JSON.stringify(notificationId)} does not exist`);
  }

  const approverChain = await workflowChainService.resolveApproverChain(client, {
    collegeId: notification.college_id,
    entityType: 'notification',
  });

  const request = await workflowService.submitRequest(client, {
    collegeId: notification.college_id,
    entityType: 'notification',
    entityId: notification.id,
    requestedByUserId,
    origin: notification.origin,
    approverChain,
    actionManifest,
  });

  return notificationRepository.update(client, notificationId, { workflowRequestId: request.id });
}

// Shared load+validate for approveNotification/rejectNotification: the
// notification must exist, and exactly one live Pending workflow_requests
// row must govern it — same shape financeService.loadPendingFeeStructureApproval
// already established.
async function loadPendingNotificationApproval(client, notificationId) {
  const notification = await notificationRepository.findById(client, notificationId);
  if (notification === null) {
    throw new NotificationNotFoundError(`notification ${JSON.stringify(notificationId)} does not exist`);
  }

  const pending = await workflowService.findPendingForEntity(client, 'notification', notificationId);
  if (pending === null) {
    throw new NotificationNoPendingRequestError(
      `notification ${JSON.stringify(notificationId)} has no pending approval request`,
    );
  }

  return { notification, pending };
}

// status only ever moves to 'Approved' as a consequence of a real
// workflowService.approveRequest resolution (ADR-005's self-approval
// rule, wrong-actor/wrong-step rejection, etc. all apply here exactly
// as they do for fee_structures) — never from a bare caller-supplied
// field. A single-step chain always resolves on this one call, same
// reasoning financeService.approveFeeStructure already gives for
// skipping a "still mid-chain" branch.
async function approveNotification(client, notificationId, { actorUserId, remarks } = {}) {
  const { pending } = await loadPendingNotificationApproval(client, notificationId);
  await workflowService.approveRequest(client, pending.id, { actorUserId, remarks });

  const notification = await notificationRepository.update(client, notificationId, { status: 'Approved' });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: notification.college_id,
    userId: actorUserId,
    action: 'notification_approved',
    entity: 'notifications',
    entityId: notificationId,
    metadata: null,
  });

  return notification;
}

async function rejectNotification(client, notificationId, { actorUserId, remarks } = {}) {
  const { pending } = await loadPendingNotificationApproval(client, notificationId);
  await workflowService.rejectRequest(client, pending.id, { actorUserId, remarks });

  const notification = await notificationRepository.update(client, notificationId, { status: 'Rejected' });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: notification.college_id,
    userId: actorUserId,
    action: 'notification_rejected',
    entity: 'notifications',
    entityId: notificationId,
    metadata: null,
  });

  return notification;
}

// Only callable once a notification is actually 'Approved'. Routes
// through genericSend, which resolves the notification's OWN college's
// configured provider for its channel (college_notification_channels —
// item 4 of this session's task: no more hardcoded Twilio/nodemailer
// calls here) — email/sms/whatsapp/fcm/telegram all now share the
// exact same best-effort philosophy: always attempt, always record
// whatever the send returned ('sent'/'stubbed'/'failed'), always
// advance to 'Dispatched' regardless of outcome (same reasoning
// sendStaffCredentialsEmail's own caller already relies on for email).
// Only a genuinely unrecognized channel, or a known channel enabled
// for this college with no adapter file (fcm/telegram), still throws
// NotificationChannelNotImplementedError BEFORE any
// notification_delivery row is written or status changes — genericSend
// raises it synchronously, before its own try/catch, so it always
// propagates rather than being recorded as a 'failed' delivery: there
// is no real sender to have attempted anything with.
async function dispatchApprovedNotification(client, notificationId) {
  const notification = await notificationRepository.findById(client, notificationId);
  if (notification === null) {
    throw new NotificationNotFoundError(`notification ${JSON.stringify(notificationId)} does not exist`);
  }
  if (notification.status !== 'Approved') {
    throw new NotificationNotApprovedError(
      `notification ${JSON.stringify(notificationId)} is ${JSON.stringify(notification.status)}, not Approved`,
    );
  }

  const sendResult = await genericSend(client, {
    collegeId: notification.college_id,
    channel: notification.channel,
    to: notification.to_address,
    subject: notification.subject,
    body: notification.body,
  });

  const delivery = await notificationRepository.recordDeliveryAttempt(client, {
    collegeId: notification.college_id,
    notificationId: notification.id,
    status: sendResult.status,
    error: sendResult.error || null,
  });

  const updated = await notificationRepository.update(client, notificationId, { status: 'Dispatched' });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: notification.college_id,
    userId: notification.drafted_by_user_id,
    action: 'notification_dispatched',
    entity: 'notifications',
    entityId: notificationId,
    metadata: { deliveryStatus: sendResult.status },
  });

  return { notification: updated, delivery };
}

// Thin passthrough to notificationRepository.list — the human-facing
// route this ledger never had (draft/submit/approve/reject/dispatch
// all existed; nothing to look at them with). Same "thin wrapper,
// concrete known consumer" reasoning attendanceService.
// listAttendanceSessionsForClassAndDate gives for its own passthrough,
// not speculative — routes/notifications.js is the real, immediate
// caller.
async function listNotifications(client, { limit, offset } = {}) {
  return notificationRepository.list(client, { limit, offset });
}

// P4 (5.4) — backs the live-events stream (routes/notifications.js's
// /notifications/stream). A poll tick calls this once per tick for the
// lifetime of a long-running SSE connection, so — same reasoning
// backgroundJobService.findFresh already gives — it deliberately does NOT
// reuse the request's own req.dbClient across that whole span: holding
// one connection idle for minutes starves the pool (the exact P0
// TenantConnection.pauseForExternalCall problem, this time for a
// long-lived read loop instead of an outbound LLM call). Same
// short-lived-connection-per-call shape as findFresh: open, set tenant
// context, query, release — inside an EXPLICIT transaction. `set_config`'s
// third argument (`true`) means LOCAL/transaction-scoped; without a real
// BEGIN, each bare `.query()` call is its own separate implicit
// transaction, so the tenant setting is already gone by the time the
// actual SELECT runs and RLS silently hides every row (a real bug this
// function shipped with — caught live, not by inspection: a committed
// row's own `updated_at` verified > `since` via a direct psql session,
// yet this still returned 0 rows, until BEGIN/COMMIT were added).
async function listUpdatedSinceFresh(collegeId, since) {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    const rows = await notificationRepository.listUpdatedSince(client, { since });
    await client.query('COMMIT');
    return rows;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  NotificationValidationError,
  NotificationNotFoundError,
  NotificationUserNotFoundError,
  NotificationNoPendingRequestError,
  NotificationNotApprovedError,
  NotificationChannelNotImplementedError,
  sendEmail,
  sendStaffCredentialsEmail,
  sendPasswordResetEmail,
  sendMfaCodeEmail,
  sendPrincipalInvitationEmail,
  sendPositionAccountInvitationEmail,
  sendStaffInvitationEmail,
  draftNotification,
  submitForApproval,
  approveNotification,
  rejectNotification,
  dispatchApprovedNotification,
  listNotifications,
  listUpdatedSinceFresh,
  // Exported for callers with their own vendor-neutral, per-college
  // send need outside the approval ledger — currently classService's
  // Send Alert path (item 5 of this session's task), which is
  // documented as NOT routed through WorkflowService (own-class-only,
  // human-sent, plain text, no AI — see BusinessRules.md/AI-Governance.md).
  // Same resolver, same best-effort semantics as dispatchApprovedNotification
  // uses internally, just without a notifications ledger row.
  sendViaChannel: genericSend,
};
