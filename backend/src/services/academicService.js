'use strict';

// Business logic for Module 3's `classes` table — validation and
// audit logging on top of classRepository.js, which does neither
// (CLAUDE.md rule 1: AI tools call Business Services, never
// repositories directly — this file is what makes that possible for
// classes).
//
// This slice is plain CRUD + validation, same shape as
// staffService.js's second slice: no HOD/Principal review-chain
// transition logic ('Pending HOD' -> 'Approved'/'Pending
// Principal'/'Rejected', per HodDashboard.jsx/PrincipalDashboard.jsx's
// handleTimetableReview) is enforced here beyond validating that a
// given timetableStatus is one of the known literals. CLAUDE.md rule
// 3: WorkflowService is the sole approval gate, and it doesn't exist
// yet (Roadmap.md builds Workflow/Notifications after Attendance/
// Finance/Documents/Reports) — same "out of scope here, not stubbed"
// reasoning studentService.js used for the HOD-override exception.
// "Class Tutor is assigned only by HOD" (BusinessRules.md Staff) is an
// authorization rule, left to the route/RBAC layer once Module 3's API
// exists, matching staffService.js's precedent for "only HOD/Principal
// may add staff."
//
// Faculty allocation (assignFacultyAllocation and friends) lives in
// this same file, not a new service: Architecture.md 2.5's own
// Business Services table lists "faculty allocation" as part of what
// AcademicService owns, alongside "timetable" — not inferred, stated
// outright. facultyAllocationRepository.js/timetablePeriodRepository.js
// were added purely additively (classes.timetable_data untouched — see
// that slice's .ai/TASK.md) specifically to give AttendanceService's
// "scheduled staff member" gap (attendanceService.js, 82f8479) a real,
// structured link — surfacing the migration's own uniqueness rules as
// domain errors, same pattern as classRepository's own constraints
// above. No authorization check on assign/remove: BusinessRules.md
// names no specific actor for "who may assign faculty," unlike "Class
// Tutor is assigned only by HOD" — left to the route/RBAC layer once
// an API exists, not invented here.
//
// getTimetablePeriod/getFacultyAllocationForClassAndPeriod are the two
// read-only lookups attendanceService.markAttendance now composes
// (client, day-of-week, hour_index) -> a shared period ->
// (class, period) -> who's allocated to teach it — to verify
// BusinessRules.md Attendance's third eligible marker, "the staff
// member scheduled for that period." See attendanceService.js for the
// composition; this file only exposes the two lookups it's made of.

const { randomUUID } = require('crypto');
const classRepository = require('../repositories/classRepository');
const facultyAllocationRepository = require('../repositories/facultyAllocationRepository');
const timetablePeriodRepository = require('../repositories/timetablePeriodRepository');
const timetableRevisionRepository = require('../repositories/timetableRevisionRepository');
const substituteAssignmentRepository = require('../repositories/substituteAssignmentRepository');
const substituteAssignmentRequestRepository = require('../repositories/substituteAssignmentRequestRepository');
const substituteAssignmentAcknowledgementRepository = require('../repositories/substituteAssignmentAcknowledgementRepository');
const authRepository = require('../repositories/authRepository');
const visibilityService = require('./visibilityService');

// Calendar order for a free-text day_of_week column (see
// timetablePeriodRepository.findAllByCollege's own comment) — a
// six-day working week, matching the CSV import slice's own existing
// day-name literals, not a guess. Sunday is deliberately absent: no
// existing timetable data in this codebase (CSV import, manual period
// creation) ever names it as a teaching day.
const WEEKDAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Same UTC-based day-name resolution as attendanceService.dayOfWeekName
// (index 0 = Sunday, matching Date.getUTCDay()) — deliberately not
// duplicated as a shared util; this file has no dependency on
// attendanceService (the reverse dependency exists, not this
// direction), so the seven-name array is repeated here rather than
// introducing a new shared module for one small constant.
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// RS-TTB-001's own plain-HH:MM(:SS) time arithmetic — timetable_periods.
// start_time/end_time come back from pg as 'HH:MM:SS' strings (a `time`
// column), so this stays string parsing, not a Date object, same
// "avoid a server-local-timezone rollover bug" tradeoff resolveCurrentSessionForStaff's
// own comment documents for date-only parsing elsewhere in this file.
function timeToMinutes(value) {
  const [h, m] = value.split(':').map(Number);
  return (h * 60) + m;
}

function minutesToTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

