'use strict';

// RS-CLS-007 (ADL-004: "New state machine replacing the current direct
// HOD-assigns implementation"): "A substitute may act only after L3
// approves; the absent staff member, L3, or the class's L4 may
// initiate the request." Replaces the old direct-assign assignSubstitute
// (which INSERTed the fact immediately) with a genuine request ->
// L3-approval flow, same shape studentService.requestLifecycleStatusChange/
// staffService.submitStaffRegistration already established: this
// module only stages the PROPOSED data (substituteAssignmentRequestRepository,
// a permanent record of what was asked for) and submits it into a
// workflowChainService-resolved chain; the real substitute_assignments
// row (the fact substituteAssignmentRepository/assertCanMark consume)
// is only ever created by approveSubstituteAssignment below, on the
// chain's terminal Approved outcome.

const classRepository = require('../../repositories/classRepository');
const facultyAllocationRepository = require('../../repositories/facultyAllocationRepository');
const substituteAssignmentRepository = require('../../repositories/substituteAssignmentRepository');
const substituteAssignmentRequestRepository = require('../../repositories/substituteAssignmentRequestRepository');
const substituteAssignmentAcknowledgementRepository = require('../../repositories/substituteAssignmentAcknowledgementRepository');
const authRepository = require('../../repositories/authRepository');
const auditLogRepository = require('../../repositories/auditLogRepository');
const workflowService = require('../workflowService');
const workflowChainService = require('../workflowChainService');
const staffService = require('../staffService');
const notificationService = require('../notificationService');
const identityService = require('../identityService');
const {
  ClassValidationError,
  SubstituteAssignmentValidationError,
  SubstituteAssignmentPeriodNotFoundError,
  SubstituteAssignmentConflictError,
  SubstituteAssignmentNotAuthorizedError,
  SubstituteAssignmentCandidateNotFoundError,
  SubstituteAssignmentCandidateNotInDepartmentError,
  SubstituteAssignmentCandidateNotFreeError,
  SubstituteAssignmentRequestNotFoundError,
  SubstituteAssignmentNotFoundError,
} = require('./errors');

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
async function requestSubstituteAssignment(
  client,
  { classId, timetablePeriodId, assignmentDate, originalStaffUserId, substituteStaffUserId, reason },
  { requestedByUserId, requestedByRole, origin = 'human' } = {},
) {
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
    ? await identityService.resolvePositionOccupant(client, {
        collegeId: cls.college_id,
        departmentId: cls.department_id,
      })
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
    throw new SubstituteAssignmentCandidateNotFoundError(
      `no staff profile exists for user ${JSON.stringify(substituteStaffUserId)}`,
    );
  }
  if (cls.department_id && candidate.department_id !== cls.department_id) {
    throw new SubstituteAssignmentCandidateNotInDepartmentError(
      `user ${JSON.stringify(substituteStaffUserId)} is not in the same department as class ${JSON.stringify(classId)}`,
    );
  }
  const candidateOwnAllocations = await facultyAllocationRepository.findByStaffUserId(client, substituteStaffUserId);
  const hasRegularClash = candidateOwnAllocations.some((a) => a.period_id === timetablePeriodId);
  const existingSubstitution = await substituteAssignmentRepository.findByStaffPeriodAndDate(
    client,
    substituteStaffUserId,
    timetablePeriodId,
    assignmentDate,
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
    throw new SubstituteAssignmentRequestNotFoundError(
      `substitute assignment request ${JSON.stringify(requestId)} does not exist`,
    );
  }

  const pending = await workflowService.findPendingForEntity(client, 'substitute_assignment', requestId);
  if (pending === null) {
    throw new SubstituteAssignmentRequestNotFoundError(
      `substitute assignment request ${JSON.stringify(requestId)} has no pending approval request`,
    );
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
      throw new SubstituteAssignmentPeriodNotFoundError(
        `timetable period ${JSON.stringify(request.timetable_period_id)} does not exist`,
      );
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

module.exports = {
  requestSubstituteAssignment,
  loadPendingSubstituteAssignmentRequest,
  approveSubstituteAssignment,
  rejectSubstituteAssignment,
  getSubstituteAssignment,
  listSubstituteAssignmentsForClass,
  listMySubstituteAssignments,
  acknowledgeSubstituteAssignment,
};
