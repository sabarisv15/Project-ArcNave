'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const calendarService = require('../services/calendarService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

const CALENDAR_EVENT_BODY_FIELDS = [
  ['title', 'title'],
  ['event_type', 'eventType'],
  ['start_date', 'startDate'],
  ['end_date', 'endDate'],
  ['description', 'description'],
];

function bodyToFields(body, fieldMap) {
  const fields = {};
  for (const [snakeKey, camelKey] of fieldMap) {
    if (body[snakeKey] !== undefined) {
      fields[camelKey] = body[snakeKey];
    }
  }
  return fields;
}

function mapCalendarServiceError(err, res) {
  if (err instanceof calendarService.CalendarEventValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof calendarService.CalendarEventNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  return false;
}

function createCalendarRouter() {
  const router = express.Router();

  // BusinessRules.md Platform administration, Academic Calendar: any
  // authenticated tenant user may read — same "not a personal task
  // list, one shared calendar" reasoning that makes it pointless to
  // restrict reads the way Institution Settings' sensitive
  // configuration categories are (routes/configurations.js). Writes
  // are Principal-only (calendar.write), matching that same route's
  // conservative default for admin-facing configuration changes.
  router.get(
    '/calendar-events',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { from_date: fromDate, to_date: toDate } = req.query;
      const events = await calendarService.listEvents(req.dbClient, { collegeId: req.collegeId, fromDate, toDate });
      res.json(events);
    }),
  );

  router.get(
    '/calendar-events/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const event = await calendarService.getEvent(req.dbClient, req.params.id);
        res.json(event);
      } catch (err) {
        if (mapCalendarServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/calendar-events',
    requirePermission('calendar.write'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const event = await calendarService.createEvent(
          req.dbClient,
          { collegeId: req.collegeId, ...bodyToFields(req.body || {}, CALENDAR_EVENT_BODY_FIELDS) },
          { actorUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.status(201).json(event);
      } catch (err) {
        if (mapCalendarServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.put(
    '/calendar-events/:id',
    requirePermission('calendar.write'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const event = await calendarService.updateEvent(
          req.dbClient,
          req.params.id,
          bodyToFields(req.body || {}, CALENDAR_EVENT_BODY_FIELDS),
          { actorUserId: identityService.resolveActorUserId(req.capabilities), collegeId: req.collegeId },
        );
        res.json(event);
      } catch (err) {
        if (mapCalendarServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.delete(
    '/calendar-events/:id',
    requirePermission('calendar.write'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        await calendarService.deleteEvent(req.dbClient, req.params.id, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          collegeId: req.collegeId,
        });
        res.status(204).end();
      } catch (err) {
        if (mapCalendarServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  return router;
}

module.exports = createCalendarRouter;