// Guards against a period row with no start_time/end_time (every
// pre-RS-TTB-001 caller/test's fixture only ever set day_of_week/
// hour_index) — treated as zero duration rather than a crash, since
// nothing about "how long is this period" was ever guaranteed before
// this slice added a real consumer of it.
function periodDurationHours(period) {
  if (!period || !period.start_time || !period.end_time) return 0;
  return (timeToMinutes(period.end_time) - timeToMinutes(period.start_time)) / 60;
}
const studentRepository = require('../repositories/studentRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const documentService = require('./documentService');
const workflowService = require('./workflowService');
const workflowChainService = require('./workflowChainService');
const importService = require('./importService');
const staffService = require('./staffService');
const notificationService = require('./notificationService');
const identityService = require('./identityService');
const { isUuid, IdentifierResolutionError } = require('../identifierResolution');

// resolveClassId: mirrors studentService.resolveStudentId/
// staffService.resolveStaffId — given either a real class id or a
// human-readable class_name, returns the real id, or throws
// IdentifierResolutionError if neither resolves within this college.
// Same motivation: an AI Copilot caller only has a class name to go
// on (e.g. "CSE-A"), never the internal id.
async function resolveClassId(client, collegeId, identifier) {
  if (isUuid(identifier)) {
    return identifier;
  }
  const cls = await classRepository.findByCollegeAndClassName(client, collegeId, identifier);
  if (cls === null) {
    throw new IdentifierResolutionError(
      `no class found named ${JSON.stringify(identifier)} in this college`,
    );
  }
  return cls.id;
}

// Missing className — classes.class_name is NOT NULL at the DB level.
// Raised before any repository call, same as staffService's pre-query
// guard.
class ClassValidationError extends Error {}

// The Module 3 migration's own comment names this exact gap:
// timetable_status has no DB-level CHECK constraint, "known real
// values, enforced at the service layer once AcademicService exists,
// not the DB" — this is that enforcement. The literal set matches what
// HodDashboard.jsx/PrincipalDashboard.jsx/TutorClass.jsx actually use,
// not a guess.
class ClassTimetableStatusError extends Error {}

// UNIQUE (college_id, class_name) violated (Postgres 23505,
// classes_college_id_class_name_key) — this class name is already
// taken in this college. Never let the raw pg error reach the caller,
// same discipline as StaffCodeConflictError.
class ClassNameConflictError extends Error {}

// A class already has an active Class Tutor — thrown by
// classTutorService.assignClassTutor (Phase 2 step 18) when called on
// a class that already has one (use reassignClassTutor instead).
// BusinessRules.md Staff: "Class Tutor is assigned only by HOD, for one
// class at a time" — this is that rule's enforcement, previously the
// classes_tutor_user_id_key UNIQUE violation's domain error before the
// Position/Account/Occupant model replaced classes.tutor_user_id
// entirely; same error class and HTTP mapping (409) reused from the new
// call site so routes/classes.js's mapAcademicServiceError needs no
// change.
class ClassTutorConflictError extends Error {}

// newTutorUserId doesn't exist in users — thrown by
// classTutorService.assignClassTutor/reassignClassTutor (Phase 2 step
// 18) on a position_occupants_user_id_fkey violation. Previously the
// classes_tutor_user_id_fkey violation's domain error before the
// Position/Account/Occupant model replaced classes.tutor_user_id
// entirely; same error class and HTTP mapping (404) reused.
class ClassTutorNotFoundError extends Error {}

// classes_department_id_fkey (classes.department_id -> departments.id)
// violated (Postgres 23503) — the given departmentId doesn't exist.
// Same precedent as ClassTutorNotFoundError.
class ClassDepartmentNotFoundError extends Error {}

// Module 3->4 gap fix: 'Pending HOD'/'Pending Principal'/'Approved'/
// 'Rejected' are workflow-governed states now — reachable only via
// submitTimetableForApproval/approveTimetableApproval/
// rejectTimetableApproval, never a direct updateClass PATCH. That
// direct path was the exact "raw UPDATE... to reach the 'Approved'
// branch at all" workaround attendanceService.js's own comments (and
// tests/attendance.test.js's admin-pool seeding) already named as the
// only way to unlock attendance marking today. 'No Tutor' is the one
// literal still directly settable — it is not a step in the approval
// chain, just the "nothing submitted yet" default.
class ClassTimetableStatusManagedByWorkflowError extends Error {}

// submitTimetableForApproval/approveTimetableApproval/
// rejectTimetableApproval given a classId with no live Pending
// 'timetable_approval' workflow_requests row (never submitted, or
// already resolved) — same "required lookup, not an optional fetch"
// shape as staffService.StaffRegistrationNotPendingError.
class ClassTimetableApprovalNotPendingError extends Error {}

// Missing classId, timetablePeriodId, assignmentDate, or
// substituteStaffUserId — the columns BusinessRules.md's Substitute
// teacher provision names as always required (period, substitute,
// date), regardless of what the DB itself would accept as NULL.
class SubstituteAssignmentValidationError extends Error {}

// substitute_assignments_timetable_period_id_fkey (Postgres 23503) —
// the given timetablePeriodId doesn't exist.
class SubstituteAssignmentPeriodNotFoundError extends Error {}

// substitute_assignments_class_period_date_key violated (Postgres
// 23505) — this exact (class, period, date) slot already has a
// substitute assigned.
class SubstituteAssignmentConflictError extends Error {}

// RS-CLS-007: "the absent staff member, L3, or the class's L4 may
// initiate the request" — actorUserId is none of those three.
class SubstituteAssignmentNotAuthorizedError extends Error {}

// requestSubstituteAssignment's substituteStaffUserId doesn't resolve
// to a real staff row.
class SubstituteAssignmentCandidateNotFoundError extends Error {}

// RS-CLS-007 (widened 2026-08-04, ADL-031): the named substitute isn't
// in the same department as the class needing coverage.
class SubstituteAssignmentCandidateNotInDepartmentError extends Error {}

// RS-CLS-007 (widened 2026-08-04, ADL-031): the named substitute
// already has a class of their own (regular allocation or another
// substitute duty) during this exact period/date — not a free hour.
class SubstituteAssignmentCandidateNotFreeError extends Error {}

// approveSubstituteAssignment/rejectSubstituteAssignment given a
// requestId with no matching substitute_assignment_requests row.
class SubstituteAssignmentRequestNotFoundError extends Error {}
class SubstituteAssignmentNotFoundError extends Error {}

// Missing classId or a non-empty requirements array, or a requirement
// missing subject/staffUserId/periodsPerWeek — generateTimetable's own
// required inputs (BusinessRules.md Automatic timetable generation:
// "after faculty members are assigned to subjects" — this function's
// requirements array IS that assignment, supplied by the caller; there
// is no separate "subject roster" table in this schema to derive it
// from automatically, a real, flagged gap, not silently worked around).
class TimetableGenerationValidationError extends Error {}

// generateTimetable called on a class whose timetable_status is
// already 'Approved' — BusinessRules.md Timetable revision: "an
// approved timetable is immutable." Regenerating on top of an approved
// timetable would be exactly the kind of unlogged, unversioned change
// that rule exists to prevent; a permanent change belongs in a new
// revision via the ordinary submit/approve chain, not a silent
// re-generation.
class TimetableGenerationClassApprovedError extends Error {}

// RS-TTB-001: generateTimetable/reviseTimetable called by a 'staff'
// actor who is not this class's own tutor (identityService.
// resolvePositionOccupant) — the same "you are not allowed" 403 shape
// ClassSendAlertNotAssignedError already gives sendClassAlert. Only
// enforced when actorRole is explicitly 'staff' (see generateTimetable's
// own comment) — principal/hod callers, and every existing internal/
// test caller that never passed a role, are unaffected.
class TimetableGenerationForbiddenError extends Error {}

// generateSlotGrid given a missing/empty workingDays, missing start/end
// time, a non-positive slotDurationMinutes, an unrecognized day name,
// or a start/end pair that leaves no room for a single slot —
// RS-TTB-001 Section 1's own required inputs.
class TimetableConfigValidationError extends Error {}

// Missing classId, periodId, subject, or staffUserId —
// faculty_allocation.class_id/period_id/subject are NOT NULL at the
// DB level; staffUserId is nullable at the DB level (a non-teaching
// slot like "Lunch"/"Library" can have a subject with no staff), but
// this function is specifically "assign *a staff member's*
// allocation" (per this slice's own task) — recording a non-teaching
// slot with no staff is a different, unaddressed operation, not built
// here, so staffUserId is required at this layer even though the DB
// itself would accept NULL.
class FacultyAllocationValidationError extends Error {}

// faculty_allocation_class_id_fkey violated (Postgres 23503) — the
// given classId doesn't exist. Same precedent as ClassTutorNotFoundError.
class FacultyAllocationClassNotFoundError extends Error {}

// faculty_allocation_period_id_fkey violated (Postgres 23503) — the
// given periodId doesn't exist in timetable_periods.
class FacultyAllocationPeriodNotFoundError extends Error {}

// faculty_allocation_staff_user_id_fkey violated (Postgres 23503) —
// the given staffUserId doesn't exist in users.
class FacultyAllocationStaffNotFoundError extends Error {}

// UNIQUE (class_id, period_id) violated (Postgres 23505,
// faculty_allocation_class_id_period_id_key) — this class already has
// a subject/staff assignment for this period. A class can't have two
// simultaneous subjects in one hour, the same real-world fact the
// free-text timetable grid already enforced implicitly (one cell, one
// value) — see the migration's own .ai/TASK.md.
class FacultyAllocationPeriodTakenError extends Error {}

// UNIQUE (period_id, staff_user_id) violated (Postgres 23505,
// faculty_allocation_period_id_staff_user_id_key) — this staff member
// is already teaching a different class during this exact period. The
// same "one row can't represent two conflicting real-world facts"
// reasoning ClassTutorConflictError already applies to tutor
// assignment, extended here to double-booking a teacher.
class FacultyAllocationStaffConflictError extends Error {}

// Missing dayOfWeek, hourIndex, startTime, or endTime —
// timetable_periods' own NOT NULL columns. Raised before any
// repository call, same as every other pre-query guard in this file.
class TimetablePeriodValidationError extends Error {}

// UNIQUE (college_id, day_of_week, hour_index) violated (Postgres
// 23505, timetable_periods_college_id_day_of_week_hour_index_key) —
// this college already has a period defined for this exact
// day+hour slot.
class TimetablePeriodSlotTakenError extends Error {}

// faculty_allocation_period_id_fkey violated (Postgres 23503) on a
// DELETE against timetable_periods — this period still has one or
// more faculty_allocation rows referencing it. The FK has no ON
// DELETE override (house convention, see the migration's own
// .ai/TASK.md), so Postgres's default RESTRICT raises this rather
// than silently cascading — surfaced as a domain error instead of a
// raw pg one, same discipline as every other constraint in this file.
class TimetablePeriodInUseError extends Error {}
class TimetableImportError extends Error {}

// sendClassAlert given a classId with no matching row, or an empty
// body — same "guard before any work" reasoning every other
// pre-repository-call check in this file uses.
class ClassSendAlertValidationError extends Error {}

// sendClassAlert called by a user who is neither this class's tutor
// nor timetable-assigned faculty for it (ADL-024/RS-NTF-007 widened
// the exemption from tutor-only to any assigned staff, 2026-07-30). A
// distinct error (not ClassValidationError) because it's a 403, not a
// 400 — "you are not allowed" is a different kind of failure than "the
// request itself is malformed," same split classes.js's route layer
// already makes between mapAcademicServiceError's 400s and
// requirePermission's own 403s.
class ClassSendAlertNotAssignedError extends Error {}

// Known real timetable_status values, per the migration's own comment
// and .ai/TASK.md's grounding against TutorClass.jsx/
// TutorClassMonitor.jsx.
const VALID_TIMETABLE_STATUSES = [
  'No Tutor',
  'Pending HOD',
  'Pending Principal',
  'Approved',
  'Rejected',
];

// The fields this service accepts for create/update, deliberately
// listed here rather than trusting classRepository's own COLUMNS
// whitelist to be the only line of defense — same defense-in-depth
// reasoning as studentService.js/staffService.js's own ALLOWED_FIELDS.
// collegeId is excluded: a class's tenant is set once at creation and
// never moves via update, same as students/staff. tutorUserId dropped
// in Phase 2 step 18 — classTutorService.assignClassTutor/
// reassignClassTutor supersede createClass/updateClass's former
// implicit tutorUserId mutation entirely.
const ALLOWED_FIELDS = [
  'className',
  'department',
  'departmentId',
  'semester',
  'timetableStatus',
  'timetableData',
  'timetableRemarks',
  'maxHoursPerDayPerStaff',
];

function pickClassFields(source) {
  const result = {};
  for (const key of ALLOWED_FIELDS) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

// Phase 2 step 18: tutorUserId is no longer accepted by createClass/
// updateClass at all — a caller-supplied value is now an explicit 400,
// not a silent no-op (dropping it via ALLOWED_FIELDS alone would look
// like it worked). Use classTutorService.assignClassTutor/
// reassignClassTutor (routed through POST/PUT /classes/:id/tutor)
// instead — a genuinely different actor set (HOD-only, own-department)
// than the rest of this file's principal-only create/update.
function assertNoTutorUserIdInFields(fields) {
  if (fields.tutorUserId !== undefined) {
    throw new ClassValidationError(
      'tutorUserId can no longer be set via this endpoint — use POST /classes/:id/tutor (assign) or PUT /classes/:id/tutor (reassign) instead',
    );
  }
}

function assertValidTimetableStatus(timetableStatus) {
  if (timetableStatus !== undefined && !VALID_TIMETABLE_STATUSES.includes(timetableStatus)) {
    throw new ClassTimetableStatusError(
      `timetableStatus ${JSON.stringify(timetableStatus)} is not a known value`,
    );
  }
}

async function createClass(client, { collegeId, className, ...rest }, { actorUserId } = {}) {
  if (!className) {
    throw new ClassValidationError('className is required');
  }
  assertNoTutorUserIdInFields(rest);
  assertValidTimetableStatus(rest.timetableStatus);

  let cls;
  try {
    cls = await classRepository.create(client, {
      collegeId,
      className,
      ...pickClassFields(rest),
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'classes_college_id_class_name_key') {
      throw new ClassNameConflictError(`className ${JSON.stringify(className)} already exists for this college`);
    }
    if (err.code === '23503' && err.constraint === 'classes_department_id_fkey') {
      throw new ClassDepartmentNotFoundError(`departmentId ${JSON.stringify(rest.departmentId)} does not exist`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'class_created',
    entity: 'classes',
    entityId: cls.id,
    metadata: null,
  });

  return cls;
}

// null means no class exists with this id — not an error. The route
// turns that into 404, same as staffService.getStaff.
async function getClass(client, id) {
  return classRepository.findById(client, id);
}

const WORKFLOW_MANAGED_TIMETABLE_STATUSES = ['Pending HOD', 'Pending Principal', 'Approved', 'Rejected'];

async function updateClass(client, id, fields, { userId }) {
  assertNoTutorUserIdInFields(fields);
  const patch = pickClassFields(fields);
  assertValidTimetableStatus(patch.timetableStatus);
  if (WORKFLOW_MANAGED_TIMETABLE_STATUSES.includes(patch.timetableStatus)) {
    throw new ClassTimetableStatusManagedByWorkflowError(
      `timetableStatus ${JSON.stringify(patch.timetableStatus)} can only be reached via submitTimetableForApproval/approveTimetableApproval/rejectTimetableApproval, not a direct update`,
    );
  }
  const hasChanges = Object.keys(patch).length > 0;

  let cls;
  try {
    cls = await classRepository.update(client, id, patch);
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'classes_college_id_class_name_key') {
      throw new ClassNameConflictError(`className ${JSON.stringify(patch.className)} already exists for this college`);
    }
    if (err.code === '23503' && err.constraint === 'classes_department_id_fkey') {
      throw new ClassDepartmentNotFoundError(`departmentId ${JSON.stringify(patch.departmentId)} does not exist`);
    }
    throw err;
  }

  // hasChanges guards the no-op case (fields had nothing recognized —
  // classRepository.update falls back to a plain findById then). cls
  // !== null guards the id-not-found case. Either way, no row was
  // actually changed, so no audit entry.
  if (hasChanges && cls !== null) {
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId: cls.college_id,
      userId,
      action: 'class_updated',
      entity: 'classes',
      entityId: id,
      metadata: null,
    });
  }

  return cls;
}

// Looks the class up first, both to get collegeId for the audit entry
// (removeClass's signature, matching staffService.removeStaff, takes
// no collegeId of its own) and to avoid logging a removal for an id
// that never existed. Still a hard DELETE, not a soft-delete: the ERD
// has no soft-delete column yet — same open question flagged for
// students/staff, not resolved here either.
async function removeClass(client, id, { userId }) {
  const cls = await classRepository.findById(client, id);
  if (cls === null) {
    return null;
  }

  await classRepository.remove(client, id);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId,
    action: 'class_removed',
    entity: 'classes',
    entityId: id,
    metadata: null,
  });

  return cls;
}

async function listClasses(client, { limit, offset } = {}) {
  return classRepository.list(client, { limit, offset });
}

