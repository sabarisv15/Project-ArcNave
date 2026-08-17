'use strict';

// RS-GOV-005/006: L1 generates/cancels a structural authorization key
// from their own tenant login. Redemption is a Platform Admin action —
// see routes/platform.js's /structural-authorization-keys/redeem.

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission } = require('../middleware/rbac');
const platformService = require('../services/platformService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function mapKeyError(err, res) {
  if (err instanceof platformService.StructuralKeyValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof platformService.StructuralKeyNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof platformService.StructuralKeyNotUsableError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  return false;
}

function createStructuralAuthorizationKeysRouter() {
  const router = express.Router();

  router.post('/structural-authorization-keys', requirePermission('structural_authorization_keys.create'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { action_type: actionType, action_payload: actionPayload } = req.body || {};
    try {
      const key = await platformService.generateStructuralAuthorizationKey(req.dbClient, {
        collegeId: req.collegeId, actionType, actionPayload,
      }, { actorUserId: identityService.resolveActorUserId(req.capabilities) });
      res.status(201).json({
        key_id: key.keyId, token: key.rawToken, action_type: key.actionType, expires_at: key.expiresAt,
      });
    } catch (err) {
      if (mapKeyError(err, res)) return;
      throw err;
    }
  }));

  router.post('/structural-authorization-keys/:id/cancel', requirePermission('structural_authorization_keys.cancel'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const cancelled = await platformService.cancelStructuralAuthorizationKey(
        req.dbClient, req.collegeId, req.params.id, { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.json({ id: cancelled.id, status: cancelled.status, cancelled_at: cancelled.cancelled_at });
    } catch (err) {
      if (mapKeyError(err, res)) return;
      throw err;
    }
  }));

  return router;
}

module.exports = createStructuralAuthorizationKeysRouter;
