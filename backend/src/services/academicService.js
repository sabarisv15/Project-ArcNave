'use strict';

// Thin facade over services/academic/* — same split-file pattern
// identityService.js established for services/identity/*: this file
// owns no logic of its own, only requires each cohesive submodule
// below and re-exports the same public names academicService.js
// always exported, so every one of the 15+ existing call sites
// (routes/*, other services, tests) that requires
// '../services/academicService' keeps working with zero changes.
// Submodules never require this file back, and never require each
// other in a cycle — see each submodule's own header for its actual
// cross-submodule calls (e.g. timetableGeneration.js reusing
// timetableApproval.js's submitTimetableForApproval for reviseTimetable,
// timetablePeriods.js reusing facultyAllocation.js's
// assignFacultyAllocation for CSV import, classAlerts.js reusing both
// facultyAllocation.js and classes.js). Explicit named re-exports
// below, not a wildcard spread of each submodule's own module.exports —
// several submodules export extra internal helpers for their own unit
// testability (e.g. classes.js's pickClassFields, timetableGeneration.js's
// normalizeRequirement) that this file was never a public export for,
// so the facade cherry-picks only the names academicService.js already
// promised its callers.
//
// Why AcademicService owns this much: Architecture.md 2.5's own
// Business Services table lists "classes," "timetable," and "faculty
// allocation" together as one service's responsibility, not inferred —
// see services/academic/classes.js, timetableGeneration.js,
// timetableApproval.js, and facultyAllocation.js for the reasoning
// specific to each. CLAUDE.md rule 3 (WorkflowService is the sole
// approval gate) and rule 1 (AI tools call Business Services, never
// repositories) both apply uniformly across every submodule here, same
// as they did when this was one file.

const errors = require('./academic/errors');
const classes = require('./academic/classes');
const facultyAllocation = require('./academic/facultyAllocation');
const timetableApproval = require('./academic/timetableApproval');
const timetableGeneration = require('./academic/timetableGeneration');
const timetablePeriods = require('./academic/timetablePeriods');
const substituteAssignment = require('./academic/substituteAssignment');
const staffSchedule = require('./academic/staffSchedule');
const classAlerts = require('./academic/classAlerts');