// RS-CLS-001/RS-CLS-002: "A class is auto-generated the moment a
// department is created... one class per (year-within-department ×
// section) combination, for every year after the first." Called by
// collegeProfileService.createDepartment (L1, post-onboarding) and
// platformService.createDepartmentAtOnboarding (Platform Admin) right
// after the department row itself is created — never invoked on its
// own from a route, since a department without generated classes is
// not a state this rule allows to exist.
//
// courseDuration/defaultSections are both required here, not defaulted:
// per product decision, there is no platform-wide section-count
// default — the department's own creator must specify it, so a
// caller missing either is a caller bug (should have required it
// before ever reaching here), not a business-data gap to paper over
// silently.
//
// Year 1 is permanently excluded (RS-CLS-001, a platform invariant,
// not configurable) — in-scope years run from 2 to courseDuration
// inclusive. One academic year = two semesters (RS-CLS-002's own
// Progression row), so year Y covers semester numbers (Y-1)*2+1 and
// (Y-1)*2+2 — e.g. year 2 of a 4-year course covers semesters 3-4,
// year 4 covers semesters 7-8. Section labels are plain A, B, C...
// (String.fromCharCode), matching the rule's own "two sections" example
// wording, not a stored label of their own.
//
// Reuses createClass unchanged for each row (conflict mapping, audit
// logging) rather than a bespoke bulk-insert — generation differs from
// an ordinary create only in how many rows and what className/semester
// values are computed, not in what a "created class" means.
class ClassGenerationValidationError extends Error {}

function sectionLabel(index) {
  return String.fromCharCode(65 + index);
}

async function generateClassesForDepartment(client, {
  departmentId, collegeId, name, courseDuration, defaultSections,
}, { actorUserId } = {}) {
  if (!Number.isInteger(courseDuration) || courseDuration < 2) {
    throw new ClassGenerationValidationError(
      `courseDuration must be an integer of at least 2 (year 1 is always out of scope — RS-CLS-001), got ${JSON.stringify(courseDuration)}`,
    );
  }
  if (!Number.isInteger(defaultSections) || defaultSections < 1) {
    throw new ClassGenerationValidationError(
      `defaultSections must be a positive integer, got ${JSON.stringify(defaultSections)}`,
    );
  }

  const created = [];
  for (let year = 2; year <= courseDuration; year += 1) {
    const semesters = [(year - 1) * 2 + 1, (year - 1) * 2 + 2];
    for (const semesterNumber of semesters) {
      for (let sectionIndex = 0; sectionIndex < defaultSections; sectionIndex += 1) {
        const section = sectionLabel(sectionIndex);
        // eslint-disable-next-line no-await-in-loop
        const cls = await createClass(client, {
          collegeId,
          className: `${name} Sem ${semesterNumber} ${section}`,
          department: name,
          departmentId,
          semester: String(semesterNumber),
        }, { actorUserId });
        created.push(cls);
      }
    }
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'department_classes_generated',
    entity: 'departments',
    entityId: departmentId,
    metadata: { classCount: created.length, courseDuration, defaultSections },
  });

  return created;
}

// Module 3->4 gap fix: BusinessRules.md/HodDashboard.jsx/
// PrincipalDashboard.jsx's own timetable review chain ('Pending HOD'
// -> 'Approved'/'Pending Principal'/'Rejected') modeled as a 2-step
// approver_chain through the one real WorkflowService gate (CLAUDE.md
// rule 3/ADR-005), same shape as staffService.submitStaffRegistration:
// HOD (of the class's own department) then Principal, both resolved
// from real data via staffService.findHodForDepartment/findPrincipal,
// never hardcoded. No parallel approval mechanism — this is the same
// generic workflow_requests table/submitRequest every other approval
// already routes through, just a new entityType.
async function submitTimetableForApproval(client, classId, { requestedByUserId, origin = 'human' } = {}) {
  if (!requestedByUserId) {
    throw new ClassValidationError('requestedByUserId is required');
  }

  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new ClassValidationError(`class ${JSON.stringify(classId)} does not exist`);
  }
  if (!cls.department_id) {
    throw new ClassValidationError(`class ${JSON.stringify(classId)} has no departmentId set, cannot resolve an hod approver`);
  }

  // BusinessRules.md Configurable approval workflow: reads the
  // institution's own configured chain for 'timetable_approval'
  // (category 'workflow_chains'), falling back to the same hod->principal
  // default this codebase always used — an institution that hasn't
  // configured anything sees identical behavior to before this slice.
  const approverChain = await workflowChainService.resolveApproverChain(client, {
    collegeId: cls.college_id, entityType: 'timetable_approval', classId: cls.id, departmentId: cls.department_id,
  });

  const request = await workflowService.submitRequest(client, {
    collegeId: cls.college_id,
    entityType: 'timetable_approval',
    entityId: cls.id,
    requestedByUserId,
    origin,
    approverChain,
  });

  await classRepository.update(client, classId, { timetableStatus: 'Pending HOD' });

  return request;
}

// Shared load+validate for approve/reject: the class must exist, and
// exactly one live Pending 'timetable_approval' workflow_requests row
// must govern it — same shape as staffService.loadPendingRegistration.
async function loadPendingTimetableApproval(client, classId) {
  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new ClassValidationError(`class ${JSON.stringify(classId)} does not exist`);
  }

  const pending = await workflowService.findPendingForEntity(client, 'timetable_approval', classId);
  if (pending === null) {
    throw new ClassTimetableApprovalNotPendingError(`class ${JSON.stringify(classId)} has no pending timetable approval request`);
  }

  return pending;
}

// The actual Module 3->4 unblock: workflowService.approveRequest alone
// only ever flips workflow_requests.status — nothing else in this
// codebase mirrors that outcome onto classes.timetable_status, which
// is the one column attendanceService.assertTimetableApproved actually
// gates on. Mid-chain (the HOD's own step) advances the visible status
// to 'Pending Principal' without closing the request; the terminal
// step (status -> 'Approved') is the only point that flips
// timetable_status to 'Approved' and genuinely unblocks attendance.
async function approveTimetableApproval(client, classId, { actorUserId, remarks, effectiveFrom } = {}) {
  const pending = await loadPendingTimetableApproval(client, classId);
  const resolved = await workflowService.approveRequest(client, pending.id, { actorUserId, remarks });

  const nextStatus = resolved.status === 'Approved' ? 'Approved' : 'Pending Principal';
  const cls = await classRepository.update(client, classId, { timetableStatus: nextStatus });

  // BusinessRules.md Timetable revision: "any permanent academic
  // change is recorded as a new, numbered, dated revision." The
  // terminal step of the chain (status flips to 'Approved') is the one
  // point a class's timetable actually becomes the new authoritative
  // version — same "only the terminal step genuinely unblocks
  // attendance" reasoning this function's own existing comment already
  // gives for timetable_status, extended here to revisions. Additive
  // only: attendanceService's own gate is untouched by this (see the
  // migration's file-level comment) — this purely builds the
  // permanently-retained history the rule requires.
  let revision = null;
  if (nextStatus === 'Approved') {
    const revisionNumber = (await timetableRevisionRepository.countForClass(client, classId)) + 1;
    revision = await timetableRevisionRepository.create(client, {
      collegeId: cls.college_id,
      classId,
      revisionNumber,
      effectiveFrom: effectiveFrom || new Date().toISOString().slice(0, 10),
      workflowRequestId: pending.id,
      createdByUserId: actorUserId,
    });
  }

  return { workflowRequest: resolved, class: cls, revision };
}

// BusinessRules.md: "attendance always uses the timetable revision
// effective on the class date." Exposed as a read-only lookup other
// services (or a future attendanceService rewiring) can consult;
// see timetable_revisions migration's own comment on why
// attendanceService's existing gate doesn't call this yet.
async function getEffectiveTimetableRevision(client, classId, date) {
  return timetableRevisionRepository.findEffectiveForDate(client, classId, date);
}

async function listTimetableRevisions(client, classId) {
  return timetableRevisionRepository.listForClass(client, classId);
}

// RS-CLS-007 (ADL-004: "New state machine replacing the current direct
// HOD-assigns implementation"): "A substitute may act only after L3
// approves; the absent staff member, L3, or the class's L4 may
// initiate the request." Replaces the old direct-assign assignSubstitute
// (which INSERTed the fact immediately) with a genuine request ->
// L3-approval flow, same shape studentService.requestLifecycleStatusChange/
// staffService.submitStaffRegistration already established: this
// function only stages the PROPOSED data (substituteAssignmentRequestRepository,
// a permanent record of what was asked for) and submits it into a
// workflowChainService-resolved chain; the real substitute_assignments
// row (the fact substituteAssignmentRepository/assertCanMark consume)
// is only ever created by approveSubstituteAssignment below, on the
// chain's terminal Approved outcome.
// 4-login authorization architecture (2026-08-09): three genuinely
// different authorities, must not be conflated —
//   1. isAbsentStaff: the named absent staff member requesting their
//      own substitute — Staff-level, unconditional on actorRole,
//      unchanged.
//   2. isHod: this department's L3 — unaffected by this architecture,
//      unchanged.
//   3. isTutor: the class's own L4 acting on tutor authority alone —
//      now additionally requires actorRole === 'class_tutor' (Current
//      Login Identity), since Position Occupancy alone must not grant
//      this on a personal Staff login.
async function requestSubstituteAssignment(client, {
  classId, timetablePeriodId, assignmentDate, originalStaffUserId, substituteStaffUserId, reason,
}, { requestedByUserId, requestedByRole, origin = 'human' } = {}) {
  if (!classId || !timetablePeriodId || !assignmentDate || !substituteStaffUserId) {
    throw new SubstituteAssignmentValidationError(
      'classId, timetablePeriodId, assignmentDate, and substituteStaffUserId are required',
    );
  }
  if (!requestedByUserId) {
    throw new SubstituteAssignmentValidationError('requestedByUserId is required');
  }

  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new ClassValidationError(`class ${JSON.stringify(classId)} does not exist`);
  }

  // RS-CLS-007's own actor list: the absent staff member named on the
  // request, the department's L3 (hod), or the class's own L4 (tutor).
  // Not a role check (a hod of a DIFFERENT department, or a tutor of a
  // DIFFERENT class, is not "the class's L4") — resolved against this
  // specific class/department, same identityService.resolvePositionOccupant
  // composition sendClassAlert/assertCanMark already use for their own
  // per-class ownership checks.
  const isAbsentStaff = originalStaffUserId && originalStaffUserId === requestedByUserId;
  const hodUserId = cls.department_id
    ? await identityService.resolvePositionOccupant(client, { collegeId: cls.college_id, departmentId: cls.department_id })
    : null;
  const tutorUserId = await identityService.resolvePositionOccupant(client, { collegeId: cls.college_id, classId });
  const isHod = hodUserId !== null && hodUserId === requestedByUserId;
  const isTutor = tutorUserId !== null && tutorUserId === requestedByUserId && requestedByRole === 'class_tutor';
  if (!isAbsentStaff && !isHod && !isTutor) {
    throw new SubstituteAssignmentNotAuthorizedError(
      `user ${JSON.stringify(requestedByUserId)} is not the absent staff member, this department's hod, or this class's tutor`,
    );
  }

  // RS-CLS-007 widened 2026-08-04 (ADL-031): the named substitute must
  // (a) belong to the same department as the class needing coverage,
  // and (b) actually be free that exact period/date — no regular
  // allocation of their own there, and not already covering another
  // class as a substitute for the same period/date. Checked at request
  // time, not left to surface only as a later DB conflict at approval —
  // a requester should know immediately if the person they named can't
  // actually take it.
  const candidate = await staffService.getStaffByUserId(client, substituteStaffUserId);
  if (candidate === null) {
    throw new SubstituteAssignmentCandidateNotFoundError(`no staff profile exists for user ${JSON.stringify(substituteStaffUserId)}`);
  }
  if (cls.department_id && candidate.department_id !== cls.department_id) {
    throw new SubstituteAssignmentCandidateNotInDepartmentError(
      `user ${JSON.stringify(substituteStaffUserId)} is not in the same department as class ${JSON.stringify(classId)}`,
    );
  }
  const candidateOwnAllocations = await facultyAllocationRepository.findByStaffUserId(client, substituteStaffUserId);
  const hasRegularClash = candidateOwnAllocations.some((a) => a.period_id === timetablePeriodId);
  const existingSubstitution = await substituteAssignmentRepository.findByStaffPeriodAndDate(
    client, substituteStaffUserId, timetablePeriodId, assignmentDate,
  );
  if (hasRegularClash || existingSubstitution !== null) {
    throw new SubstituteAssignmentCandidateNotFreeError(
      `user ${JSON.stringify(substituteStaffUserId)} already has a class during period ${JSON.stringify(timetablePeriodId)} on ${JSON.stringify(assignmentDate)}`,
    );
  }

  const request = await substituteAssignmentRequestRepository.create(client, {
    collegeId: cls.college_id,
    classId,
    timetablePeriodId,
    assignmentDate,
    originalStaffUserId,
    substituteStaffUserId,
    reason,
    requestedByUserId,
  });

  const approverChain = await workflowChainService.resolveApproverChain(client, {
    collegeId: cls.college_id,
    entityType: 'substitute_assignment',
    classId,
    departmentId: cls.department_id,
  });

  const workflowRequest = await workflowService.submitRequest(client, {
    collegeId: cls.college_id,
    entityType: 'substitute_assignment',
    entityId: request.id,
    requestedByUserId,
    origin,
    approverChain,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: requestedByUserId,
    action: 'substitute_assignment_requested',
    entity: 'substitute_assignment_requests',
    entityId: request.id,
    metadata: null,
  });

  // RS-CLS-007 / RS-NTF-005: initiation "triggers an automatic system
  // notification to L3 — mechanical, non-discretionary content outside
  // the draft -> approve -> dispatch pipeline," the same no-draft-
  // no-approve carve-out attendanceService's absence-flag alert and
  // studentService.requestLifecycleStatusChange's own pending-approval
  // alert already use. Notifies the chain's current (first, and only)
  // approver; best-effort — an unresolvable approver never blocks the
  // request itself.
  const firstApprover = approverChain[0];
  if (firstApprover && firstApprover.user_id) {
    const approver = await authRepository.getUserById(client, firstApprover.user_id);
    if (approver && approver.email) {
      await notificationService.sendViaChannel(client, {
        collegeId: cls.college_id,
        channel: 'email',
        to: approver.email,
        subject: 'Substitute assignment awaiting your approval',
        body: `A request to assign a substitute for ${JSON.stringify(cls.class_name)} on ${JSON.stringify(assignmentDate)} is pending your approval.`,
      });
    }
  }

  return { workflowRequest, request };
}

