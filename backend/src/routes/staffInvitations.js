'use strict';

// POST /staff/invitations/accept — deliberately unauthenticated, same
// reasoning as routes/invitations.js's own accept route (its module
// comment applies here verbatim): the invitee has no session of any
// kind yet, so there's no subdomain/JWT signal to resolve a tenant
// from — the invitation token itself is the one-time credential. Must
// be registered before authMiddleware/tenantMiddleware in
// tenantApp.js, same as routes/invitations.js and
// routes/positionAccountInvitations.js.

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { appPool } = require('../db/pool');
const { openTenantTransaction } = require('../db/tenantTransaction');
const staffService = require('../services/staffService');

// Same snake_case <-> camelCase translation shape as routes/staff.js's
// own STAFF_BODY_FIELDS, restricted to the profile fields RS-STF-002
// step 1 ("completes their profile") actually covers — user_id and
// college_id are deliberately absent, same reasoning STAFF_BODY_FIELDS
// already gives for excluding them from a caller-supplied body.
const PROFILE_BODY_FIELDS = [
  ['full_name', 'fullName'],
  ['gender', 'gender'],
  ['dob', 'dob'],
  ['phone', 'phone'],
  ['designation', 'designation'],
  ['qualification', 'qualification'],
  ['has_phd', 'hasPhd'],
  ['aicte_id', 'aicteId'],
  ['joined_year', 'joinedYear'],
  ['address', 'address'],
];

function profileBodyToFields(body) {
  const fields = {};
  for (const [snakeKey, camelKey] of PROFILE_BODY_FIELDS) {
    if (body[snakeKey] !== undefined) {
      fields[camelKey] = body[snakeKey];
    }
  }
  return fields;
}

function createStaffInvitationsRouter() {
  const router = express.Router();

  router.post(
    '/staff/invitations/accept',
    asyncHandler(async (req, res) => {
      const { token, username, password } = req.body || {};
      const profileFields = profileBodyToFields(req.body || {});

      const lookupClient = await appPool.connect();
      let invitation;
      try {
        invitation = await staffService.lookupPendingStaffInvitation(lookupClient, token);
      } catch (err) {
        if (err instanceof staffService.StaffInvitationInvalidError) {
          res.status(401).json({ detail: 'Invalid or expired invitation' });
          return;
        }
        throw err;
      } finally {
        lookupClient.release();
      }

      await openTenantTransaction(req, res, invitation.college_id);

      let result;
      try {
        result = await staffService.acceptStaffInvitation(req.dbClient, invitation, {
          username,
          password,
          ...profileFields,
        });
      } catch (err) {
        if (err instanceof staffService.StaffInvitationValidationError) {
          await req.rollbackTransaction();
          res.status(400).json({ detail: err.message });
          return;
        }
        if (err instanceof staffService.StaffInvitationUsernameConflictError) {
          await req.rollbackTransaction();
          res.status(409).json({ detail: err.message });
          return;
        }
        throw err;
      }

      res.status(201).json({
        user_id: result.user.id,
        staff_id: result.staff.id,
        college_id: result.staff.college_id,
        username: result.user.username,
        email: result.user.email,
        department_id: result.staff.department_id,
        workflow_request_id: result.workflowRequest.id,
      });
    }),
  );

  return router;
}

module.exports = createStaffInvitationsRouter;
