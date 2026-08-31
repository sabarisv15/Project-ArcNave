'use strict';

// REST surface for the notification ledger (Module 8) —
// draftNotification/submitForApproval were only reachable via AI tools
// (aiToolRegistry.js's draft_notification/request_notification_send)
// until this slice; a human drafting/submitting an announcement had
// no route at all. Approve/reject/dispatch deliberately stay on the
// generic workflow-requests route (routes/workflowRequests.js) — that
// route is already the single approval surface for every entity type
// this codebase has (fee_structures, staff_registration, notification,
// timetable), and duplicating approve/reject here would create a
// second path to the same state transition. This file only adds what
// was actually missing: draft, submit, and list.
//
// No new service logic — every handler below is a thin wrapper over an
// existing notificationService function, same "the route is a thin
// wrapper" convention every other route in this codebase already
// follows. listNotifications (service) and list (repository) are the
// one genuinely new pair, and both are plain query mechanics/passthroughs,
// not business rules — the ledger had every write path already; nothing
// to read them back with.

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission } = require('../middleware/rbac');
const notificationService = require('../services/notificationService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// Same error mapping routes/workflowRequests.js already uses for these
// exact classes — not a second, independently-invented convention.
function mapNotificationServiceError(err, res) {
  if (err instanceof notificationService.NotificationValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof notificationService.NotificationUserNotFoundError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof notificationService.NotificationNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  return false;
}

// snake_case <-> camelCase translation lives here, not in a shared
// util — same reasoning attendance.js's own *_BODY_FIELDS gives.
// college_id is deliberately absent (always req.collegeId, never the
// request body), same convention every other route in this codebase
// follows.
const NOTIFICATION_BODY_FIELDS = [
  ['channel', 'channel'],
  ['to_address', 'toAddress'],
  ['subject', 'subject'],
  ['body', 'body'],
  ['origin', 'origin'],
  ['kind', 'kind'],
];

function bodyToServiceFields(body) {
  const fields = {};
  for (const [snakeKey, camelKey] of NOTIFICATION_BODY_FIELDS) {
    if (body[snakeKey] !== undefined) {
      fields[camelKey] = body[snakeKey];
    }
  }
  return fields;
}

function createNotificationsRouter() {
  const router = express.Router();

  // 201: creates a new Draft row, same reasoning every other create
  // route in this codebase uses. origin defaults to 'human' inside
  // draftNotification itself if the caller omits it — this is a human
  // hitting a REST route, so that default is almost always correct
  // here, but a caller is free to pass 'ai' if some future automation
  // drafts through this same route instead of the tool registry.
  router.post(
    '/notifications',
    requirePermission('notifications.draft'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const notification = await notificationService.draftNotification(
          req.dbClient,
          { collegeId: req.collegeId, ...bodyToServiceFields(req.body || {}) },
          { actorUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.status(201).json(notification);
      } catch (err) {
        if (mapNotificationServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // 200, not 201: submitForApproval mutates the existing Draft row
  // (stores workflow_request_id back onto it) rather than creating a
  // new resource — same reasoning classes.js's submit-for-approval
  // route uses.
  router.post(
    '/notifications/:id/submit',
    requirePermission('notifications.submit'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const notification = await notificationService.submitForApproval(req.dbClient, req.params.id, {
          requestedByUserId: identityService.resolveActorUserId(req.capabilities),
        });
        res.status(200).json(notification);
      } catch (err) {
        if (mapNotificationServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/notifications',
    requirePermission('notifications.read'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { limit, offset } = req.query;
      const notifications = await notificationService.listNotifications(req.dbClient, {
        limit: limit !== undefined ? Number(limit) : undefined,
        offset: offset !== undefined ? Number(offset) : undefined,
      });
      res.json(notifications);
    }),
  );

  return router;
}

module.exports = createNotificationsRouter;