// Shared load+validate for approve/reject: the request row must exist,
// and exactly one live Pending workflow_requests row must govern it —
// same correlation staffService.loadPendingRegistration already
// established for its own entityType.
async function loadPendingSubstituteAssignmentRequest(client, requestId) {
  const request = await substituteAssignmentRequestRepository.findById(client, requestId);
  if (request === null) {
    throw new SubstituteAssignmentRequestNotFoundError(`substitute assignment request ${JSON.stringify(requestId)} does not exist`);
  }

  const pending = await workflowService.findPendingForEntity(client, 'substitute_assignment', requestId);
  if (pending === null) {
    throw new SubstituteAssignmentRequestNotFoundError(`substitute assignment request ${JSON.stringify(requestId)} has no pending approval request`);
  }

  return { request, pending };
}

// Terminal Approved outcome only (workflowService.approveRequest's own
// single-step chain here always resolves the whole request in one
// call): INSERTs the real substitute_assignments row from the staged
// request data, reusing assignSubstitute's own conflict/period-not-found
// mapping unchanged — the fact itself, and its constraints, are
// unchanged by this rework; only how it comes to exist has changed.
async function approveSubstituteAssignment(client, requestId, { actorUserId, remarks } = {}) {
  const { request, pending } = await loadPendingSubstituteAssignmentRequest(client, requestId);
  const resolved = await workflowService.approveRequest(client, pending.id, { actorUserId, remarks });

  let assignment;
  try {
    assignment = await substituteAssignmentRepository.create(client, {
      collegeId: request.college_id,
      classId: request.class_id,
      timetablePeriodId: request.timetable_period_id,
      assignmentDate: request.assignment_date,
      originalStaffUserId: request.original_staff_user_id,
      substituteStaffUserId: request.substitute_staff_user_id,
      assigningAuthorityUserId: actorUserId,
      reason: request.reason,
    });
  } catch (err) {
    if (err.code === '23503' && err.constraint === 'substitute_assignments_timetable_period_id_fkey') {
      throw new SubstituteAssignmentPeriodNotFoundError(`timetable period ${JSON.stringify(request.timetable_period_id)} does not exist`);
    }
    if (err.code === '23505' && err.constraint === 'substitute_assignments_class_period_date_key') {
      throw new SubstituteAssignmentConflictError(
        `class ${JSON.stringify(request.class_id)}, period ${JSON.stringify(request.timetable_period_id)} already has a substitute assigned for ${JSON.stringify(request.assignment_date)}`,
      );
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: request.college_id,
    userId: actorUserId,
    action: 'substitute_assigned',
    entity: 'substitute_assignments',
    entityId: assignment.id,
    metadata: null,
  });

  return { workflowRequest: resolved, assignment };
}

async function rejectSubstituteAssignment(client, requestId, { actorUserId, remarks } = {}) {
  const { pending } = await loadPendingSubstituteAssignmentRequest(client, requestId);
  const resolved = await workflowService.rejectRequest(client, pending.id, { actorUserId, remarks });
  return { workflowRequest: resolved };
}

// The one lookup attendanceService's own assertCanMark composes,
// mirroring getFacultyAllocationForClassAndPeriod's own "thin
// passthrough AttendanceService reads timetable/approval-adjacent
// state through" precedent — AttendanceService never queries
// substitute_assignments directly (Architecture.md 2.5: AttendanceService
// reads, does not own, timetable state from AcademicService). classId
// is required (not just periodId): timetable_periods is the shared
// college-wide bell schedule, reused by many different classes for the
// same (day, hour) — see substituteAssignmentRepository's own comment.
async function getSubstituteAssignment(client, classId, timetablePeriodId, assignmentDate) {
  return substituteAssignmentRepository.findByClassPeriodAndDate(client, classId, timetablePeriodId, assignmentDate);
}

async function listSubstituteAssignmentsForClass(client, classId) {
  return substituteAssignmentRepository.listForClass(client, classId);
}

// "My Substitute Duties" (UAT Priority 1 #2, first half): every
// assignment where the caller IS the substitute, across every class —
// see substituteAssignmentRepository.findBySubstituteUserId's own
// comment for why this needed a new query rather than reusing
// listForClass.
async function listMySubstituteAssignments(client, { substituteStaffUserId }) {
  return substituteAssignmentRepository.findBySubstituteUserId(client, substituteStaffUserId);
}

// "My Substitute Duties" (UAT Priority 1 #2, second half): the
// acknowledge step that didn't exist before this slice. Idempotent —
// a second acknowledge attempt returns the existing row rather than
// erroring, since from the substitute's point of view "acknowledge"
// isn't a transition that can meaningfully fail the second time.
async function acknowledgeSubstituteAssignment(client, assignmentId, { actorUserId, collegeId }) {
  const assignment = await substituteAssignmentRepository.findById(client, assignmentId);
  if (assignment === null) {
    throw new SubstituteAssignmentNotFoundError(`substitute assignment ${JSON.stringify(assignmentId)} does not exist`);
  }
  if (assignment.substitute_staff_user_id !== actorUserId) {
    throw new SubstituteAssignmentNotAuthorizedError(
      `user ${JSON.stringify(actorUserId)} is not the substitute on assignment ${JSON.stringify(assignmentId)}`,
    );
  }

  const existing = await substituteAssignmentAcknowledgementRepository.findByAssignmentId(client, assignmentId);
  if (existing !== null) {
    return existing;
  }

  const acknowledgement = await substituteAssignmentAcknowledgementRepository.create(client, {
    collegeId,
    substituteAssignmentId: assignmentId,
    acknowledgedByUserId: actorUserId,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'substitute_assignment_acknowledged',
    entity: 'substitute_assignment_acknowledgements',
    entityId: acknowledgement.id,
    metadata: { substituteAssignmentId: assignmentId },
  });

  return acknowledgement;
}

// RS-TTB-001's own slot-grid input shape: { workingDays, startTime,
// endTime, slotDurationMinutes, breakAfterSlots }. Turns institution
// config into timetable_periods rows so the Class Tutor never hand-
// creates a slot grid (Section 1: "the user must never manually create
// slot grids") — the only two ways to populate that table before this
// were one-row-at-a-time createTimetablePeriod or CSV import.
// Idempotent: a (college, day, hour) slot that already exists is
// skipped, not duplicated, so re-running this after adding a working
// day only fills the gap. "Break after every N slots" is realized as a
// same-width gap in the minute cursor, not a stored row — a break is
// the absence of a period, matching how findCurrentByCollegeAndDay
// already treats any minute with no covering period as "no session."
async function generateSlotGrid(client, collegeId, config, { actorUserId } = {}) {
  const {
    workingDays, startTime, endTime, slotDurationMinutes, breakAfterSlots,
  } = config || {};

  if (!collegeId || !Array.isArray(workingDays) || workingDays.length === 0
      || !startTime || !endTime || !slotDurationMinutes || slotDurationMinutes < 1) {
    throw new TimetableConfigValidationError(
      'collegeId, a non-empty workingDays array, startTime, endTime, and a positive slotDurationMinutes are required',
    );
  }
  const invalidDay = workingDays.find((day) => !WEEKDAY_ORDER.includes(day));
  if (invalidDay) {
    throw new TimetableConfigValidationError(`${JSON.stringify(invalidDay)} is not a recognized working day`);
  }
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  if (endMinutes <= startMinutes) {
    throw new TimetableConfigValidationError('endTime must be after startTime');
  }

  const daySlots = [];
  let cursor = startMinutes;
  let slotCount = 0;
  while (cursor + slotDurationMinutes <= endMinutes) {
    slotCount += 1;
    daySlots.push({ hourIndex: slotCount, startMinutes: cursor, endMinutes: cursor + slotDurationMinutes });
    cursor += slotDurationMinutes;
    if (breakAfterSlots && slotCount % breakAfterSlots === 0 && cursor + slotDurationMinutes <= endMinutes) {
      cursor += slotDurationMinutes;
    }
  }
  if (daySlots.length === 0) {
    throw new TimetableConfigValidationError('no slots fit between startTime and endTime at this slot duration');
  }

  const created = [];
  const skipped = [];
  for (const day of workingDays) {
    for (const slot of daySlots) {
      // eslint-disable-next-line no-await-in-loop
      const existing = await timetablePeriodRepository.findByCollegeDayAndHour(client, collegeId, day, slot.hourIndex);
      if (existing !== null) {
        skipped.push(existing);
        continue; // eslint-disable-line no-continue
      }
      // eslint-disable-next-line no-await-in-loop
      const period = await timetablePeriodRepository.create(client, {
        collegeId,
        dayOfWeek: day,
        hourIndex: slot.hourIndex,
        startTime: minutesToTime(slot.startMinutes),
        endTime: minutesToTime(slot.endMinutes),
      });
      created.push(period);
    }
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'timetable_slot_grid_generated',
    entity: 'timetable_periods',
    entityId: collegeId,
    metadata: {
      created: created.length, skipped: skipped.length, slotsPerDay: daySlots.length, workingDays,
    },
  });

  return {
    created,
    skipped,
    slotsPerDay: daySlots.length,
    totalWeeklySlots: daySlots.length * workingDays.length,
  };
}

