'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requirePlatformAdmin } = require('../middleware/platformAuth');
const platformService = require('../services/platformService');
const platformAuditService = require('../services/platformAuditService');
const positionAccountInvitationService = require('../services/positionAccountInvitationService');
const academicService = require('../services/academicService');
const departmentRepository = require('../repositories/departmentRepository');
const { platformPool } = require('../db/pool');
const { openTenantTransaction } = require('../db/tenantTransaction');

function createPlatformRouter() {
  const router = express.Router();

  // Deliberately unauthenticated, like /invitations/accept on the
  // tenant side — there is no admin yet to gate this behind. Stays
  // safe because platformService.bootstrapPlatformAdmin can only ever
  // succeed once (a real DB-level atomic guard, not a check-then-insert
  // this route could race); every call after the first is a clean 409.
  router.post('/bootstrap', asyncHandler(async (req, res) => {
    const { username, email, password } = req.body || {};
    try {
      const admin = await platformService.bootstrapPlatformAdmin(platformPool, { username, email, password });
      res.status(201).json({ id: admin.id, username: admin.username, email: admin.email });
    } catch (err) {
      if (err instanceof platformService.PlatformAdminValidationError) {
        res.status(400).json({ detail: err.message });
        return;
      }
      if (err instanceof platformService.PlatformAlreadyBootstrappedError) {
        res.status(409).json({ detail: err.message });
        return;
      }
      throw err;
    }
  }));

  // No refresh token issued — checked against the deleted Python
  // version rather than assumed: it didn't build refresh rotation for
  // platform admins either (Module-00-Platform.md's Known
  // Limitations documents this as a deliberate scope cut, not
  // something this pass is re-deciding). Platform admins simply
  // re-authenticate when their access token expires.
  router.post('/auth/login', asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    try {
      const token = await platformService.login(platformPool, { username, password });
      res.json({ access_token: token.accessToken, token_type: token.tokenType });
    } catch (err) {
      if (err instanceof platformService.PlatformAuthError) {
        res.status(401).json({ detail: 'Invalid username or password' });
        return;
      }
      throw err;
    }
  }));

  function serializeCollege(college) {
    return {
      college_id: college.college_id,
      name: college.name,
      subdomain: college.subdomain,
      subscription_status: college.subscription_status,
      level1_position_title: college.level1_position_title,
      level3_position_title: college.level3_position_title,
      level4_position_title: college.level4_position_title,
      storage_tier: college.storage_tier,
      aicte_id: college.aicte_id,
      college_type: college.college_type,
      institution_type: college.institution_type,
      disclosure_link: college.disclosure_link,
      aishe_code: college.aishe_code,
      nba_points: college.nba_points,
      nba_valid_till: college.nba_valid_till,
      women_institution: college.women_institution,
      naac_accredited: college.naac_accredited,
      naac_cgpa: college.naac_cgpa,
      inst_mobile: college.inst_mobile,
      inst_email: college.inst_email,
      inst_website: college.inst_website,
      logo_file_name: college.logo_file_name,
      level2_position_title: college.level2_position_title,
      l2_enabled: college.l2_enabled,
      l3_reports_via_l2: college.l3_reports_via_l2,
      l2_duty_module: college.l2_duty_module,
      year_established: college.year_established,
      address: college.address,
    };
  }

  router.post('/colleges', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const {
      college_id: collegeId, name, subdomain,
      level1_position_title: level1PositionTitle, level3_position_title: level3PositionTitle,
      level4_position_title: level4PositionTitle,
      storage_tier: storageTier, subscription_status: subscriptionStatus,
      principal_email: principalEmail,
      principal_full_name: principalFullName, principal_designation: principalDesignation,
      principal_phone: principalPhone, principal_address: principalAddress,
      aicte_id: aicteId, college_type: collegeType, institution_type: institutionType,
      disclosure_link: disclosureLink, aishe_code: aisheCode, nba_points: nbaPoints,
      nba_valid_till: nbaValidTill, women_institution: womenInstitution,
      naac_accredited: naacAccredited, naac_cgpa: naacCgpa, inst_mobile: instMobile,
      inst_email: instEmail, inst_website: instWebsite, logo_file_name: logoFileName,
      level2_position_title: level2PositionTitle, l2_enabled: l2Enabled,
      l3_reports_via_l2: l3ReportsViaL2, l2_duty_module: l2DutyModule,
      year_established: yearEstablished, address,
    } = req.body || {};
    try {
      const { college, invitation } = await platformService.createCollege(platformPool, {
        collegeId,
        name,
        subdomain,
        createdBy: req.platformClaims.sub,
        ipAddress: req.ip,
        level1PositionTitle,
        level3PositionTitle,
        level4PositionTitle,
        storageTier,
        subscriptionStatus,
        principalEmail,
        principalFullName,
        principalDesignation,
        principalPhone,
        principalAddress,
        aicteId,
        collegeType,
        institutionType,
        disclosureLink,
        aisheCode,
        nbaPoints,
        nbaValidTill,
        womenInstitution,
        naacAccredited,
        naacCgpa,
        instMobile,
        instEmail,
        instWebsite,
        logoFileName,
        level2PositionTitle,
        l2Enabled,
        l3ReportsViaL2,
        l2DutyModule,
        yearEstablished,
        address,
      });
      res.status(201).json({
        ...serializeCollege(college),
        invitation: invitation ? { invitation_id: invitation.invitationId, email: invitation.email, expires_at: invitation.expiresAt } : null,
      });
    } catch (err) {
      if (err instanceof platformService.DuplicateCollegeError) {
        res.status(409).json({ detail: 'college_id or subdomain already exists' });
        return;
      }
      if (err instanceof platformService.InvalidLicenseError) {
        res.status(400).json({ detail: err.message });
        return;
      }
      throw err;
    }
  }));

  // Create/Edit College customization — no PATCH on college_id/subdomain
  // (see platformRepository.updateCollege's own comment on why those
  // stay immutable). Stage 8a / D13 / RS-GOV-013: name/level1-and-3
  // position titles/storage tier are no longer accepted here — a
  // Platform Admin editing those now belongs on the tenant side
  // (Institution Settings, principal-only). Only license
  // (subscription_status) remains.
  router.patch('/colleges/:college_id', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const { subscription_status: subscriptionStatus } = req.body || {};
    try {
      const college = await platformService.updateCollege(platformPool, req.params.college_id, {
        subscriptionStatus,
        actorAdminId: req.platformClaims.sub,
        ipAddress: req.ip,
      });
      res.json(serializeCollege(college));
    } catch (err) {
      if (err instanceof platformService.CollegeUpdateNotFoundError) {
        res.status(404).json({ detail: err.message });
        return;
      }
      if (err instanceof platformService.InvalidLicenseError) {
        res.status(400).json({ detail: err.message });
        return;
      }
      throw err;
    }
  }));

  // Organizations screen — UI copy says "Organizations", the
  // underlying model/route stays `colleges` (no rename).
  router.get('/colleges', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const { limit, offset, search } = req.query;
    const colleges = await platformService.listColleges(platformPool, {
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
      search,
    });
    res.json(colleges);
  }));

  // No `token` field in the response — this session's own task
  // instruction: an invitation token is delivered only via email
  // (notificationService.sendPrincipalInvitationEmail), never returned
  // in a normal API response.
  router.post('/colleges/:college_id/invite-principal', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const { email } = req.body || {};
    try {
      const invitation = await platformService.invitePrincipal(platformPool, {
        collegeId: req.params.college_id,
        email,
        createdBy: req.platformClaims.sub,
        ipAddress: req.ip,
      });
      res.json({
        invitation_id: invitation.invitationId,
        college_id: invitation.collegeId,
        email: invitation.email,
        expires_at: invitation.expiresAt,
      });
    } catch (err) {
      if (err instanceof platformService.CollegeNotFoundError) {
        res.status(404).json({ detail: `No college with college_id ${JSON.stringify(req.params.college_id)}` });
        return;
      }
      throw err;
    }
  }));

  // 3-step Invite L1 Principal flow, steps 1 and 2 — step 3 is the
  // existing /invite-principal route above. Not server-gated on step 2
  // (see platformService.invitePrincipal's own comment on why); the UI
  // simply calls these three in sequence.
  router.post('/colleges/:college_id/invite-principal/send-code', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const { email } = req.body || {};
    if (!email) {
      res.status(400).json({ detail: 'email is required' });
      return;
    }
    try {
      const challenge = await platformService.sendPrincipalInviteVerificationCode(platformPool, {
        collegeId: req.params.college_id, email, ipAddress: req.ip,
      });
      res.json({ expires_at: challenge.expiresAt });
    } catch (err) {
      if (err instanceof platformService.CollegeNotFoundError) {
        res.status(404).json({ detail: `No college with college_id ${JSON.stringify(req.params.college_id)}` });
        return;
      }
      throw err;
    }
  }));

  router.post('/colleges/:college_id/invite-principal/verify-code', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const { email, code } = req.body || {};
    if (!email || !code) {
      res.status(400).json({ detail: 'email and code are required' });
      return;
    }
    try {
      await platformService.verifyPrincipalInviteCode(platformPool, { collegeId: req.params.college_id, email, code });
      res.json({ verified: true });
    } catch (err) {
      if (err instanceof platformService.PrincipalInviteVerificationNotFoundError) {
        res.status(404).json({ detail: err.message });
        return;
      }
      if (err instanceof platformService.PrincipalInviteVerificationMaxAttemptsError
        || err instanceof platformService.PrincipalInviteVerificationCodeMismatchError) {
        res.status(409).json({ detail: err.message });
        return;
      }
      throw err;
    }
  }));

  // OnboardingWizard's L1 Head "Email" real OTP — no :college_id in
  // this path (unlike invite-principal/send-code above), since no
  // college row exists yet at Step 1 of the wizard.
  router.post('/onboarding/verify-email/send-code', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const { email } = req.body || {};
    if (!email) {
      res.status(400).json({ detail: 'email is required' });
      return;
    }
    const challenge = await platformService.sendWizardEmailVerificationCode(platformPool, {
      email, actorAdminId: req.platformClaims.sub, ipAddress: req.ip,
    });
    res.json({ expires_at: challenge.expiresAt });
  }));

  router.post('/onboarding/verify-email/verify-code', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const { email, code } = req.body || {};
    if (!email || !code) {
      res.status(400).json({ detail: 'email and code are required' });
      return;
    }
    try {
      await platformService.verifyWizardEmailCode(platformPool, { email, code });
      res.json({ verified: true });
    } catch (err) {
      if (err instanceof platformService.PrincipalInviteVerificationNotFoundError) {
        res.status(404).json({ detail: err.message });
        return;
      }
      if (err instanceof platformService.PrincipalInviteVerificationMaxAttemptsError
        || err instanceof platformService.PrincipalInviteVerificationCodeMismatchError) {
        res.status(409).json({ detail: err.message });
        return;
      }
      throw err;
    }
  }));

  function mapInvitationError(err, res) {
    if (err instanceof platformService.PrincipalInvitationNotFoundError) {
      res.status(404).json({ detail: err.message });
      return true;
    }
    if (err instanceof platformService.PrincipalInvitationNotPendingError) {
      res.status(409).json({ detail: err.message });
      return true;
    }
    return false;
  }

  // Same no-token-in-the-response rule as invite-principal above — a
  // resend rotates the token and emails it, it never echoes it back.
  router.post('/invitations/:invitation_id/resend', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const { email } = req.body || {};
    try {
      const invitation = await platformService.resendPrincipalInvitation(platformPool, req.params.invitation_id, {
        email,
        actorAdminId: req.platformClaims.sub,
        ipAddress: req.ip,
      });
      res.json({
        invitation_id: invitation.invitationId,
        college_id: invitation.collegeId,
        email: invitation.email,
        expires_at: invitation.expiresAt,
      });
    } catch (err) {
      if (mapInvitationError(err, res)) return;
      throw err;
    }
  }));

  router.post('/invitations/:invitation_id/revoke', requirePlatformAdmin, asyncHandler(async (req, res) => {
    try {
      const invitation = await platformService.revokePrincipalInvitation(platformPool, req.params.invitation_id, {
        actorAdminId: req.platformClaims.sub,
        ipAddress: req.ip,
      });
      res.json({
        invitation_id: invitation.invitationId,
        college_id: invitation.collegeId,
        email: invitation.email,
        revoked_at: invitation.revokedAt,
      });
    } catch (err) {
      if (mapInvitationError(err, res)) return;
      throw err;
    }
  }));

  router.get('/invitations', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const {
      limit, offset, status, search,
    } = req.query;
    const invitations = await platformService.listInvitations(platformPool, {
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
      status,
      search,
    });
    res.json(invitations);
  }));

  // Invitations page stat row.
  router.get('/invitations-summary', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const summary = await platformService.getInvitationsSummary(platformPool);
    res.json(summary);
  }));

  router.get('/audit-logs', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const {
      limit, offset, action, actor_admin_id: actorAdminId, from_date: fromDate, to_date: toDate, search,
    } = req.query;
    const entries = await platformService.listAuditLogs(platformPool, {
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
      action,
      actorAdminId,
      fromDate,
      toDate,
      search,
    });
    res.json(entries);
  }));

  router.get('/settings', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const settings = await platformService.getSettings(platformPool);
    res.json(settings);
  }));

  router.put('/settings', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const {
      platform_name: platformName, support_email: supportEmail, default_timezone: defaultTimezone,
      date_format: dateFormat, items_per_page: itemsPerPage, default_license: defaultLicense,
    } = req.body || {};
    try {
      const settings = await platformService.updateSettings(platformPool, {
        platformName,
        supportEmail,
        defaultTimezone,
        dateFormat,
        itemsPerPage,
        defaultLicense,
        actorAdminId: req.platformClaims.sub,
        ipAddress: req.ip,
      });
      res.json(settings);
    } catch (err) {
      if (err instanceof platformService.PlatformAdminValidationError) {
        res.status(400).json({ detail: err.message });
        return;
      }
      if (err instanceof platformService.InvalidLicenseError) {
        res.status(400).json({ detail: err.message });
        return;
      }
      throw err;
    }
  }));

  router.get('/dashboard-summary', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const summary = await platformService.getDashboardSummary(platformPool);
    res.json(summary);
  }));

  // Phase 2 (Position Account Auth), decision 3: Platform Admin ->
  // Level 1/2. Unlike every other route in this file, this one needs
  // to write to TENANT-scoped tables (positions/position_accounts/
  // position_account_invitations) — arcnave_platform (this router's
  // connection) has no GRANT on any of them, by design (ADR-010). This
  // opens its own tenant-scoped transaction against the target college
  // — the same openTenantTransaction/appPool trick
  // routes/positionAccountInvitations.js's (unauthenticated) accept
  // route uses, just from an authenticated-as-Platform-Admin route
  // instead of a tokenized one. actorIsPlatformAdmin: true is what
  // lets assertCanInvite's Level 1/2 rule pass with no capabilities
  // object at all — a Platform Admin has no `users` row to resolve
  // one from.
  router.post('/colleges/:college_id/position-accounts/invite', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const { level, email, title } = req.body || {};
    await openTenantTransaction(req, res, req.params.college_id);

    try {
      const { invitation, position } = await positionAccountInvitationService.inviteToPosition(req.dbClient, {
        collegeId: req.params.college_id,
        level: Number(level),
        title,
        email,
        actorIsPlatformAdmin: true,
        actorCapabilities: null,
        invitedBy: req.platformClaims.sub,
      });

      // The human-visible record of this action: platform_audit_log
      // (not the tenant-side audit_log — that table has no listing
      // route/UI yet, this one does, see AuditLogsPage.jsx). actor_admin_id
      // is a real platform_admins.id, so the listing query's own
      // `LEFT JOIN platform_admins` resolves it to the admin's actual
      // username — never blank, never falls back to the UI's "system"
      // placeholder (that placeholder is only ever for actor_admin_id
      // IS NULL, which this write never produces).
      await platformAuditService.record(platformPool, {
        actorAdminId: req.platformClaims.sub,
        action: 'position_account.invited',
        entity: 'position',
        entityId: position.id,
        ipAddress: req.ip,
        metadata: {
          collegeId: req.params.college_id, level: Number(level), email,
        },
      });

      res.status(201).json({
        invitation_id: invitation.id,
        college_id: invitation.college_id,
        position_id: invitation.position_id,
        email: invitation.email,
        expires_at: invitation.expires_at,
      });
    } catch (err) {
      await req.rollbackTransaction();
      if (err instanceof positionAccountInvitationService.PositionInvitationForbiddenError
        || err instanceof positionAccountInvitationService.PositionInvitationLevelNotSupportedError) {
        res.status(403).json({ detail: err.message });
        return;
      }
      if (err instanceof positionAccountInvitationService.PositionInvitationValidationError) {
        res.status(400).json({ detail: err.message });
        return;
      }
      if (err instanceof positionAccountInvitationService.PositionAccountAlreadyProvisionedError) {
        res.status(409).json({ detail: err.message });
        return;
      }
      throw err;
    }
  }));

  // --- RS-GOV-003/010/011: onboarding department creation + provisioning
  // lifecycle transitions. ---

  function mapProvisioningError(err, res) {
    if (err instanceof platformService.CollegeNotFoundError) {
      res.status(404).json({ detail: err.message });
      return true;
    }
    if (err instanceof platformService.OnboardingDepartmentNotAllowedError
      || err instanceof platformService.ProvisioningTransitionError) {
      res.status(409).json({ detail: err.message });
      return true;
    }
    if (err instanceof platformService.ReadinessGateNotSatisfiedError) {
      res.status(422).json({ detail: err.message });
      return true;
    }
    if (err instanceof academicService.ClassGenerationValidationError) {
      res.status(400).json({ detail: err.message });
      return true;
    }
    if (err instanceof academicService.ClassNameConflictError) {
      res.status(409).json({ detail: err.message });
      return true;
    }
    if (err.code === '23505') {
      res.status(409).json({ detail: 'a department with this name already exists at this college' });
      return true;
    }
    return false;
  }

  router.post('/colleges/:college_id/departments', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const {
      name, approved_intake: approvedIntake, course_duration: courseDuration, default_sections: defaultSections,
    } = req.body || {};
    await openTenantTransaction(req, res, req.params.college_id);
    try {
      const department = await platformService.createDepartmentAtOnboarding(req.dbClient, platformPool, {
        collegeId: req.params.college_id, name, approvedIntake, courseDuration, defaultSections,
      }, { actorAdminId: req.platformClaims.sub, ipAddress: req.ip });
      res.status(201).json(department);
    } catch (err) {
      await req.rollbackTransaction();
      if (mapProvisioningError(err, res)) return;
      throw err;
    }
  }));

  router.post('/colleges/:college_id/templates', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const { name, file_type: fileType } = req.body || {};
    await openTenantTransaction(req, res, req.params.college_id);
    try {
      const template = await platformService.createTemplateAtOnboarding(req.dbClient, platformPool, {
        collegeId: req.params.college_id, name, fileType,
      }, { actorAdminId: req.platformClaims.sub, ipAddress: req.ip });
      res.status(201).json(template);
    } catch (err) {
      await req.rollbackTransaction();
      if (mapProvisioningError(err, res)) return;
      throw err;
    }
  }));

  router.post('/colleges/:college_id/mark-ready', requirePlatformAdmin, asyncHandler(async (req, res) => {
    try {
      const college = await platformService.markCollegeReady(platformPool, req.params.college_id, {
        actorAdminId: req.platformClaims.sub, ipAddress: req.ip,
      });
      res.json(college);
    } catch (err) {
      if (mapProvisioningError(err, res)) return;
      throw err;
    }
  }));

  router.post('/colleges/:college_id/cancel-onboarding', requirePlatformAdmin, asyncHandler(async (req, res) => {
    try {
      const college = await platformService.cancelOnboarding(platformPool, req.params.college_id, {
        actorAdminId: req.platformClaims.sub, ipAddress: req.ip,
      });
      res.json(college);
    } catch (err) {
      if (mapProvisioningError(err, res)) return;
      throw err;
    }
  }));

  router.post('/colleges/:college_id/activate', requirePlatformAdmin, asyncHandler(async (req, res) => {
    await openTenantTransaction(req, res, req.params.college_id);
    try {
      const college = await platformService.activateCollege(req.dbClient, platformPool, req.params.college_id, {
        actorAdminId: req.platformClaims.sub, ipAddress: req.ip,
      });
      res.json(college);
    } catch (err) {
      await req.rollbackTransaction();
      if (mapProvisioningError(err, res)) return;
      throw err;
    }
  }));

  router.post('/colleges/:college_id/suspend', requirePlatformAdmin, asyncHandler(async (req, res) => {
    try {
      const college = await platformService.suspendCollege(platformPool, req.params.college_id, {
        actorAdminId: req.platformClaims.sub, ipAddress: req.ip,
      });
      res.json(college);
    } catch (err) {
      if (mapProvisioningError(err, res)) return;
      throw err;
    }
  }));

  router.post('/colleges/:college_id/reactivate', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const { license } = req.body || {};
    try {
      const college = await platformService.reactivateCollege(platformPool, req.params.college_id, {
        actorAdminId: req.platformClaims.sub, ipAddress: req.ip, license,
      });
      res.json(college);
    } catch (err) {
      if (err instanceof platformService.InvalidLicenseError) {
        res.status(400).json({ detail: err.message });
        return;
      }
      if (mapProvisioningError(err, res)) return;
      throw err;
    }
  }));

  router.post('/colleges/:college_id/archive', requirePlatformAdmin, asyncHandler(async (req, res) => {
    try {
      const college = await platformService.archiveCollege(platformPool, req.params.college_id, {
        actorAdminId: req.platformClaims.sub, ipAddress: req.ip,
      });
      res.json(college);
    } catch (err) {
      if (mapProvisioningError(err, res)) return;
      throw err;
    }
  }));

  router.post('/colleges/:college_id/restore', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const { license } = req.body || {};
    try {
      const college = await platformService.restoreCollege(platformPool, req.params.college_id, {
        actorAdminId: req.platformClaims.sub, ipAddress: req.ip, license,
      });
      res.json(college);
    } catch (err) {
      if (err instanceof platformService.InvalidLicenseError) {
        res.status(400).json({ detail: err.message });
        return;
      }
      if (mapProvisioningError(err, res)) return;
      throw err;
    }
  }));

  // Organizations page stat row.
  router.get('/organizations-summary', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const summary = await platformService.getOrganizationsSummary(platformPool);
    res.json(summary);
  }));

  // --- RS-GOV-005/006/008: structural authorization key redemption.
  // Read-only validation first, tenant-side execution second, and only
  // THEN mark the key redeemed — an ordinary technical/data-validation
  // failure during execution must never consume the key. ---

  function mapKeyRedemptionError(err, res) {
    if (err instanceof platformService.StructuralKeyNotFoundError
      || err instanceof platformService.CollegeNotFoundError) {
      res.status(404).json({ detail: err.message });
      return true;
    }
    if (err instanceof platformService.StructuralKeyNotUsableError
      || err instanceof platformService.StructuralKeyActionMismatchError) {
      res.status(409).json({ detail: err.message });
      return true;
    }
    if (err instanceof platformService.StructuralKeyValidationError) {
      res.status(400).json({ detail: err.message });
      return true;
    }
    return false;
  }

  // RS-GOV-005 wizard: a valid, unexpired key unlocks up to 5
  // independent sections in one sitting — `sections` carries only the
  // ones Platform Admin actually filled in (l2Config/affiliation/
  // accreditation/campus/department, each optional). See
  // platformService.executeStructuralActions' header comment for why
  // Platform Admin enters the values here (not L1 at generation time)
  // and for the cross-pool atomicity limitation.
  router.post('/structural-authorization-keys/redeem', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const { token, sections } = req.body || {};
    if (!token) {
      res.status(400).json({ detail: 'token is required' });
      return;
    }
    if (!sections || typeof sections !== 'object' || Object.keys(sections).length === 0) {
      res.status(400).json({ detail: 'sections is required — at least one of l2Config/affiliation/accreditation/campus/department' });
      return;
    }

    let key;
    try {
      key = await platformService.loadRedeemableStructuralKey(platformPool, { rawToken: token });
    } catch (err) {
      if (mapKeyRedemptionError(err, res)) return;
      throw err;
    }

    await openTenantTransaction(req, res, key.college_id);
    try {
      const results = await platformService.executeStructuralActions(
        req.dbClient, platformPool, key.college_id, sections, { actorAdminId: req.platformClaims.sub, ipAddress: req.ip },
      );
      // RS-GOV-006: the key must survive only if the change(s) it
      // authorized actually landed. Explicitly commit the tenant-side
      // write NOW (req.commitTransaction, not the automatic commit-on-
      // res.end) so a commit failure throws here and skips
      // markStructuralKeyRedeemed entirely — never mark the key
      // redeemed on the strength of a merely-queued, not-yet-durable
      // write. If commitTransaction throws, the catch below's
      // rollbackTransaction call is a safe no-op (commitAndRelease
      // already released the client before throwing).
      await req.commitTransaction();
      await platformService.markStructuralKeyRedeemed(platformPool, key.id, {
        actorAdminId: req.platformClaims.sub, ipAddress: req.ip,
      });
      res.json({ college_id: key.college_id, results });
    } catch (err) {
      await req.rollbackTransaction();
      if (mapKeyRedemptionError(err, res)) return;
      throw err;
    }
  }));

  // Real department list for the struct-key wizard's "Department" step
  // — the source mock used a hardcoded DEPT_LIST; Platform Admin must
  // pick from this college's actual departments. Read-only, tenant-
  // scoped (same openTenantTransaction pattern as the onboarding
  // department routes above), no separate commit needed for a read.
  router.get('/colleges/:college_id/departments', requirePlatformAdmin, asyncHandler(async (req, res) => {
    await openTenantTransaction(req, res, req.params.college_id);
    try {
      const departments = await departmentRepository.findByCollege(req.dbClient, req.params.college_id);
      await req.commitTransaction();
      res.json(departments.filter((d) => d.merged_into_department_id === null));
    } catch (err) {
      await req.rollbackTransaction();
      throw err;
    }
  }));

  return router;
}

module.exports = createPlatformRouter;
