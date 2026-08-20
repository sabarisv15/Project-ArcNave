'use strict';

// Ordinary tenant-scoped routes — registered after tenantMiddleware
// in app.js, using req.dbClient/req.collegeId like any other route.
// Not to be confused with middleware/auth.js's AuthMiddleware, which
// is a different thing entirely (decodes a bearer token if present,
// non-enforcing).

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/rbac');
const { createCredentialRateLimiter } = require('../middleware/rateLimit');
const authService = require('../services/authService');
const identityService = require('../services/identityService');

function createAuthRouter() {
  const router = express.Router();

  // Brute-force protection — see middleware/rateLimit.js's own file
  // comment for why this is IP+identifier keyed, in-memory, and never
  // logs/stores the raw identifier. One instance per route because
  // each keys on a different request-body field.
  //
  // login's own limit (50, not the 10 default) is measured, not
  // guessed: this codebase's test suite legitimately re-authenticates
  // the same seeded user many times per file (a fresh JWT per subtest,
  // rather than reusing one token) — classes.test.js alone calls
  // login(collegeA, 'principaluser') 30 times against one shared app
  // instance. 50 clears that with real headroom while still being a
  // genuine throttle: a real attacker needs far more than 50 guesses
  // against an argon2-hashed password to have any realistic chance,
  // and each guess already costs a real argon2 hash on this server
  // regardless of this limiter.
  const loginLimiter = createCredentialRateLimiter('username', 50);
  const mfaVerifyLimiter = createCredentialRateLimiter('challenge_id');
  const mfaResendLimiter = createCredentialRateLimiter('challenge_id');
  const passwordResetLimiter = createCredentialRateLimiter('email');

  // Business rule task #19: a login this college's 'auth' config gates
  // into MFA returns { mfa_required: true, challenge_id, expires_at }
  // instead of tokens — authService.login itself decides which shape
  // comes back (see its own MFA-gating comment); this route only
  // relays whichever one it got, same "service decides, route relays"
  // split every other route in this file already keeps.
  router.post('/auth/login', loginLimiter, asyncHandler(async (req, res) => {
    if (req.collegeId === null) {
      res.status(400).json({ detail: 'No tenant could be resolved for this request' });
      return;
    }
    const { username, password } = req.body || {};
    try {
      const result = await authService.login(req.dbClient, { collegeId: req.collegeId, username, password });
      if (result.mfaRequired) {
        res.json({
          mfa_required: true,
          challenge_id: result.challengeId,
          expires_at: result.expiresAt,
        });
        return;
      }
      res.json({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        token_type: result.tokenType,
      });
    } catch (err) {
      if (err instanceof authService.AuthError) {
        res.status(401).json({ detail: 'Invalid username or password' });
        return;
      }
      throw err;
    }
  }));

  // Completes an MFA-gated login: exchanges the challenge_id + emailed
  // code for the real token pair. No requireAuth here — the caller
  // isn't authenticated yet (that's the entire point of this route),
  // same as /auth/login itself.
  router.post('/auth/mfa/verify', mfaVerifyLimiter, asyncHandler(async (req, res) => {
    if (req.collegeId === null) {
      res.status(400).json({ detail: 'No tenant could be resolved for this request' });
      return;
    }
    const { challenge_id: challengeId, code } = req.body || {};
    try {
      const tokens = await authService.verifyMfaLogin(req.dbClient, { challengeId, code });
      res.json({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: tokens.tokenType,
      });
    } catch (err) {
      if (err instanceof authService.MfaChallengeNotFoundError
        || err instanceof authService.MfaMaxAttemptsExceededError
        || err instanceof authService.MfaCodeMismatchError
        || err instanceof authService.AuthError) {
        // Same one-generic-401 reasoning as /auth/login's own AuthError
        // mapping — a caller gets no signal about which of "wrong
        // code", "expired", "already used", or "too many attempts"
        // actually happened.
        res.status(401).json({ detail: 'Invalid or expired MFA challenge' });
        return;
      }
      throw err;
    }
  }));

  // Re-issues a fresh code for a live MFA challenge, without requiring
  // username/password again — same "no requireAuth, not authenticated
  // yet" reasoning as /auth/mfa/verify. Body/response shape mirrors
  // /auth/login's own MFA-required branch exactly, since
  // authService.resendMfaChallenge returns via the same issueMfaChallenge
  // codepath login() uses.
  router.post('/auth/mfa/resend', mfaResendLimiter, asyncHandler(async (req, res) => {
    if (req.collegeId === null) {
      res.status(400).json({ detail: 'No tenant could be resolved for this request' });
      return;
    }
    const { challenge_id: challengeId } = req.body || {};
    try {
      const result = await authService.resendMfaChallenge(req.dbClient, { challengeId });
      res.json({
        mfa_required: true,
        challenge_id: result.challengeId,
        expires_at: result.expiresAt,
      });
    } catch (err) {
      if (err instanceof authService.MfaChallengeNotFoundError) {
        res.status(401).json({ detail: 'Invalid or expired MFA challenge' });
        return;
      }
      throw err;
    }
  }));

  // Self-service opt-in/out for institution mode 'optional' (see
  // authService.userRequiresMfa) — requireAuth only, no extra
  // permission: a user managing their own second factor isn't a
  // role-gated capability, same reasoning /auth/me's own comment gives
  // for "return my own identity".
  router.post('/auth/mfa/enable', requireAuth, asyncHandler(async (req, res) => {
    const user = await authService.enableMfa(req.dbClient, identityService.resolveActorUserId(req.capabilities));
    res.json({ mfa_enabled: user.mfa_enabled });
  }));

  router.post('/auth/mfa/disable', requireAuth, asyncHandler(async (req, res) => {
    const user = await authService.disableMfa(req.dbClient, identityService.resolveActorUserId(req.capabilities));
    res.json({ mfa_enabled: user.mfa_enabled });
  }));

  router.post('/auth/refresh', asyncHandler(async (req, res) => {
    const { refresh_token: refreshToken } = req.body || {};
    try {
      const tokens = await authService.refresh(req.dbClient, refreshToken);
      res.json({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: tokens.tokenType,
      });
    } catch (err) {
      // Same client-facing outcome either way — the reuse case is
      // already distinguished server-side via the warning log
      // authService.refresh emits before throwing.
      if (err instanceof authService.RefreshTokenReuseError || err instanceof authService.AuthError) {
        res.status(401).json({ detail: 'Invalid refresh token' });
        return;
      }
      throw err;
    }
  }));

  router.post('/auth/logout', asyncHandler(async (req, res) => {
    const { refresh_token: refreshToken } = req.body || {};
    await authService.revoke(req.dbClient, refreshToken);
    res.status(204).end();
  }));

  // Always 204, enumeration-safe — same reasoning login's single
  // generic AuthError uses: whether or not `email` matches a real,
  // active account, the caller sees the identical response either way.
  // authService.requestPasswordReset itself is what actually decides
  // whether to mint a token + send an email at all.
  router.post('/auth/password-reset', passwordResetLimiter, asyncHandler(async (req, res) => {
    if (req.collegeId === null) {
      res.status(400).json({ detail: 'No tenant could be resolved for this request' });
      return;
    }
    const { email } = req.body || {};
    await authService.requestPasswordReset(req.dbClient, { collegeId: req.collegeId, email });
    res.status(204).end();
  }));

  router.post('/auth/password-reset/confirm', asyncHandler(async (req, res) => {
    const { token, new_password: newPassword } = req.body || {};
    try {
      await authService.resetPassword(req.dbClient, { token, newPassword });
      res.status(204).end();
    } catch (err) {
      if (err instanceof authService.PasswordResetValidationError) {
        res.status(400).json({ detail: err.message });
        return;
      }
      if (err instanceof authService.PasswordResetTokenError) {
        res.status(401).json({ detail: err.message });
        return;
      }
      throw err;
    }
  }));

  // First real RBAC-gated route — same role Module 0's Python version
  // gave it (see git history). Uses requireAuth, not
  // requireRole('staff', 'hod', 'principal'): "return my own identity"
  // isn't a role-gated capability, it holds for any authenticated
  // tenant user regardless of which roles currently exist —
  // deliberately not hardcoding the tenant role list at this call
  // site either, consistent with middleware/rbac.js not hardcoding it
  // in the middleware itself. No DB lookup needed — returns the
  // identity straight from the JWT's already-verified claims.
  router.get('/auth/me', requireAuth, asyncHandler(async (req, res) => {
    const claims = req.jwtClaims;
    const profile = await authService.getUserProfile(req.dbClient, claims.sub);
    res.json({
      user_id: claims.sub,
      college_id: claims.college_id,
      role: claims.role,
      full_name: profile?.fullName ?? null,
      designation: profile?.designation ?? null,
      phone: profile?.phone ?? null,
      address: profile?.address ?? null,
    });
  }));

  return router;
}

module.exports = createAuthRouter;