// RS-TTB-001: "the Class Tutor cannot directly publish a timetable" —
// generateTimetable/reviseTimetable only ever produce a proposal;
// submitTimetableForApproval (unchanged) is still the sole path to
// 'Approved'. actorRole is checked here, not at the route: mirrors
// sendClassAlert's own tutor-identity check (identityService.
// resolvePositionOccupant), but deliberately conditional on the actor
// being SOME kind of tutor rather than principal/hod — and every
// existing caller (tests, internal callers) that never supplied a
// role sees unchanged behavior.
//
// 4-login authorization architecture (2026-08-09): a genuine Class
// Tutor Position Account seat login (actorRole === 'class_tutor') is
// ownership-checked below, same as before. A personal Staff login
// (actorRole === 'staff') is now rejected outright, even when that
// same person's users.id currently occupies the L4 seat — Position
// Occupancy is informational only; only the L4 login itself (Current
// Login Identity) may generate a timetable. Every other actorRole
// (undefined, 'hod', 'principal') keeps its prior unchanged behavior —
// this function has never been their gate.
async function assertCanGenerateForClass(client, cls, { actorUserId, actorRole }) {
  if (actorRole !== 'staff' && actorRole !== 'class_tutor') return;
  if (actorRole === 'staff') {
    throw new TimetableGenerationForbiddenError(
      `user ${JSON.stringify(actorUserId)}'s current login (role 'staff') is not authorized to generate a timetable — this requires the class's Class Tutor Position Account login`,
    );
  }
  const tutorUserId = await identityService.resolvePositionOccupant(client, { collegeId: cls.college_id, classId: cls.id });
  if (tutorUserId !== actorUserId) {
    throw new TimetableGenerationForbiddenError(
      `user ${JSON.stringify(actorUserId)} is not the Class Tutor of class ${JSON.stringify(cls.id)}`,
    );
  }
}

// requirements: [{ subject, subjectType, staffUserId | staffUserIds,
// periodsPerWeek, sessionBlocks }] — normalizes the legacy single-
// staffUserId/flat-periodsPerWeek shape (still the only shape the
// pre-RS-TTB-001 caller and every existing test use) alongside the new
// co-teaching/session-block shape, so both are the same requirement
// object everywhere else in this function.
function normalizeRequirement(req) {
  const staffUserIds = Array.isArray(req.staffUserIds) && req.staffUserIds.length > 0
    ? req.staffUserIds
    : (req.staffUserId ? [req.staffUserId] : []);
  const subjectType = req.subjectType || 'Theory';
  const periodsPerWeek = req.periodsPerWeek;
  const sessionBlocks = Array.isArray(req.sessionBlocks) && req.sessionBlocks.length > 0
    ? req.sessionBlocks
    : Array(periodsPerWeek || 0).fill(1);
  return {
    subject: req.subject, subjectType, staffUserIds, periodsPerWeek, sessionBlocks,
  };
}

function validateRequirement(req) {
  if (!req.subject || req.staffUserIds.length === 0 || !req.periodsPerWeek || req.periodsPerWeek < 1) {
    throw new TimetableGenerationValidationError(
      'each requirement needs subject, staffUserId(s), and a periodsPerWeek of at least 1',
    );
  }
  if (req.subjectType !== 'Theory' && req.subjectType !== 'Practical') {
    throw new TimetableGenerationValidationError('subjectType must be Theory or Practical');
  }
  if (req.subjectType === 'Theory' && req.staffUserIds.length > 1) {
    throw new TimetableGenerationValidationError('Theory supports exactly one faculty');
  }
  if (req.subjectType === 'Practical' && req.staffUserIds.length > 2) {
    throw new TimetableGenerationValidationError('Practical supports at most two faculty (co-teaching)');
  }
  const blockSum = req.sessionBlocks.reduce((sum, n) => sum + n, 0);
  if (blockSum !== req.periodsPerWeek) {
    throw new TimetableGenerationValidationError('sessionBlocks must sum to periodsPerWeek');
  }
}

// One full scheduling attempt over every requirement's every session
// block, given a fixed period search order — the unit generateTimetable's
// shuffle-and-retry loop below runs up to five times. periodsById /
// dailyHoursBaseline are read once outside the retry loop (see
// generateTimetable) since every attempt starts from the same true DB
// baseline — the previous attempt's own rows are removed before the
// next attempt runs, restoring exactly that baseline.
async function runGenerationAttempt(client, {
  cls, requirements, orderedPeriods, usedPeriodIdsBaseline, dailyHoursBaseline, maxHoursPerDay,
}) {
  const usedPeriodIds = new Set(usedPeriodIdsBaseline);
  // staffId -> day -> hours already committed, cloned per-attempt so a
  // failed/retried attempt never leaks its own partial hours into the
  // next one.
  const dailyHours = new Map();
  for (const [staffId, byDay] of dailyHoursBaseline.entries()) {
    dailyHours.set(staffId, new Map(byDay));
  }

  const placements = [];
  const conflicts = [];

  const periodsByDay = new Map();
  for (const period of orderedPeriods) {
    if (!periodsByDay.has(period.day_of_week)) periodsByDay.set(period.day_of_week, []);
    periodsByDay.get(period.day_of_week).push(period);
  }
  for (const list of periodsByDay.values()) {
    list.sort((a, b) => a.hour_index - b.hour_index);
  }
  // Calendar-ordered day list, rotated the same way orderedPeriods was
  // (see generateTimetable's shuffleVariant) — window search must scan
  // days in the attempt's own order, not always Monday-first, or later
  // attempts could never actually try a different placement.
  const dayOrder = [...new Set(orderedPeriods.map((p) => p.day_of_week))];

  function hoursFits(staffId, day, addedHours) {
    if (!maxHoursPerDay) return true;
    const existing = (dailyHours.get(staffId) || new Map()).get(day) || 0;
    return existing + addedHours <= maxHoursPerDay;
  }

  function addHours(staffId, day, addedHours) {
    if (!dailyHours.has(staffId)) dailyHours.set(staffId, new Map());
    const byDay = dailyHours.get(staffId);
    byDay.set(day, (byDay.get(day) || 0) + addedHours);
  }

  // Finds and commits (DB insert) the first workable window of
  // `length` consecutive periods on one day for a single block, trying
  // every day/starting-index combination in this attempt's order.
  // Returns { placed: true, rows } on success, or a reason tag on
  // failure ('capacity' — never enough consecutive room; 'daily_limit'
  // — every candidate blocked purely by the hours/day cap;
  // 'co_teaching' — a two-staff block where the two never had a
  // simultaneously-free window; 'faculty' — a single-staff block
  // blocked by another class's allocation, the real UNIQUE(period_id,
  // staff_user_id) constraint).
  async function placeBlock(req, length) {
    let sawStructural = false;
    let sawDailyLimit = false;
    let sawCoTeaching = false;
    let sawFaculty = false;

    for (const day of dayOrder) {
      const dayPeriods = periodsByDay.get(day) || [];
      for (let i = 0; i + length <= dayPeriods.length; i += 1) {
        const window = dayPeriods.slice(i, i + length);
        let consecutive = true;
        for (let k = 1; k < window.length; k += 1) {
          if (window[k].hour_index !== window[k - 1].hour_index + 1) { consecutive = false; break; }
        }
        if (!consecutive) continue; // eslint-disable-line no-continue
        sawStructural = true;
        if (window.some((p) => usedPeriodIds.has(p.id))) continue; // eslint-disable-line no-continue

        // periodDurationHours reads start_time/end_time, which no
        // caller needs unless a cap is actually configured — skipped
        // entirely otherwise, same "don't touch what this call doesn't
        // need" reasoning loadStaffDailyHours's own maxHoursPerDay
        // short-circuit documents.
        const windowHours = maxHoursPerDay ? window.reduce((sum, p) => sum + periodDurationHours(p), 0) : 0;
        if (maxHoursPerDay) {
          const overCap = req.staffUserIds.some((staffId) => !hoursFits(staffId, day, windowHours));
          if (overCap) { sawDailyLimit = true; continue; } // eslint-disable-line no-continue
        }

        // eslint-disable-next-line no-await-in-loop
        const attemptRows = await tryInsertWindow(client, {
          cls, classId: cls.id, req, window, sessionBlockId: length > 1 ? randomUUID() : null,
        });
        if (attemptRows.ok) {
          window.forEach((p) => usedPeriodIds.add(p.id));
          req.staffUserIds.forEach((staffId) => addHours(staffId, day, windowHours));
          return { placed: true, rows: attemptRows.rows };
        }
        usedPeriodIds.add(attemptRows.failedPeriodId);
        if (req.staffUserIds.length === 2) sawCoTeaching = true; else sawFaculty = true;
      }
    }

    if (sawCoTeaching) return { placed: false, reason: 'co_teaching' };
    if (sawFaculty) return { placed: false, reason: 'faculty' };
    if (sawDailyLimit) return { placed: false, reason: 'daily_limit' };
    if (!sawStructural) return { placed: false, reason: 'capacity' };
    return { placed: false, reason: 'capacity' };
  }

  for (const req of requirements) {
    let placedCount = 0;
    let lastReason = 'capacity';
    for (const blockLength of req.sessionBlocks) {
      // eslint-disable-next-line no-await-in-loop
      const result = await placeBlock(req, blockLength);
      if (result.placed) {
        placements.push(...result.rows);
        placedCount += blockLength;
      } else {
        lastReason = result.reason;
      }
    }
    if (placedCount < req.periodsPerWeek) {
      const CATEGORY_LABELS = {
        faculty: 'Faculty Conflict',
        capacity: 'Capacity Conflict',
        co_teaching: 'Co-Teaching Conflict',
        daily_limit: 'Daily Hour Limit',
      };
      conflicts.push({
        subject: req.subject,
        subjectType: req.subjectType,
        staffUserIds: req.staffUserIds,
        requested: req.periodsPerWeek,
        placed: placedCount,
        category: CATEGORY_LABELS[lastReason] || 'Constraint Failure',
        reason: 'not enough conflict-free periods available',
      });
    }
  }

  return { placements, conflicts };
}