module.exports = {
  // Errors
  ClassValidationError: errors.ClassValidationError,
  ClassTimetableStatusError: errors.ClassTimetableStatusError,
  ClassNameConflictError: errors.ClassNameConflictError,
  ClassTutorConflictError: errors.ClassTutorConflictError,
  ClassTutorNotFoundError: errors.ClassTutorNotFoundError,
  ClassDepartmentNotFoundError: errors.ClassDepartmentNotFoundError,
  ClassTimetableStatusManagedByWorkflowError: errors.ClassTimetableStatusManagedByWorkflowError,
  ClassTimetableApprovalNotPendingError: errors.ClassTimetableApprovalNotPendingError,
  SubstituteAssignmentValidationError: errors.SubstituteAssignmentValidationError,
  SubstituteAssignmentPeriodNotFoundError: errors.SubstituteAssignmentPeriodNotFoundError,
  SubstituteAssignmentConflictError: errors.SubstituteAssignmentConflictError,
  SubstituteAssignmentNotAuthorizedError: errors.SubstituteAssignmentNotAuthorizedError,
  SubstituteAssignmentCandidateNotFoundError: errors.SubstituteAssignmentCandidateNotFoundError,
  SubstituteAssignmentCandidateNotInDepartmentError: errors.SubstituteAssignmentCandidateNotInDepartmentError,
  SubstituteAssignmentCandidateNotFreeError: errors.SubstituteAssignmentCandidateNotFreeError,
  SubstituteAssignmentRequestNotFoundError: errors.SubstituteAssignmentRequestNotFoundError,
  SubstituteAssignmentNotFoundError: errors.SubstituteAssignmentNotFoundError,
  ClassGenerationValidationError: errors.ClassGenerationValidationError,
  TimetableGenerationValidationError: errors.TimetableGenerationValidationError,
  TimetableGenerationClassApprovedError: errors.TimetableGenerationClassApprovedError,
  TimetableGenerationForbiddenError: errors.TimetableGenerationForbiddenError,
  TimetableConfigValidationError: errors.TimetableConfigValidationError,
  FacultyAllocationValidationError: errors.FacultyAllocationValidationError,
  FacultyAllocationClassNotFoundError: errors.FacultyAllocationClassNotFoundError,
  FacultyAllocationPeriodNotFoundError: errors.FacultyAllocationPeriodNotFoundError,
  FacultyAllocationStaffNotFoundError: errors.FacultyAllocationStaffNotFoundError,
  FacultyAllocationPeriodTakenError: errors.FacultyAllocationPeriodTakenError,
  FacultyAllocationStaffConflictError: errors.FacultyAllocationStaffConflictError,
  TimetablePeriodValidationError: errors.TimetablePeriodValidationError,
  TimetablePeriodSlotTakenError: errors.TimetablePeriodSlotTakenError,
  TimetablePeriodInUseError: errors.TimetablePeriodInUseError,
  TimetableImportError: errors.TimetableImportError,
  ClassSendAlertValidationError: errors.ClassSendAlertValidationError,
  ClassSendAlertNotAssignedError: errors.ClassSendAlertNotAssignedError,

  // classAlerts.js
  sendClassAlert: classAlerts.sendClassAlert,

  // classes.js
  createClass: classes.createClass,
  getClass: classes.getClass,
  resolveClassId: classes.resolveClassId,
  updateClass: classes.updateClass,
  removeClass: classes.removeClass,
  listClasses: classes.listClasses,
  generateClassesForDepartment: classes.generateClassesForDepartment,

  // timetableApproval.js
  submitTimetableForApproval: timetableApproval.submitTimetableForApproval,
  approveTimetableApproval: timetableApproval.approveTimetableApproval,
  rejectTimetableApproval: timetableApproval.rejectTimetableApproval,
  getEffectiveTimetableRevision: timetableApproval.getEffectiveTimetableRevision,
  listTimetableRevisions: timetableApproval.listTimetableRevisions,

  // substituteAssignment.js
  requestSubstituteAssignment: substituteAssignment.requestSubstituteAssignment,
  approveSubstituteAssignment: substituteAssignment.approveSubstituteAssignment,
  rejectSubstituteAssignment: substituteAssignment.rejectSubstituteAssignment,
  getSubstituteAssignment: substituteAssignment.getSubstituteAssignment,
  listSubstituteAssignmentsForClass: substituteAssignment.listSubstituteAssignmentsForClass,
  listMySubstituteAssignments: substituteAssignment.listMySubstituteAssignments,
  acknowledgeSubstituteAssignment: substituteAssignment.acknowledgeSubstituteAssignment,

  // timetableGeneration.js
  generateTimetable: timetableGeneration.generateTimetable,
  generateSlotGrid: timetableGeneration.generateSlotGrid,
  reviseTimetable: timetableGeneration.reviseTimetable,

  // staffSchedule.js
  resolveCurrentSessionForStaff: staffSchedule.resolveCurrentSessionForStaff,
  resolveNextTeachingMomentForStaff: staffSchedule.resolveNextTeachingMomentForStaff,
  resolveWeeklyScheduleForStaff: staffSchedule.resolveWeeklyScheduleForStaff,

  // facultyAllocation.js
  assignFacultyAllocation: facultyAllocation.assignFacultyAllocation,
  getFacultyAllocation: facultyAllocation.getFacultyAllocation,
  listFacultyAllocationsForClass: facultyAllocation.listFacultyAllocationsForClass,
  listFacultyAllocationsForStaff: facultyAllocation.listFacultyAllocationsForStaff,
  removeFacultyAllocation: facultyAllocation.removeFacultyAllocation,
  getTimetablePeriodByDayAndHour: facultyAllocation.getTimetablePeriodByDayAndHour,
  getFacultyAllocationForClassAndPeriod: facultyAllocation.getFacultyAllocationForClassAndPeriod,

  // timetablePeriods.js
  createTimetablePeriod: timetablePeriods.createTimetablePeriod,
  importTimetablePeriodsCsv: timetablePeriods.importTimetablePeriodsCsv,
  getTimetablePeriod: timetablePeriods.getTimetablePeriod,
  getTimetablePeriodsByIds: timetablePeriods.getTimetablePeriodsByIds,
  listTimetablePeriods: timetablePeriods.listTimetablePeriods,
  removeTimetablePeriod: timetablePeriods.removeTimetablePeriod,

  // classAlerts.js
  getClassTimetableForActor: classAlerts.getClassTimetableForActor,
};
