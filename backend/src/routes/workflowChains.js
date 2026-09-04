'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const workflowChainService = require('../services/workflowChainService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function mapWorkflowChainServiceError(err, res) {
  if (
    err instanceof workflowChainService.WorkflowChainValidationError ||
    err instanceof workflowChainService.WorkflowChainUnknownRoleError
  ) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  return false;
}

const createDelegationSchema = z.object({
  body: z
    .object({
      role: z.string().optional(),
      department_id: z.string().optional(),
      delegate_user_id: z.string().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      reason: z.string().optional(),
    })
    .optional(),
});
const revokeDelegationSchema = z.object({ params: z.object({ id: z.string() }) });

function createWorkflowChainsRouter() {
  const router = express.Router();

  // BusinessRules.md Configurable approval workflow: delegation is
  // gated to Principal — the same role that already appoints HOD
  // In-Charge (task #10) for the identical "someone else exercises my
  // approval authority for a while" concern, one role, not two
  // separate delegation-granting authorities.
  router.post(
    '/workflow-delegations',
    requirePermission('workflow_delegations.create'),
    validate(createDelegationSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const {
        role,
        department_id: departmentId,
        delegate_user_id: delegateUserId,
        start_date: startDate,
        end_date: endDate,
        reason,
      } = req.body || {};
      try {
        const delegation = await workflowChainService.createDelegation(
          req.dbClient,
          {
            role,
            departmentId,
            delegateUserId,
            startDate,
            endDate,
            reason,
          },
          { actorUserId: identityService.resolveActorUserId(req.capabilities), collegeId: req.collegeId },
        );
        res.status(201).json(delegation);
      } catch (err) {
        if (mapWorkflowChainServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/workflow-delegations',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const delegations = await workflowChainService.listDelegations(req.dbClient, req.collegeId);
      res.json(delegations);
    }),
  );

  router.post(
    '/workflow-delegations/:id/revoke',
    requirePermission('workflow_delegations.create'),
    validate(revokeDelegationSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const delegation = await workflowChainService.revokeDelegation(req.dbClient, req.params.id, {
        actorUserId: identityService.resolveActorUserId(req.capabilities),
      });
      if (delegation === null) {
        res
          .status(404)
          .json({ detail: `No delegation found with id ${JSON.stringify(req.params.id)} (or already revoked)` });
        return;
      }
      res.json(delegation);
    }),
  );

  return router;
}

module.exports = createWorkflowChainsRouter;
module.exports.schemas = {
  '/workflow-delegations': { post: createDelegationSchema },
  '/workflow-delegations/{id}/revoke': { post: revokeDelegationSchema },
};