// Inserts every (period, staffId) row a window needs; on the DB's own
// UNIQUE(period_id, staff_user_id) rejecting one of them (23505 — that
// staff member is already teaching another class that period), removes
// whatever this same window already committed and reports failure,
// same "let Postgres be the real conflict check" reasoning the
// original single-period generateTimetable always used.
async function tryInsertWindow(client, {
  cls, classId, req, window, sessionBlockId,
}) {
  const rows = [];
  for (const period of window) {
    for (const staffId of req.staffUserIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const row = await facultyAllocationRepository.create(client, {
          collegeId: cls.college_id,
          classId,
          periodId: period.id,
          subject: req.subject,
          subjectType: req.subjectType,
          staffUserId: staffId,
          sessionBlockId,
        });
        rows.push(row);
      } catch (err) {
        if (err.code === '23505') {
          for (const inserted of rows) {
            // eslint-disable-next-line no-await-in-loop
            await facultyAllocationRepository.remove(client, inserted.id);
          }
          return { ok: false, failedPeriodId: period.id };
        }
        throw err;
      }
    }
  }
  return { ok: true, rows };
}

// Skips the round trip entirely when no cap is configured (the common
// case, and every pre-RS-TTB-001 caller) — hoursFits short-circuits to
// true whenever maxHoursPerDay is falsy regardless of this map's
// contents, so an empty Map is exactly as correct as a populated one
// in that case, at zero extra DB cost.
async function loadStaffDailyHours(client, periodsById, staffIds, maxHoursPerDay) {
  const dailyHours = new Map();
  if (!maxHoursPerDay) return dailyHours;
  for (const staffId of staffIds) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await facultyAllocationRepository.findByStaffUserId(client, staffId);
    const byDay = new Map();
    for (const row of rows) {
      const period = periodsById.get(row.period_id);
      if (!period) continue; // eslint-disable-line no-continue
      byDay.set(period.day_of_week, (byDay.get(period.day_of_week) || 0) + periodDurationHours(period));
    }
    dailyHours.set(staffId, byDay);
  }
  return dailyHours;
}

// Deterministic rotation, not Math.random — attempt 1 is always the
// plain calendar order (identical to this function's pre-RS-TTB-001
// behavior, so every existing caller/test that never hits a conflict
// sees byte-identical placement), attempts 2-5 rotate the starting
// point so a later attempt genuinely tries different candidate windows
// first rather than repeating attempt 1's exact scan.
function shuffleVariant(periods, attempt) {
  if (attempt <= 1 || periods.length === 0) return periods;
  const offset = ((attempt - 1) * Math.max(1, Math.floor(periods.length / 5))) % periods.length;
  return [...periods.slice(offset), ...periods.slice(0, offset)];
}

// Informational only (RS-TTB-001 Section 8: "Quality Score never blocks
// publishing/submission") — a simple 0-100 heuristic, not a real
// optimizer: rewards spreading a staff member's placed hours evenly
// across the week and penalizes any day that alone accounts for more
// than half their placed hours. Deliberately coarse; a genuine
// constraint-solver-grade score is out of scope for this slice.
function computeQualityScore(placements, periodsById) {
  if (placements.length === 0) return 100;
  const byStaffDay = new Map();
  for (const row of placements) {
    const period = periodsById.get(row.period_id);
    if (!period) continue; // eslint-disable-line no-continue
    if (!byStaffDay.has(row.staff_user_id)) byStaffDay.set(row.staff_user_id, new Map());
    const byDay = byStaffDay.get(row.staff_user_id);
    byDay.set(period.day_of_week, (byDay.get(period.day_of_week) || 0) + periodDurationHours(period));
  }
  let penalty = 0;
  let staffCount = 0;
  for (const byDay of byStaffDay.values()) {
    staffCount += 1;
    const dayHours = [...byDay.values()];
    const total = dayHours.reduce((sum, h) => sum + h, 0);
    const maxDay = Math.max(...dayHours);
    if (total > 0 && maxDay > total / 2) penalty += (maxDay / total) - 0.5;
  }
  if (staffCount === 0) return 100;
  const score = 100 - Math.round((penalty / staffCount) * 100);
  return Math.max(0, Math.min(100, score));
}

const MAX_GENERATION_ATTEMPTS = 5;

// BusinessRules.md Automatic timetable generation: "after faculty
// members are assigned to subjects, the system shall automatically
// generate a balanced, conflict-free timetable for a department/class
// ... AI shall prevent faculty, classroom, and laboratory conflicts by
// respecting existing approved timetable allocations across the
// institution ... if no conflict-free timetable can be generated, AI
// reports the conflict for HOD action."
//
// requirements: [{ subject, subjectType, staffUserId | staffUserIds,
// periodsPerWeek, sessionBlocks }] — this function's own required
// input, not derived from a "subject roster" table (none exists in
// this schema; see TimetableGenerationValidationError's own comment).
// One class at a time (never institution-wide in one call), matching
// the rule's own "class/department" scope wording.
//
// RS-TTB-001 extends the original single-period-at-a-time version with
// Theory/Practical co-teaching, multi-hour practical session blocks, an
// optional max-hours/day-per-staff cap (cls.max_hours_per_day_per_staff,
// overridable per call), and a shuffle-and-retry loop of up to
// MAX_GENERATION_ATTEMPTS full attempts before finally reporting
// conflicts — "don't report as conflict, shuffle it until everything
// fits, try 5 times, then report conflict," this session's own
// instruction. Attempt 1 is always the original deterministic calendar
// order, so a call that never hits a conflict is byte-identical to the
// pre-RS-TTB-001 function (see shuffleVariant/runGenerationAttempt's
// own comments) — every pre-existing caller and test is unaffected.
//
// Conflict prevention is still the real UNIQUE (period_id,
// staff_user_id) constraint on faculty_allocation doing the actual
// work — this function's own job is choosing candidate windows in a
// sensible (and, across retries, varied) order and falling back when
// the DB rejects a candidate, not deciding "is this staff member free"
// itself.
async function generateTimetable(client, classId, requirements, { actorUserId, actorRole, maxHoursPerDay } = {}) {
  if (!classId || !Array.isArray(requirements) || requirements.length === 0) {
    throw new TimetableGenerationValidationError('classId and a non-empty requirements array are required');
  }
  const normalized = requirements.map(normalizeRequirement);
  normalized.forEach(validateRequirement);

  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new ClassValidationError(`class ${JSON.stringify(classId)} does not exist`);
  }
  if (cls.timetable_status === 'Approved') {
    throw new TimetableGenerationClassApprovedError(
      `class ${JSON.stringify(classId)}'s timetable is already Approved — submit a permanent change through the revision workflow instead of regenerating`,
    );
  }
  await assertCanGenerateForClass(client, cls, { actorUserId, actorRole });

  const startedAt = Date.now();
  const allPeriods = await timetablePeriodRepository.findAllByCollege(client, cls.college_id);
  const sortedPeriods = [...allPeriods].sort((a, b) => {
    const dayDiff = WEEKDAY_ORDER.indexOf(a.day_of_week) - WEEKDAY_ORDER.indexOf(b.day_of_week);
    return dayDiff !== 0 ? dayDiff : a.hour_index - b.hour_index;
  });
  const periodsById = new Map(sortedPeriods.map((p) => [p.id, p]));

  const existingForClass = await facultyAllocationRepository.findByClassId(client, classId);
  const usedPeriodIdsBaseline = new Set(existingForClass.map((row) => row.period_id));

  const effectiveMaxHoursPerDay = maxHoursPerDay !== undefined ? maxHoursPerDay : cls.max_hours_per_day_per_staff;
  const allStaffIds = [...new Set(normalized.flatMap((req) => req.staffUserIds))];
  const dailyHoursBaseline = await loadStaffDailyHours(client, periodsById, allStaffIds, effectiveMaxHoursPerDay);

  let attemptResult = null;
  let bestResult = null;
  let bestAttempt = 0;
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    if (attemptResult) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(attemptResult.placements.map((row) => facultyAllocationRepository.remove(client, row.id)));
    }
    const orderedPeriods = shuffleVariant(sortedPeriods, attempt);
    // eslint-disable-next-line no-await-in-loop
    attemptResult = await runGenerationAttempt(client, {
      cls, requirements: normalized, orderedPeriods, usedPeriodIdsBaseline, dailyHoursBaseline, maxHoursPerDay: effectiveMaxHoursPerDay,
    });
    if (!bestResult || attemptResult.conflicts.length < bestResult.conflicts.length) {
      bestResult = attemptResult;
      bestAttempt = attempt;
    }
    if (attemptResult.conflicts.length === 0) break;
  }

  // The DB currently holds the LAST attempt's rows — if that wasn't the
  // best one seen, redo the best attempt's exact variant one more time
  // so the persisted result is the best of all MAX_GENERATION_ATTEMPTS
  // tries, not merely the last.
  if (attemptResult !== bestResult) {
    await Promise.all(attemptResult.placements.map((row) => facultyAllocationRepository.remove(client, row.id)));
    const orderedPeriods = shuffleVariant(sortedPeriods, bestAttempt);
    attemptResult = await runGenerationAttempt(client, {
      cls, requirements: normalized, orderedPeriods, usedPeriodIdsBaseline, dailyHoursBaseline, maxHoursPerDay: effectiveMaxHoursPerDay,
    });
  }

  const { placements, conflicts } = attemptResult;
  const qualityScore = computeQualityScore(placements, periodsById);
  const totalTeachingHoursAllocated = placements.reduce((sum, row) => {
    const period = periodsById.get(row.period_id);
    return sum + (period ? periodDurationHours(period) : 0);
  }, 0);
  const usedAfter = new Set(existingForClass.map((r) => r.period_id));
  placements.forEach((row) => usedAfter.add(row.period_id));
  const summary = {
    subjectsScheduled: new Set(normalized.map((r) => r.subject)).size - conflicts.length,
    totalTeachingHoursAllocated,
    facultyUtilization: allStaffIds.length === 0 ? 0 : Math.round((placements.length / (allStaffIds.length * sortedPeriods.length || 1)) * 100),
    remainingFreeSlots: Math.max(0, sortedPeriods.length - usedAfter.size),
    generationTimeMs: Date.now() - startedAt,
    conflictCount: conflicts.length,
    qualityScore,
  };

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: actorUserId,
    action: 'timetable_generated',
    entity: 'classes',
    entityId: classId,
    metadata: { placedCount: placements.length, conflictCount: conflicts.length, qualityScore },
  });

  return {
    placements, conflicts, summary,
  };
}

