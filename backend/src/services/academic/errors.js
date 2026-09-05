'use strict';

// Every domain error academicService.js's submodules throw, collected
// in one place so every submodule (and the facade re-exporting them)
// requires a single, stable file rather than reaching into whichever
// submodule happens to define a given error. Mirrors the "one shared
// place for cross-cutting pieces" role services/identity/*'s own
// resolvers give positionRepository.js — these classes carry no logic
// of their own, just identity, so there is no meaningful "cohesive
// submodule" for any one of them to live in instead.

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

// faculty_allocation_period_id_fkey violated (Postgres 23503) —
// the given periodId doesn't exist in timetable_periods.
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

// Thrown by generateClassesForDepartment (services/academic/classes.js)
// when courseDuration is not an integer >= 2 or defaultSections is not
// a positive integer — RS-CLS-001/RS-CLS-002's own required inputs for
// auto-generating a department's classes. See classes.js's own header
// comment on generateClassesForDepartment for the full reasoning (year
// 1 always excluded, section labeling, semester numbering).
class ClassGenerationValidationError extends Error {}

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
};
