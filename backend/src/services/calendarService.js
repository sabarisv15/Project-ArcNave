'use strict';

// Business rule task #20 (BusinessRules.md Platform administration,
// "Academic Calendar"): "one shared institutional calendar (not a
// personal task list) for semester dates, holidays, exams, and other
// institution-defined events; no predefined event-type restriction. AI
// can answer calendar questions but never creates or edits an event
// without authorization." The Principal-only write gate is enforced at
// the route/RBAC layer (requirePermission('calendar.write')), same
// division every other service in this codebase draws — this file
// enforces only what's legal regardless of who's calling
// (non-empty title/eventType/startDate).
//
// listEvents has no actor/authorization param and no write path at
// all — this is the same function the AI read tool below calls
// directly, and the rule's "AI can answer calendar questions" is
// satisfied by this function simply having no way to mutate anything,
// not by a runtime role check a Policy Gate already handles elsewhere
// (aiToolRegistry.js).

const calendarEventRepository = require('../repositories/calendarEventRepository');
const auditLogRepository = require('../repositories/auditLogRepository');

class CalendarEventValidationError extends Error {}

class CalendarEventNotFoundError extends Error {}

function assertValidFields({ title, eventType, startDate }) {
  if (!title || !eventType || !startDate) {
    throw new CalendarEventValidationError('title, eventType, and startDate are required');
  }
}

async function createEvent(client, { collegeId, title, eventType, startDate, endDate, description }, { actorUserId }) {
  assertValidFields({ title, eventType, startDate });

  const event = await calendarEventRepository.create(client, {
    collegeId,
    title,
    eventType,
    startDate,
    endDate: endDate || null,
    description: description || null,
    createdBy: actorUserId,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'calendar_event_created',
    entity: 'academic_calendar_events',
    entityId: event.id,
    metadata: { title: event.title, eventType: event.event_type, startDate: event.start_date },
  });

  return event;
}

async function updateEvent(client, id, { title, eventType, startDate, endDate, description }, { actorUserId, collegeId }) {
  const existing = await calendarEventRepository.findById(client, id);
  if (existing === null) {
    throw new CalendarEventNotFoundError(`calendar event ${JSON.stringify(id)} does not exist`);
  }
  if (title !== undefined || eventType !== undefined || startDate !== undefined) {
    assertValidFields({
      title: title !== undefined ? title : existing.title,
      eventType: eventType !== undefined ? eventType : existing.event_type,
      startDate: startDate !== undefined ? startDate : existing.start_date,
    });
  }

  const event = await calendarEventRepository.update(client, id, {
    title, eventType, startDate, endDate, description,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'calendar_event_updated',
    entity: 'academic_calendar_events',
    entityId: id,
    metadata: null,
  });

  return event;
}

async function deleteEvent(client, id, { actorUserId, collegeId }) {
  const existing = await calendarEventRepository.findById(client, id);
  if (existing === null) {
    throw new CalendarEventNotFoundError(`calendar event ${JSON.stringify(id)} does not exist`);
  }

  await calendarEventRepository.remove(client, id);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'calendar_event_deleted',
    entity: 'academic_calendar_events',
    entityId: id,
    metadata: { title: existing.title },
  });
}

async function getEvent(client, id) {
  const event = await calendarEventRepository.findById(client, id);
  if (event === null) {
    throw new CalendarEventNotFoundError(`calendar event ${JSON.stringify(id)} does not exist`);
  }
  return event;
}

async function listEvents(client, { collegeId, fromDate, toDate } = {}) {
  return calendarEventRepository.list(client, { collegeId, fromDate, toDate });
}

module.exports = {
  CalendarEventValidationError,
  CalendarEventNotFoundError,
  createEvent,
  updateEvent,
  deleteEvent,
  getEvent,
  listEvents,
};