// RS-TTB-001 Section 11: "any modification creates a Revision Proposal
// ... only affected timetable sessions should be regenerated,
// unaffected sessions should remain identical." changedRequirements
// uses the exact same shape generateTimetable takes; each entry names
// one subject whose faculty_allocation rows for THIS class are removed
// and re-placed, leaving every other subject's rows untouched (never
// queried, never removed). Reuses submitTimetableForApproval unchanged
// for the actual approval routing — this function's own job stops at
// "produce and stage the proposal," matching the Design Principle
// section's "the engine never activates a timetable" rule. Runs
// regardless of cls.timetable_status (including 'Approved' — the one
// case plain generateTimetable refuses): submitTimetableForApproval's
// own existing behavior of flipping timetable_status out of 'Approved'
// the moment a revision is submitted is this session's own corrected
// rule (attendance blocks for this class from that instant, same as a
// first-time approval — there is no "old timetable stays live" state
// in this codebase), not something this function needs to work around.
async function reviseTimetable(client, classId, changedRequirements, { actorUserId, actorRole, maxHoursPerDay } = {}) {
  if (!classId || !Array.isArray(changedRequirements) || changedRequirements.length === 0) {
    throw new TimetableGenerationValidationError('classId and a non-empty changedRequirements array are required');
  }
  const normalized = changedRequirements.map(normalizeRequirement);
  normalized.forEach(validateRequirement);

  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new ClassValidationError(`class ${JSON.stringify(classId)} does not exist`);
  }
  await assertCanGenerateForClass(client, cls, { actorUserId, actorRole });

  const affectedBefore = [];
  for (const req of normalized) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await facultyAllocationRepository.findByClassAndSubject(client, classId, req.subject);
    affectedBefore.push(...rows);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(rows.map((row) => facultyAllocationRepository.remove(client, row.id)));
  }

  const allPeriods = await timetablePeriodRepository.findAllByCollege(client, cls.college_id);
  const sortedPeriods = [...allPeriods].sort((a, b) => {
    const dayDiff = WEEKDAY_ORDER.indexOf(a.day_of_week) - WEEKDAY_ORDER.indexOf(b.day_of_week);
    return dayDiff !== 0 ? dayDiff : a.hour_index - b.hour_index;
  });
  const periodsById = new Map(sortedPeriods.map((p) => [p.id, p]));

  const remainingForClass = await facultyAllocationRepository.findByClassId(client, classId);
  const usedPeriodIdsBaseline = new Set(remainingForClass.map((row) => row.period_id));
  const effectiveMaxHoursPerDay = maxHoursPerDay !== undefined ? maxHoursPerDay : cls.max_hours_per_day_per_staff;
  const allStaffIds = [...new Set(normalized.flatMap((req) => req.staffUserIds))];
  const dailyHoursBaseline = await loadStaffDailyHours(client, periodsById, allStaffIds, effectiveMaxHoursPerDay);

  const result = await runGenerationAttempt(client, {
    cls, requirements: normalized, orderedPeriods: sortedPeriods, usedPeriodIdsBaseline, dailyHoursBaseline, maxHoursPerDay: effectiveMaxHoursPerDay,
  });

  const workflowRequest = await submitTimetableForApproval(client, classId, { requestedByUserId: actorUserId });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: actorUserId,
    action: 'timetable_revision_proposed',
    entity: 'classes',
    entityId: classId,
    metadata: {
      affectedSubjects: normalized.map((r) => r.subject), placedCount: result.placements.length, conflictCount: result.conflicts.length,
    },
  });

  return {
    affectedSessions: result.placements,
    unaffectedSessions: remainingForClass.filter((row) => !result.placements.some((p) => p.id === row.id)),
    removedSessions: affectedBefore,
    conflicts: result.conflicts,
    workflowRequest,
  };
}

// BusinessRules.md AI Attendance Management: "AI identifies the
// current class from the approved timetable [and] confirms the
// faculty is assigned to that session or is the authorized
// substitute." Resolves, for a given staff member right now (or at a
// caller-supplied instant, for testability), which class's period they
// are scheduled to teach — checking their own faculty_allocation rows
// first, then falling back to a substitute_assignments row naming them
// for that exact (class, period, date). Returns null if no such
// session exists (outside teaching hours, or scheduled for nothing
// this period) — the caller (attendanceService's AI assistant) turns
// that into "you have no active session right now," not a guess.
//
// UTC-based day/time extraction, same tradeoff attendanceService.
// dayOfWeekName documents for its own date-only parsing: avoids a
// server-local-timezone rollover bug, at the cost of not matching a
// user's own wall-clock day exactly at midnight boundaries in other
// timezones — an accepted, documented tradeoff, not an oversight.
async function resolveCurrentSessionForStaff(client, collegeId, staffUserId, { now } = {}) {
  const instant = now || new Date();
  const dayName = DAY_NAMES[instant.getUTCDay()];
  const currentTime = instant.toISOString().slice(11, 19);
  const sessionDate = instant.toISOString().slice(0, 10);

  const period = await timetablePeriodRepository.findCurrentByCollegeAndDay(client, collegeId, dayName, currentTime);
  if (period === null) {
    return null;
  }

  const ownAllocations = await facultyAllocationRepository.findByStaffUserId(client, staffUserId);
  const ownAllocation = ownAllocations.find((a) => a.period_id === period.id);
  if (ownAllocation !== null && ownAllocation !== undefined) {
    return {
      classId: ownAllocation.class_id, periodId: period.id, hourIndex: period.hour_index, sessionDate,
    };
  }

  // No own allocation for this period — check every class's
  // substitute_assignments row for this exact (period, date) rather
  // than one specific class, since resolveCurrentSessionForStaff
  // doesn't know the class yet (that's what it's resolving); a college
  // running many classes in the same period could have several
  // substitute rows for that (period, date), one per class, so this
  // has to search across classes, not call
  // getSubstituteAssignment(classId, ...) the way assertCanMark does
  // once it already has a specific class in hand.
  const substitution = await substituteAssignmentRepository.findByStaffPeriodAndDate(client, staffUserId, period.id, sessionDate);
  if (substitution !== null) {
    return {
      classId: substitution.class_id, periodId: period.id, hourIndex: period.hour_index, sessionDate,
    };
  }

  return null;
}

// Phase 4 frontend blueprint's task-first workspace hero ("Period 2 —
// Physics, Class 10B — starts in 40 minutes.", Concept A - The
// Instrument Panel) — the one real fact worth leading the AI Workspace
// landing page with, when the actor is a staff member with a teaching
// schedule. Deliberately its own function rather than reusing
// resolveCurrentSessionForStaff above: that one only resolves the
// CURRENT period (or null) for attendance-marking purposes and never
// returns start/end times or subject/class name — a hero needs the
// next upcoming moment too ("starts in 40 minutes" is written before
// the period begins), plus enough display data to render a full
// sentence, not just an id to look up elsewhere.
//
// Substitute-assigned periods are deliberately NOT included here
// (unlike resolveCurrentSessionForStaff) — a hero fact is about the
// actor's own standing schedule; a same-day substitution is exactly
// the kind of "something changed" fact WaitingTray/notifications
// exist to surface, not a quiet swap into an ambient greeting.
//
// Same UTC-based day/time tradeoff resolveCurrentSessionForStaff
// documents for itself: avoids a server-local-timezone rollover bug,
// at the cost of not matching a user's own wall-clock day exactly at
// midnight boundaries in other timezones.
async function resolveNextTeachingMomentForStaff(client, collegeId, staffUserId, { now } = {}) {
  const instant = now || new Date();
  const dayName = DAY_NAMES[instant.getUTCDay()];
  const currentMinutes = timeToMinutes(instant.toISOString().slice(11, 19));

  const allocations = await facultyAllocationRepository.findByStaffUserId(client, staffUserId);
  if (allocations.length === 0) {
    return null;
  }

  const withPeriods = await Promise.all(allocations.map(async (allocation) => ({
    allocation, period: await timetablePeriodRepository.findById(client, allocation.period_id),
  })));

  const todaysRemaining = withPeriods
    .filter(({ period }) => period && period.college_id === collegeId
      && period.day_of_week === dayName && period.start_time && period.end_time
      && timeToMinutes(period.end_time) > currentMinutes)
    .sort((a, b) => timeToMinutes(a.period.start_time) - timeToMinutes(b.period.start_time));

  const next = todaysRemaining[0];
  if (!next) {
    return null;
  }

  const cls = await classRepository.findById(client, next.allocation.class_id);
  const startMinutes = timeToMinutes(next.period.start_time);

  return {
    status: startMinutes <= currentMinutes ? 'ongoing' : 'upcoming',
    subject: next.allocation.subject,
    classId: next.allocation.class_id,
    className: cls ? cls.class_name : null,
    hourIndex: next.period.hour_index,
    startTime: next.period.start_time,
    endTime: next.period.end_time,
    minutesUntilStart: Math.max(0, startMinutes - currentMinutes),
  };
}

// Staff landing page's weekly timetable widget — every period this
// staff member teaches (facultyAllocationRepository.findByStaffUserId,
// the same "full teaching schedule" lookup resolveNextTeachingMomentForStaff
// above already relies on), grouped by day. Unlike
// resolveNextTeachingMomentForStaff this is the actor's WHOLE standing
// week, not just "what's left today" — a separate function rather than
// widening that one's return shape, since every existing caller of it
// only ever wanted the single next moment.
async function resolveWeeklyScheduleForStaff(client, collegeId, staffUserId) {
  const allocations = await facultyAllocationRepository.findByStaffUserId(client, staffUserId);
  if (allocations.length === 0) {
    return [];
  }

  const withPeriods = await Promise.all(allocations.map(async (allocation) => ({
    allocation, period: await timetablePeriodRepository.findById(client, allocation.period_id),
  })));

  const relevant = withPeriods.filter(({ period }) => period && period.college_id === collegeId);
  const classIds = [...new Set(relevant.map(({ allocation }) => allocation.class_id))];
  const classesById = new Map(
    (await Promise.all(classIds.map((id) => classRepository.findById(client, id))))
      .filter((cls) => cls !== null)
      .map((cls) => [cls.id, cls]),
  );

  return relevant
    .map(({ allocation, period }) => ({
      dayOfWeek: period.day_of_week,
      hourIndex: period.hour_index,
      startTime: period.start_time,
      endTime: period.end_time,
      subject: allocation.subject,
      classId: allocation.class_id,
      className: classesById.get(allocation.class_id)?.class_name || null,
    }))
    .sort((a, b) => {
      const dayDiff = DAY_NAMES.indexOf(a.dayOfWeek) - DAY_NAMES.indexOf(b.dayOfWeek);
      if (dayDiff !== 0) return dayDiff;
      return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
    });
}

// Rejecting at any step ends the whole chain (workflowService's own
// rule) — mirrored onto timetable_status -> 'Rejected', matching the
// known literal HodDashboard.jsx/PrincipalDashboard.jsx already use
// for this outcome. A rejected class must go through
// submitTimetableForApproval again to re-enter the chain, same
// "resubmit as a new request" precedent workflowService.js's own
// file-level comment already documents.
async function rejectTimetableApproval(client, classId, { actorUserId, remarks } = {}) {
  const pending = await loadPendingTimetableApproval(client, classId);
  const resolved = await workflowService.rejectRequest(client, pending.id, { actorUserId, remarks });
  const cls = await classRepository.update(client, classId, { timetableStatus: 'Rejected' });

  return { workflowRequest: resolved, class: cls };
}

