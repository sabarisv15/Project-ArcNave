'use strict';

// Frontend-discovery gap (UAT Priority 1 #1, "Teaching Journal"/"Class
// Log"): a per-hour record of what topic was actually taught, searchable
// by date/class/subject. Authorization reuses visibilityService's
// existing "assigned classes" scope (tutor-of-record OR faculty-
// allocated) — the same set of classes a staff member may already view
// is exactly the set they may log against; there is no narrower
// "currently teaching this exact period" check, since a log entry is
// backward-looking documentation, not a live action gated by the
// timetable-approval lock the way attendance marking is.

const classLogRepository = require('../repositories/classLogRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const visibilityService = require('./visibilityService');

class ClassLogValidationError extends Error {}
class ClassLogNotFoundError extends Error {}
class ClassLogForbiddenError extends Error {}

function assertValidFields({ classId, sessionDate, subject, topic }) {
  if (!classId || !sessionDate || !subject || !topic) {
    throw new ClassLogValidationError('classId, sessionDate, subject, and topic are required');
  }
}

async function createLogEntry(client, {
  classId, timetablePeriodId, subject, sessionDate, topic, notes,
}, { actorUserId, actorRole, collegeId }) {
  assertValidFields({
    classId, sessionDate, subject, topic,
  });
  await visibilityService.assertCanViewClass(client, classId, { actorUserId, actorRole, collegeId });

  const entry = await classLogRepository.create(client, {
    collegeId,
    classId,
    timetablePeriodId: timetablePeriodId || null,
    subject,
    sessionDate,
    topic,
    notes: notes || null,
    createdByUserId: actorUserId,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'class_log_created',
    entity: 'class_logs',
    entityId: entry.id,
    metadata: { classId, subject, sessionDate },
  });

  return entry;
}

async function assertOwnsEntry(entry, actorUserId) {
  if (entry.created_by_user_id !== actorUserId) {
    throw new ClassLogForbiddenError(`user ${JSON.stringify(actorUserId)} did not create class log ${JSON.stringify(entry.id)}`);
  }
}

async function updateLogEntry(client, id, { subject, topic, notes }, { actorUserId, collegeId }) {
  const existing = await classLogRepository.findById(client, id);
  if (existing === null) {
    throw new ClassLogNotFoundError(`class log ${JSON.stringify(id)} does not exist`);
  }
  await assertOwnsEntry(existing, actorUserId);
  if (subject === '' || topic === '') {
    throw new ClassLogValidationError('subject and topic may not be cleared to empty');
  }

  const updated = await classLogRepository.update(client, id, { subject, topic, notes });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'class_log_updated',
    entity: 'class_logs',
    entityId: id,
    metadata: {},
  });

  return updated;
}

async function deleteLogEntry(client, id, { actorUserId, collegeId }) {
  const existing = await classLogRepository.findById(client, id);
  if (existing === null) {
    throw new ClassLogNotFoundError(`class log ${JSON.stringify(id)} does not exist`);
  }
  await assertOwnsEntry(existing, actorUserId);

  await classLogRepository.remove(client, id);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'class_log_deleted',
    entity: 'class_logs',
    entityId: id,
    metadata: {},
  });
}

// listLogEntries: classId narrows to one class (still visibility-
// checked); omitting it searches across every class the actor may see
// — the "Teaching Journal" screen's own default view.
async function listLogEntries(client, {
  classId, subject, fromDate, toDate,
}, { actorUserId, actorRole, collegeId }) {
  if (classId) {
    await visibilityService.assertCanViewClass(client, classId, { actorUserId, actorRole, collegeId });
    return classLogRepository.list(client, {
      classId, subject, fromDate, toDate,
    });
  }

  const visibleClassIds = await visibilityService.getVisibleClassIds(client, { actorUserId, actorRole, collegeId });
  if (visibleClassIds !== null && visibleClassIds.length === 0) {
    return [];
  }
  return classLogRepository.list(client, {
    classIds: visibleClassIds === null ? undefined : visibleClassIds,
    subject,
    fromDate,
    toDate,
  });
}

module.exports = {
  ClassLogValidationError,
  ClassLogNotFoundError,
  ClassLogForbiddenError,
  createLogEntry,
  updateLogEntry,
  deleteLogEntry,
  listLogEntries,
};
