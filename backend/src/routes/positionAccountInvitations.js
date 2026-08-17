'use strict';

// POST /position-accounts/invitations/accept — deliberately
// unauthenticated, same reasoning as routes/invitations.js's own
// accept route (its module comment applies here verbatim): the
// invitee has no session of any kind yet, so there's no subdomain/JWT
// signal to resolve a tenant from — the invitation token itself is
// the one-time credential. Must be registered before authMiddleware/
// tenantMiddleware in tenantApp.js, same as routes/invitations.js.

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { appPool } = require('../db/pool');
const { openTenantTransaction } = require('../db/tenantTransaction');
const positionAccountInvitationService = require('../services/positionAccountInvitationService');

function createPositionAccountInvitationsRouter() {
  const router = express.Router();

  router.post('/position-accounts/invitations/accept', asyncHandler(async (req, res) => {
    const { token, password } = req.body || {};

    const lookupClient = await appPool.connect();
    let invitation;
    try {
      invitation = await positionAccountInvitationService.lookupPendingInvitation(lookupClient, token);
    } catch (err) {
      if (err instanceof positionAccountInvitationService.PositionInvitationInvalidError) {
        res.status(401).json({ detail: 'Invalid or expired invitation' });
        return;
      }
      throw err;
    } finally {
      lookupClient.release();
    }

    await openTenantTransaction(req, res, invitation.college_id);

    let account;
    try {
      account = await positionAccountInvitationService.acceptInvitation(req.dbClient, invitation, { password });
    } catch (err) {
      if (err instanceof positionAccountInvitationService.PositionInvitationValidationError) {
        await req.rollbackTransaction();
        res.status(400).json({ detail: err.message });
        return;
      }
      if (err instanceof positionAccountInvitationService.PositionInvitationInvalidError) {
        await req.rollbackTransaction();
        res.status(401).json({ detail: 'Invalid or expired invitation' });
        return;
      }
      throw err;
    }

    res.status(201).json({
      position_account_id: account.id,
      college_id: account.college_id,
      official_email: account.official_email,
    });
  }));

  return router;
}

module.exports = createPositionAccountInvitationsRouter;