// Assigns a staff member to teach a subject during a specific
// (class, period) slot. No update variant is exposed here — this
// slice's own task names exactly "assign/list/remove," not "update";
// changing an existing allocation is remove-then-assign, not an
// in-place edit, even though facultyAllocationRepository.update exists
// and classRepository's own precedent has a full update path. Nothing
// asked for reassignment-in-place, so it isn't built.
async function assignFacultyAllocation(client, { collegeId, classId, periodId, subject, staffUserId }, { actorUserId } = {}) {
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
// ...ByDayAndHour, not the bare getTimetablePeriod(id) shape every
// other getX in this file uses, specifically to leave that simpler
// name free for the plain by-id lookup below — this one takes three
// arguments and answers a different question ("does a period exist
// for this slot") than "fetch this known period."
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

// Defines one shared, college-wide bell-schedule slot. No
// authorization check: same reasoning as assignFacultyAllocation —
// BusinessRules.md names no specific actor for "who may define
// periods," left to the route/RBAC layer once an API exists.
async function createTimetablePeriod(client, { collegeId, dayOfWeek, hourIndex, startTime, endTime }, { actorUserId } = {}) {
  if (!dayOfWeek || hourIndex === undefined || hourIndex === null || !startTime || !endTime) {
    throw new TimetablePeriodValidationError('dayOfWeek, hourIndex, startTime, and endTime are required');
  }

  let period;
  try {
    period = await timetablePeriodRepository.create(client, {
      collegeId,
      dayOfWeek,
      hourIndex,
      startTime,
      endTime,
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'timetable_periods_college_id_day_of_week_hour_index_key') {
      throw new TimetablePeriodSlotTakenError(
        `a period already exists for ${JSON.stringify(dayOfWeek)} hour ${JSON.stringify(hourIndex)} in this college`,
      );
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'timetable_period_created',
    entity: 'timetable_periods',
    entityId: period.id,
    metadata: null,
  });

  return period;
}

// BusinessRules.md Central audit log and Import/Export: parsing is now
// importService's job (task #18's own shared platform service,
// retrofitted here as its proof) \u2014 this function keeps only what's
// genuinely timetable-specific: which columns are required, the
// optional-allocation-columns rule, and the per-row commit/savepoint
// logic below, unchanged.
async function importTimetablePeriodsCsv(client, { collegeId, fileName = 'timetable.csv', fileBuffer }, { actorUserId } = {}) {
  if (!fileBuffer || !actorUserId) {
    throw new TimetableImportError('fileBuffer and actorUserId are required');
  }

  const rawDocument = await documentService.uploadDocument(
    client,
    { collegeId, docType: 'timetable_import', fileName, mimeType: 'text/csv', fileBuffer },
    { actorUserId },
  );

  const { headers, rows } = await importService.parseImportFile(fileBuffer, 'text/csv');
  if (rows.length === 0) {
    throw new TimetableImportError('csv must include a header and at least one row');
  }
  const required = ['day_of_week', 'hour_index', 'start_time', 'end_time'];
  for (const name of required) {
    if (!headers.includes(name)) throw new TimetableImportError(`csv missing ${name}`);
  }
  // class_id/subject/staff_user_id are optional: a plain bell-schedule
  // CSV (just the 4 required columns) still imports periods only, same
  // as before. Only rows that carry all three also get a
  // faculty_allocation row and a classes.timetable_data entry.
  const hasAllocationColumns = ['class_id', 'subject', 'staff_user_id'].every((name) => headers.includes(name));

  const imported = [];
  const skipped = [];
  const timetableDataByClassId = new Map();
  let rowNumber = 0;
  for (const row of rows) {
    rowNumber += 1;
    // Each row gets its own SAVEPOINT: a UNIQUE violation (23505)
    // otherwise poisons the whole surrounding transaction in Postgres
    // (every later statement fails with "current transaction is
    // aborted" regardless of its own validity), turning one duplicate
    // row into an all-or-nothing 500. ROLLBACK TO SAVEPOINT undoes
    // just this row's failed INSERT and clears the aborted state,
    // letting the loop continue.
    const savepoint = `csv_import_row_${rowNumber}`;
    try {
      // eslint-disable-next-line no-await-in-loop
      await client.query(`SAVEPOINT ${savepoint}`);
      // eslint-disable-next-line no-await-in-loop
      const period = await createTimetablePeriod(client, {
        collegeId,
        dayOfWeek: row.day_of_week,
        hourIndex: Number(row.hour_index),
        startTime: row.start_time,
        endTime: row.end_time,
      }, { actorUserId });
      if (hasAllocationColumns && row.class_id && row.subject && row.staff_user_id) {
        // eslint-disable-next-line no-await-in-loop
        await assignFacultyAllocation(client, {
          collegeId,
          classId: row.class_id,
          periodId: period.id,
          subject: row.subject,
          staffUserId: row.staff_user_id,
        }, { actorUserId });
        if (!timetableDataByClassId.has(row.class_id)) timetableDataByClassId.set(row.class_id, []);
        timetableDataByClassId.get(row.class_id).push({
          periodId: period.id,
          dayOfWeek: row.day_of_week,
          hourIndex: Number(row.hour_index),
          startTime: row.start_time,
          endTime: row.end_time,
          subject: row.subject,
          staffUserId: row.staff_user_id,
        });
      }
      // eslint-disable-next-line no-await-in-loop
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      imported.push({ row: rowNumber, dayOfWeek: row.day_of_week, hourIndex: Number(row.hour_index) });
    } catch (err) {
      if (
        err instanceof TimetablePeriodSlotTakenError
        || err instanceof FacultyAllocationPeriodTakenError
        || err instanceof FacultyAllocationStaffConflictError
      ) {
        // eslint-disable-next-line no-await-in-loop
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        skipped.push({ row: rowNumber, reason: err.message });
      } else {
        throw err;
      }
    }
  }

  // Merge, don't overwrite: a class's timetable_data may already carry
  // entries from a prior import or manual update.
  for (const [classId, entries] of timetableDataByClassId.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const cls = await classRepository.findById(client, classId);
    if (cls === null) continue;
    const existing = Array.isArray(cls.timetable_data) ? cls.timetable_data : [];
    // node-pg serializes a raw JS array parameter as a Postgres ARRAY
    // literal, not JSON text — invalid for a jsonb column. Must be
    // JSON.stringify'd first, same driver quirk workflowRepository.js's
    // own toRow() already works around for approverChain/actionManifest.
    // eslint-disable-next-line no-await-in-loop
    await classRepository.update(client, classId, { timetableData: JSON.stringify([...existing, ...entries]) });
  }

  return { rawDocumentId: rawDocument.id, imported, skipped, totalRows: rows.length };
}

// null means no period exists with this id — not an error. The route
// turns that into 404, same as getClass/getFacultyAllocation.
async function getTimetablePeriod(client, id) {
  return timetablePeriodRepository.findById(client, id);
}

async function listTimetablePeriods(client, { limit, offset } = {}) {
  return timetablePeriodRepository.list(client, { limit, offset });
}

// Looks the period up first, both to get collegeId for the audit
// entry and to avoid logging a removal for an id that never existed —
// same shape as removeClass/removeFacultyAllocation. Maps the FK
// RESTRICT case (a faculty_allocation row still references this
// period) to a real domain error instead of a raw pg one; every other
// removeX in this file hard-deletes without needing this because
// nothing else FKs into classes/faculty_allocation/students/staff the
// way faculty_allocation FKs into timetable_periods.
async function removeTimetablePeriod(client, id, { actorUserId } = {}) {
  const period = await timetablePeriodRepository.findById(client, id);
  if (period === null) {
    return null;
  }

  try {
    await timetablePeriodRepository.remove(client, id);
  } catch (err) {
    if (err.code === '23503' && err.constraint === 'faculty_allocation_period_id_fkey') {
      throw new TimetablePeriodInUseError(
        `period ${JSON.stringify(id)} still has faculty_allocation rows referencing it`,
      );
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: period.college_id,
    userId: actorUserId,
    action: 'timetable_period_removed',
    entity: 'timetable_periods',
    entityId: id,
    metadata: null,
  });

  return period;
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
//
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
  // this same file's own wrapper around facultyAllocationRepository —
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
      throw new ClassSendAlertNotAssignedError(`user ${JSON.stringify(actorUserId)} is not the tutor or assigned faculty of class ${JSON.stringify(classId)}`);
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

  let targetClassIds;
  if (classIds === null) {
    const classes = await listClasses(client, { limit: CLASS_TIMETABLE_SCOPE_LIMIT });
    targetClassIds = classes.map((cls) => cls.id);
  } else {
    targetClassIds = classIds;
  }
  if (targetClassIds.length === 0) {
    return [];
  }

  return Promise.all(targetClassIds.map(async (classId) => {
    const cls = await classRepository.findById(client, classId);
    const allocations = await listFacultyAllocationsForClass(client, classId);
    return { classId, className: cls ? cls.class_name : null, allocations };
  }));
}

module.exports = {
  ClassValidationError,
  ClassTimetableStatusError,
  ClassNameConflictError,
  ClassTutorConflictError,
  ClassTutorNotFoundError,
  ClassDepartmentNotFoundError,
  ClassTimetableStatusManagedByWorkflowError,
  ClassTimetableApprovalNotPendingError,
  SubstituteAssignmentValidationError,
  SubstituteAssignmentPeriodNotFoundError,
  SubstituteAssignmentConflictError,
  SubstituteAssignmentNotAuthorizedError,
  SubstituteAssignmentCandidateNotFoundError,
  SubstituteAssignmentCandidateNotInDepartmentError,
  SubstituteAssignmentCandidateNotFreeError,
  SubstituteAssignmentRequestNotFoundError,
  SubstituteAssignmentNotFoundError,
  ClassGenerationValidationError,
  TimetableGenerationValidationError,
  TimetableGenerationClassApprovedError,
  TimetableGenerationForbiddenError,
  TimetableConfigValidationError,
  FacultyAllocationValidationError,
  FacultyAllocationClassNotFoundError,
  FacultyAllocationPeriodNotFoundError,
  FacultyAllocationStaffNotFoundError,
  FacultyAllocationPeriodTakenError,
  FacultyAllocationStaffConflictError,
  TimetablePeriodValidationError,
  TimetablePeriodSlotTakenError,
  TimetablePeriodInUseError,
  TimetableImportError,
  ClassSendAlertValidationError,
  ClassSendAlertNotAssignedError,
  sendClassAlert,
  createClass,
  getClass,
  resolveClassId,
  updateClass,
  removeClass,
  listClasses,
  generateClassesForDepartment,
  submitTimetableForApproval,
  approveTimetableApproval,
  rejectTimetableApproval,
  getEffectiveTimetableRevision,
  listTimetableRevisions,
  requestSubstituteAssignment,
  approveSubstituteAssignment,
  rejectSubstituteAssignment,
  getSubstituteAssignment,
  listSubstituteAssignmentsForClass,
  listMySubstituteAssignments,
  acknowledgeSubstituteAssignment,
  generateTimetable,
  generateSlotGrid,
  reviseTimetable,
  resolveCurrentSessionForStaff,
  resolveNextTeachingMomentForStaff,
  resolveWeeklyScheduleForStaff,
  assignFacultyAllocation,
  getFacultyAllocation,
  listFacultyAllocationsForClass,
  listFacultyAllocationsForStaff,
  removeFacultyAllocation,
  getTimetablePeriodByDayAndHour,
  getFacultyAllocationForClassAndPeriod,
  createTimetablePeriod,
  importTimetablePeriodsCsv,
  getTimetablePeriod,
  listTimetablePeriods,
  removeTimetablePeriod,
  getClassTimetableForActor,
};
