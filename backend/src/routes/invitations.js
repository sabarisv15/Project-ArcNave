'use strict';

// POST /invitations/accept — deliberately unauthenticated, and the
// only tenant-side route in this codebase that doesn't rely on
// tenantMiddleware's normal resolution for the tenant scope it
// operates under. Must be registered *before* authMiddleware/
// tenantMiddleware in tenantApp.js (like /health) — the caller has no
// `users` row and therefore no access token yet, so there is no
// subdomain/JWT/explicit-code signal to resolve a tenant from at all;
// the invitation token itself is the one-time credential proving they
// should be allowed to create one.
//
// This is the one genuinely new architectural problem the Python
// version never had to solve, since it never split into separate
// tenantApp/platformApp instances: this route needs its own
// transaction, scoped to the invitation's own college_id, opened
// *after* looking the invitation up rather than before. It reuses
// db/tenantTransaction.js's openTenantTransaction — the exact same
// commit/rollback machinery tenantMiddleware itself uses — rather
// than hand-rolling a second copy of that logic. tenant.js just went
// through a real, subtle bug in exactly that machinery (committing
// too late, after the response had already been sent); duplicating it
// here would risk reintroducing an equivalent bug independently, in a
// route with a much smaller test surface than tenantMiddleware's own.

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { appPool } = require('../db/pool');
const { openTenantTransaction } = require('../db/tenantTransaction');
const authService = require('../services/authService');

function createInvitationsRouter() {
  const router = express.Router();

  router.post('/invitations/accept', asyncHandler(async (req, res) => {
    const { token, username, password } = req.body || {};

    // Quick lookup on a short-lived connection — principal_invitations
    // has no RLS (see the 0002 migration), so this doesn't need any
    // tenant context at all; the same "open a resolution connection,
    // query, release" shape tenantMiddleware's own colleges lookup
    // uses, for the same reason: we don't yet know which tenant to
    // scope a real transaction to. Validation itself (expired/revoked/
    // already-accepted/unknown, all one generic 401 — don't let the
    // error message be an oracle) lives in authService.lookupPendingInvitation
    // now, not this route.
    const lookupClient = await appPool.connect();
    let invitation;
    try {
      invitation = await authService.lookupPendingInvitation(lookupClient, token);
    } catch (err) {
      if (err instanceof authService.InvitationInvalidError) {
        res.status(401).json({ detail: 'Invalid or expired invitation' });
        return;
      }
      throw err;
    } finally {
      lookupClient.release();
    }

    // The one deliberate, narrow bypass of tenantMiddleware's normal
    // resolution anywhere in this codebase — see this file's module
    // comment. invitation.college_id, already proven authentic by the
    // token lookup above, is the one and only source of tenant scope
    // for the rest of this request.
    await openTenantTransaction(req, res, invitation.college_id);

    let user;
    try {
      user = await authService.acceptInvitation(req.dbClient, invitation, { username, password });
    } catch (err) {
      if (err instanceof authService.InvitationUsernameConflictError) {
        await req.rollbackTransaction();
        res.status(409).json({ detail: err.message });
        return;
      }
      if (err instanceof authService.PasswordResetValidationError) {
        await req.rollbackTransaction();
        res.status(400).json({ detail: err.message });
        return;
      }
      throw err;
    }

    res.status(201).json({
      user_id: user.id,
      college_id: user.college_id,
      username: user.username,
      role: user.role,
    });
  }));

  return router;
}

module.exports = createInvitationsRouter;
