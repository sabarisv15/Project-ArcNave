'use strict';

// Send Alert (item 5 of this session's task): a tutor sending a plain-
// text WhatsApp message to every student in their OWN class, plus
// whichever of that student's/their parent's numbers are WhatsApp-
// verified (phone_verified/parent_phone_verified — see
// phoneVerificationService.js). Deliberately NOT routed through
// WorkflowService — this is the one explicitly documented exception to
// "every outbound notification requires approval" (BusinessRules.md's
// Notifications section, AI-Governance.md's L3 "Act" table): a human
// tutor directly messaging students already enrolled in their own
// class, with plain free-text content and no AI involvement, is
// structurally the same kind of action AI-Governance.md already
// carves out for a staff member marking attendance directly through
// the dashboard — not an AI action, so L3's "always required, no
// exceptions" language never applies to it in the first place. Scoped
// tightly on purpose (own class only, human-sent only, plain text
// only): any future variant (AI-drafted content, cross-class blasts,
// rich content) is a different feature that DOES need
// draftNotification/submitForApproval, not an extension of this one.

const classRepository = require('../../repositories/classRepository');
const facultyAllocationRepository = require('../../repositories/facultyAllocationRepository');
const studentRepository = require('../../repositories/studentRepository');
const auditLogRepository = require('../../repositories/auditLogRepository');
const identityService = require('../identityService');
const notificationService = require('../notificationService');
const visibilityService = require('../visibilityService');
const { listFacultyAllocationsForClass } = require('./facultyAllocation');
const { listClasses } = require('./classes');
const { ClassSendAlertValidationError, ClassSendAlertNotAssignedError } = require('./errors');

// Per-recipient, best-effort, no retry/fallback (this session's own
// task: "no auto-retry or channel fallback") — matches
// notificationService.sendViaChannel's own best-effort philosophy for
// every other channel in this codebase. A student with neither number
// verified is simply absent from the result list, not a failure.
// 4-login authorization architecture (2026-08-09): this function
// combines two genuinely different authorities that must not be
// conflated —
//   1. Staff-level: any staff currently timetable-assigned to this
//      class (isAssignedFaculty, ADL-024/RS-NTF-007) — ordinary
//      instructional communication ("bring your record tomorrow"),
//      unconditional on actorRole, exactly as before.
//   2. L4-level: the class's own tutor sending on tutor authority
//      alone, independent of any subject/period assignment — this leg
//      now additionally requires actorRole === 'class_tutor' (the
//      CURRENT LOGIN's identity), since Position Occupancy
//      (resolvePositionOccupant matching actorUserId) is informational
//      only and must not itself grant this on a personal Staff login.
// A personal Staff login who is also the tutor is therefore unaffected
// as long as they're timetable-assigned to the class (leg 1 still
// applies); they lose only the tutor-only reach leg 2 used to grant.
async function sendClassAlert(client, classId, body, { actorUserId, actorRole } = {}) {
  if (!body) {
    throw new ClassSendAlertValidationError('body is required');
  }

  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new ClassSendAlertValidationError(`class ${JSON.stringify(classId)} does not exist`);
  }
  // Phase 2 step 13: classes.tutor_user_id -> the Position/Account/
  // Occupant model, same swap workflowChainService's 'tutor' resolution
  // already made (step 11) — identityService.resolvePositionOccupant's
  // {classId} overload (Phase 2 step 9) is the one entry point, never a
  // direct positionRepository/resolver call of this file's own.
  //
  // ADL-024/RS-NTF-007 (2026-07-30): authority widened from "tutor
  // only" to "any staff currently timetable-assigned to this class" —
  // a tutor is definitionally assigned to their own class, so the
  // tutor check stays as the cheap first path, and any subject/period
  // faculty_allocation row for this class (listFacultyAllocationsForClass,
  // this same directory's own wrapper around facultyAllocationRepository —
  // never the repository directly) is the second, structural path. No
  // fuzzy/self-declared assignment — same "real data, not a heuristic"
  // reasoning assertCanMark's own faculty-allocation check already
  // documents.
  const tutorUserId = await identityService.resolvePositionOccupant(client, { collegeId: cls.college_id, classId });
  const isTutor = tutorUserId !== null && tutorUserId === actorUserId && actorRole === 'class_tutor';
  if (!isTutor) {
    const allocations = await listFacultyAllocationsForClass(client, classId);
    const isAssignedFaculty = allocations.some((allocation) => allocation.staff_user_id === actorUserId);
    if (!isAssignedFaculty) {
      throw new ClassSendAlertNotAssignedError(
        `user ${JSON.stringify(actorUserId)} is not the tutor or assigned faculty of class ${JSON.stringify(classId)}`,
      );
    }
  }

  const students = await studentRepository.findByClassId(client, classId);

  const results = [];
  for (const student of students) {
    const recipients = [
      { target: 'phone', verified: student.phone_verified, phone: student.phone },
      { target: 'parent_phone', verified: student.parent_phone_verified, phone: student.parent_phone },
    ].filter((r) => r.verified && r.phone);

    for (const recipient of recipients) {
      // eslint-disable-next-line no-await-in-loop
      const sendResult = await notificationService.sendViaChannel(client, {
        collegeId: cls.college_id,
        channel: 'whatsapp',
        to: recipient.phone,
        body,
      });
      results.push({
        studentId: student.id,
        target: recipient.target,
        phone: recipient.phone,
        status: sendResult.status,
        error: sendResult.error || null,
      });
    }
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: actorUserId,
    action: 'class_alert_sent',
    entity: 'classes',
    entityId: classId,
    metadata: {
      recipientCount: results.length,
      sentCount: results.filter((r) => r.status === 'sent').length,
    },
  });

  return results;
}

