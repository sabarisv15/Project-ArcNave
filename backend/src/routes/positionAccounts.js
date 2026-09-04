'use strict';

// Ordinary tenant-scoped routes, registered after tenantMiddleware —
// mirrors routes/auth.js's login/refresh/logout shape exactly, just
// against positionAccountAuthService instead of authService. The
// Level 3 (HOD) invite route lives here too: it's an ordinary
// requireAuth'd tenant route (the inviting actor is a Level 2
// position-holder acting from their PERSONAL login, per the plan's
// decision 4) — not to be confused with routes/positionAccountInvitations.js's
// accept route, which (like routes/invitations.js) must run
// unauthenticated, before tenantMiddleware.

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/rbac');
const positionAccountAuthService = require('../services/positionAccountAuthService');
const positionAccountInvitationService = require('../services/positionAccountInvitationService');
const identityService = require('../services/identityService');
const { createRefreshCookieHelpers } = require('../middleware/refreshCookie');
const config = require('../config');

const { setRefreshCookie, clearRefreshCookie, getRefreshTokenFromRequest } = createRefreshCookieHelpers(
  config.positionRefreshCookie,
);

const positionAccountLoginSchema = z.object({
  body: z.object({ official_email: z.string().optional(), password: z.string().optional() }).optional(),
});
const positionAccountMfaVerifySchema = z.object({
  body: z.object({ challenge_id: z.string().optional(), code: z.string().optional() }).optional(),
});
const inviteToPositionSchema = z.object({
  params: z.object({ departmentId: z.string() }),
  body: z.object({ email: z.string().optional(), title: z.string().optional() }).optional(),
});

