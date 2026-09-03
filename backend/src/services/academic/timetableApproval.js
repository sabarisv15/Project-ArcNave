'use strict';

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

const classRepository = require('../../repositories/classRepository');
const timetableRevisionRepository = require('../../repositories/timetableRevisionRepository');
const workflowService = require('../workflowService');
const workflowChainService = require('../workflowChainService');
const { ClassValidationError, ClassTimetableApprovalNotPendingError } = require('./errors');

async function submitTimetableForApproval(client, classId, { requestedByUserId, origin = 'human' } = {}) {
  if (!requestedByUserId) {
    throw new ClassValidationError('requestedByUserId is required');
  }

  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new ClassValidationError(`class ${JSON.stringify(classId)} does not exist`);
  }
  if (!cls.department_id) {
    throw new ClassValidationError(
      `class ${JSON.stringify(classId)} has no departmentId set, cannot resolve an hod approver`,
    );
  }

  // BusinessRules.md Configurable approval workflow: reads the
  // institution's own configured chain for 'timetable_approval'
  // (category 'workflow_chains'), falling back to the same hod->principal
  // default this codebase always used — an institution that hasn't
  // configured anything sees identical behavior to before this slice.
  const approverChain = await workflowChainService.resolveApproverChain(client, {
    collegeId: cls.college_id,
    entityType: 'timetable_approval',
    classId: cls.id,
    departmentId: cls.department_id,
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
    throw new ClassTimetableApprovalNotPendingError(
      `class ${JSON.stringify(classId)} has no pending timetable approval request`,
    );
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

module.exports = {
  submitTimetableForApproval,
  loadPendingTimetableApproval,
  approveTimetableApproval,
  rejectTimetableApproval,
  getEffectiveTimetableRevision,
  listTimetableRevisions,
};