// Same pragmatic hardcoded-limit convention reportService.js's own
// STUDENT_EXPORT_LIMIT already uses — a college with more classes than
// this gets a truncated college-wide timetable read, a flagged gap,
// not silently wrong data.
const CLASS_TIMETABLE_SCOPE_LIMIT = 500;

// academic_class_timetable (AI tool): scope-aware "my classes'
// timetable" read. Resolves the actor's own visible classIds via
// visibilityService.getVisibleClassIds — the one shared resolver
// analyticsService.getAttendanceRateForActor/assessmentService.
// listMarksForActor already use identically — never a caller-supplied
// classId/departmentId. null from getVisibleClassIds means
// "unrestricted" (principal), so every class in the college is
// enumerated via listClasses rather than treated as an empty filter.
// actorInput: either the legacy {actorUserId, actorRole, collegeId}
// shape or an already-built ActorContext (Phase 4 Group (a)) —
// forwarded straight into getVisibleClassIds unchanged either way; see
// analyticsService.getAttendanceRateForActor's own comment.
async function getClassTimetableForActor(client, actorInput) {
  const classIds = await visibilityService.getVisibleClassIds(client, actorInput);

  // Principal path (classIds === null): listClasses already returns the
  // full class rows in one query — reuse them directly instead of
  // discarding className/etc. and re-fetching each row individually
  // below. Scoped-actor path: only ids are known yet, so a single batch
  // fetch resolves them. Either way, at most one class-row query total,
  // never one per class.
  let targetClassIds;
  let classesById;
  if (classIds === null) {
    const classes = await listClasses(client, { limit: CLASS_TIMETABLE_SCOPE_LIMIT });
    targetClassIds = classes.map((cls) => cls.id);
    classesById = new Map(classes.map((cls) => [cls.id, cls]));
  } else {
    targetClassIds = classIds;
    classesById = new Map((await classRepository.findByIds(client, targetClassIds)).map((cls) => [cls.id, cls]));
  }
  if (targetClassIds.length === 0) {
    return [];
  }

  const allocations = await facultyAllocationRepository.findByClassIds(client, targetClassIds);
  const allocationsByClassId = new Map();
  for (const allocation of allocations) {
    const list = allocationsByClassId.get(allocation.class_id);
    if (list) {
      list.push(allocation);
    } else {
      allocationsByClassId.set(allocation.class_id, [allocation]);
    }
  }

  return targetClassIds.map((classId) => {
    const cls = classesById.get(classId);
    return {
      classId,
      className: cls ? cls.class_name : null,
      allocations: allocationsByClassId.get(classId) || [],
    };
  });
}

module.exports = {
  sendClassAlert,
  getClassTimetableForActor,
};
