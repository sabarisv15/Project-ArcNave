'use strict';

// Faculty allocation (assignFacultyAllocation and friends) is its own
// submodule, not folded into classes.js: Architecture.md 2.5's own
// Business Services table lists "faculty allocation" as part of what
// AcademicService owns, alongside "timetable" — not inferred, stated
// outright. facultyAllocationRepository.js/timetablePeriodRepository.js
// were added purely additively (classes.timetable_data untouched — see
// that slice's .ai/TASK.md) specifically to give AttendanceService's
// "scheduled staff member" gap (attendanceService.js, 82f8479) a real,
// structured link — surfacing the migration's own uniqueness rules as
// domain errors, same pattern as classRepository's own constraints. No
// authorization check on assign/remove: BusinessRules.md names no
// specific actor for "who may assign faculty," unlike "Class Tutor is
// assigned only by HOD" — left to the route/RBAC layer once an API
// exists, not invented here.
//
// getTimetablePeriodByDayAndHour/getFacultyAllocationForClassAndPeriod
// are the two read-only lookups attendanceService.markAttendance
// composes (client, day-of-week, hour_index) -> a shared period ->
// (class, period) -> who's allocated to teach it — to verify
// BusinessRules.md Attendance's third eligible marker, "the staff
// member scheduled for that period." See attendanceService.js for the
// composition; this file only exposes the two lookups it's made of.

const facultyAllocationRepository = require('../../repositories/facultyAllocationRepository');
const timetablePeriodRepository = require('../../repositories/timetablePeriodRepository');
const auditLogRepository = require('../../repositories/auditLogRepository');
const {
  FacultyAllocationValidationError,
  FacultyAllocationClassNotFoundError,
  FacultyAllocationPeriodNotFoundError,
  FacultyAllocationStaffNotFoundError,
  FacultyAllocationPeriodTakenError,
  FacultyAllocationStaffConflictError,
} = require('./errors');

// Assigns a staff member to teach a subject during a specific
// (class, period) slot. No update variant is exposed here — this
// slice's own task names exactly "assign/list/remove," not "update";
// changing an existing allocation is remove-then-assign, not an
// in-place edit, even though facultyAllocationRepository.update exists
// and classRepository's own precedent has a full update path. Nothing
// asked for reassignment-in-place, so it isn't built.
async function assignFacultyAllocation(
  client,
  { collegeId, classId, periodId, subject, staffUserId },
  { actorUserId } = {},
) {
  if (!classId || !periodId || !subject || !staffUserId) {
    throw new FacultyAllocationValidationError('classId, periodId, subject, and staffUserId are required');
  }

  let allocation;
  try {
    allocation = await facultyAllocationRepository.create(client, {
      collegeId,
      classId,
      periodId,
      subject,
      staffUserId,
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'faculty_allocation_class_id_period_id_key') {
      throw new FacultyAllocationPeriodTakenError(
        `class ${JSON.stringify(classId)} already has an allocation for period ${JSON.stringify(periodId)}`,
      );
    }
    if (err.code === '23505' && err.constraint === 'faculty_allocation_period_id_staff_user_id_key') {
      throw new FacultyAllocationStaffConflictError(
        `staffUserId ${JSON.stringify(staffUserId)} is already teaching another class during period ${JSON.stringify(periodId)}`,
      );
    }
    if (err.code === '23503' && err.constraint === 'faculty_allocation_class_id_fkey') {
      throw new FacultyAllocationClassNotFoundError(`classId ${JSON.stringify(classId)} does not exist`);
    }
    if (err.code === '23503' && err.constraint === 'faculty_allocation_period_id_fkey') {
      throw new FacultyAllocationPeriodNotFoundError(`periodId ${JSON.stringify(periodId)} does not exist`);
    }
    if (err.code === '23503' && err.constraint === 'faculty_allocation_staff_user_id_fkey') {
      throw new FacultyAllocationStaffNotFoundError(`staffUserId ${JSON.stringify(staffUserId)} does not exist`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'faculty_allocation_assigned',
    entity: 'faculty_allocation',
    entityId: allocation.id,
    metadata: null,
  });

  return allocation;
}

// null means no allocation exists with this id — not an error. The
// route turns that into 404, same as getClass.
async function getFacultyAllocation(client, id) {
  return facultyAllocationRepository.findById(client, id);
}

// A class's full teaching schedule — every period it has a real
// subject/staff assignment for.
async function listFacultyAllocationsForClass(client, classId) {
  return facultyAllocationRepository.findByClassId(client, classId);
}

// A staff member's full teaching schedule — the real, structured link
// AttendanceService's own "scheduled staff member" gap needed (see
// attendanceService.js, 82f8479 for where it was flagged, and its
// later patch for where it's actually wired in).
async function listFacultyAllocationsForStaff(client, staffUserId) {
  return facultyAllocationRepository.findByStaffUserId(client, staffUserId);
}

// null means no shared period exists for that (college, day, hour) —
// not an error, same convention as every other getX in this file.
// This is the lookup attendanceService.markAttendance uses to resolve
// a calendar date + hour_index into the shared timetable_periods row
// before it can ask "who's allocated to teach this class then." Named
// ...ByDayAndHour, not the bare getTimetablePeriod(id) shape
// services/academic/timetablePeriods.js's own getTimetablePeriod uses,
// specifically to leave that simpler name free for the plain by-id
// lookup there — this one takes three arguments and answers a
// different question ("does a period exist for this slot") than
// "fetch this known period."
async function getTimetablePeriodByDayAndHour(client, collegeId, dayOfWeek, hourIndex) {
  return timetablePeriodRepository.findByCollegeDayAndHour(client, collegeId, dayOfWeek, hourIndex);
}

// null means no allocation exists for that (class, period) — not an
// error. The other half of the same lookup: once a period is
// resolved, this answers "which staff member (if any) is allocated to
// teach this specific class during it."
async function getFacultyAllocationForClassAndPeriod(client, classId, periodId) {
  return facultyAllocationRepository.findByClassAndPeriod(client, classId, periodId);
}

// Looks the allocation up first, both to get collegeId for the audit
// entry (this function takes no collegeId of its own, matching
// removeClass's signature) and to avoid logging a removal for an id
// that never existed. Hard DELETE, not soft-delete: neither
// faculty_allocation nor timetable_periods is named by
// BusinessRules.md's AI hard-delete restriction the way
// attendance_sessions is — same open-question treatment
// students/staff/classes already got.
async function removeFacultyAllocation(client, id, { actorUserId } = {}) {
  const allocation = await facultyAllocationRepository.findById(client, id);
  if (allocation === null) {
    return null;
  }

  await facultyAllocationRepository.remove(client, id);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: allocation.college_id,
    userId: actorUserId,
    action: 'faculty_allocation_removed',
    entity: 'faculty_allocation',
    entityId: id,
    metadata: null,
  });

  return allocation;
}

module.exports = {
  assignFacultyAllocation,
  getFacultyAllocation,
  listFacultyAllocationsForClass,
  listFacultyAllocationsForStaff,
  getTimetablePeriodByDayAndHour,
  getFacultyAllocationForClassAndPeriod,
  removeFacultyAllocation,
};