function createPositionAccountsRouter() {
  const router = express.Router();

  router.post(
    '/position-accounts/login',
    validate(positionAccountLoginSchema),
    asyncHandler(async (req, res) => {
      if (req.collegeId === null) {
        res.status(400).json({ detail: 'No tenant could be resolved for this request' });
        return;
      }
      const { official_email: officialEmail, password } = req.body || {};
      try {
        const result = await positionAccountAuthService.login(req.dbClient, {
          collegeId: req.collegeId,
          officialEmail,
          password,
        });
        // Stage 8e / D17: same { mfa_required, challenge_id, expires_at }
        // shape routes/auth.js's own /auth/login already returns — a
        // caller's MFA-handling code works identically against either
        // login endpoint.
        if (result.mfaRequired) {
          res.json({
            mfa_required: true,
            challenge_id: result.challengeId,
            expires_at: result.expiresAt,
          });
          return;
        }
        setRefreshCookie(res, result.refreshToken);
        res.json({
          access_token: result.accessToken,
          token_type: result.tokenType,
        });
      } catch (err) {
        if (err instanceof positionAccountAuthService.PositionAuthError) {
          res.status(401).json({ detail: 'Invalid official email or password' });
          return;
        }
        throw err;
      }
    }),
  );

  // Completes an MFA-gated Position Account login — mirrors
  // routes/auth.js's /auth/mfa/verify exactly. No requireAuth: the
  // caller isn't authenticated yet, same as /position-accounts/login.
  router.post(
    '/position-accounts/mfa/verify',
    validate(positionAccountMfaVerifySchema),
    asyncHandler(async (req, res) => {
      const { challenge_id: challengeId, code } = req.body || {};
      try {
        const tokens = await positionAccountAuthService.verifyPositionMfaLogin(req.dbClient, { challengeId, code });
        setRefreshCookie(res, tokens.refreshToken);
        res.json({
          access_token: tokens.accessToken,
          token_type: tokens.tokenType,
        });
      } catch (err) {
        if (
          err instanceof positionAccountAuthService.PositionMfaChallengeNotFoundError ||
          err instanceof positionAccountAuthService.PositionMfaMaxAttemptsExceededError ||
          err instanceof positionAccountAuthService.PositionMfaCodeMismatchError ||
          err instanceof positionAccountAuthService.PositionAuthError
        ) {
          res.status(401).json({ detail: 'Invalid or expired MFA challenge' });
          return;
        }
        throw err;
      }
    }),
  );

  // Self-service opt-in/out for institution mode 'optional' — mirrors
  // routes/auth.js's /auth/mfa/enable|disable. requireAuth accepts both
  // 'access' and 'position_access' claims (middleware/rbac.js), but only
  // a 'position_access' session actually has a positionAccountId to
  // toggle — a personal-login session hitting this route gets a clean
  // 403, not an attempt to toggle MFA for whatever req.jwtClaims.sub
  // (a userId here, not a positionAccountId) happens to resolve to.
  router.post(
    '/position-accounts/mfa/enable',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (req.jwtClaims.type !== 'position_access') {
        res.status(403).json({ detail: 'Only a Position Account session may enroll that account in MFA' });
        return;
      }
      const account = await positionAccountAuthService.enablePositionMfa(req.dbClient, req.jwtClaims.sub);
      res.json({ mfa_enabled: account.mfa_enabled });
    }),
  );

  router.post(
    '/position-accounts/mfa/disable',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (req.jwtClaims.type !== 'position_access') {
        res.status(403).json({ detail: "Only a Position Account session may modify that account's MFA" });
        return;
      }
      const account = await positionAccountAuthService.disablePositionMfa(req.dbClient, req.jwtClaims.sub);
      res.json({ mfa_enabled: account.mfa_enabled });
    }),
  );

  router.post(
    '/position-accounts/refresh',
    asyncHandler(async (req, res) => {
      const refreshToken = getRefreshTokenFromRequest(req);
      try {
        const tokens = await positionAccountAuthService.refresh(req.dbClient, refreshToken);
        setRefreshCookie(res, tokens.refreshToken);
        res.json({
          access_token: tokens.accessToken,
          token_type: tokens.tokenType,
        });
      } catch (err) {
        // Same client-facing outcome either way — auth.js's own
        // /auth/refresh follows this exact reasoning for the personal-
        // login equivalent.
        if (
          err instanceof positionAccountAuthService.PositionRefreshTokenReuseError ||
          err instanceof positionAccountAuthService.PositionAuthError
        ) {
          clearRefreshCookie(res);
          res.status(401).json({ detail: 'Invalid refresh token' });
          return;
        }
        throw err;
      }
    }),
  );

  router.post(
    '/position-accounts/logout',
    asyncHandler(async (req, res) => {
      const refreshToken = getRefreshTokenFromRequest(req);
      await positionAccountAuthService.revoke(req.dbClient, refreshToken);
      clearRefreshCookie(res);
      res.status(204).end();
    }),
  );

  // Level 3 (HOD) invite — the actor is a Level 2 position-holder
  // acting from their PERSONAL login (req.jwtClaims.sub is a userId,
  // req.capabilities is their resolveCapabilities result), never a
  // Position Account session inviting another. Level 1/2 invites are
  // Platform-Admin-only and live on the platform router instead — see
  // routes/platform.js.
  router.post(
    '/departments/:departmentId/position-accounts/invite',
    requireAuth,
    validate(inviteToPositionSchema),
    asyncHandler(async (req, res) => {
      const { email, title } = req.body || {};
      try {
        const { invitation } = await positionAccountInvitationService.inviteToPosition(req.dbClient, {
          collegeId: req.collegeId,
          level: 3,
          departmentId: req.params.departmentId,
          title,
          email,
          actorIsPlatformAdmin: false,
          actorCapabilities: req.capabilities,
          invitedBy: identityService.resolveActorUserId(req.capabilities),
        });
        res.status(201).json({
          invitation_id: invitation.id,
          college_id: invitation.college_id,
          position_id: invitation.position_id,
          email: invitation.email,
          expires_at: invitation.expires_at,
        });
      } catch (err) {
        if (err instanceof positionAccountInvitationService.PositionInvitationForbiddenError) {
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
    }),
  );

  return router;
}

module.exports = createPositionAccountsRouter;
module.exports.schemas = {
  '/position-accounts/login': { post: positionAccountLoginSchema },
  '/position-accounts/mfa/verify': { post: positionAccountMfaVerifySchema },
  '/departments/{departmentId}/position-accounts/invite': { post: inviteToPositionSchema },
};
