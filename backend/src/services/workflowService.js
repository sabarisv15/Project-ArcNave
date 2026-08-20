'use strict';

// Business logic for Module 8's `workflow_requests` and
// `approval_history` — validation, actor authorization, and audit
// logging on top of workflowRepository.js/approvalHistoryRepository.js,
// neither of which does either (CLAUDE.md rule 1). This is the
// WorkflowService named throughout Architecture.md 2.5/CLAUDE.md rule
// 3 as the sole approval gate for both human- and AI-initiated
// (Level 3 Act) actions — ADR-005: one engine, not two. Never calls
// one repository from the other (CLAUDE.md rule 4), and never touches
// a different service's repository (Architecture.md 2.5 — this file
// owns workflow_requests/approval_history only; StaffService/
// FinanceService/etc. call submitRequest/approveRequest/rejectRequest
// here, never the other way).
//
// No API/UI yet, and no caller wired up yet either — StaffService's
// registration chain and FinanceService's fee_structures approval gap
// both still point at this table (see the Module 8 migration's own
// file-level comment) but neither calls in. That wiring is a later
// slice, same "out of scope here, not stubbed" discipline
// financeService.js's own file-level comment already documents for
// this exact gap.
//
// ADR-005's open question, resolved here: a requester may not approve
// their own request, regardless of origin ('human' or 'ai' — CLAUDE.md
// rule 3 draws no distinction between who proposed an action once it
// reaches approval) or of whether they happen to also appear in the
// chain at their own current step. assertNotSelfApproval enforces this
// as a real, structural rejection (WorkflowRequestSelfApprovalError),
// not a documentation-only rule a caller could accidentally skip.
// Scoped to approveRequest only, not rejectRequest: rejecting your own
// request is withdrawing it, not bypassing the gate the rule exists to
// protect — there is no self-authorization concern in ending your own
// pending request early.
//
// approver_chain resolution (who is the actual HOD of the department
// named in a staff registration request, etc.) is explicitly not this
// service's job — submitRequest persists whatever ordered
// {step, role, user_id} array the calling service already resolved,
// the same division of responsibility the Module 8 migration's own
// file-level comment already draws. What this service does enforce
// is the array's own shape (sequential, 1-indexed steps matching
// array position) and, at approve/reject time, that the acting user
// really is the entry at current_step — never a role name alone,
// since a role isn't an identity (same reasoning classes.tutor_user_id/
// attendance_sessions.marked_by_user_id already established: a
// specific users.id, never a bare role string).
//
// Rejecting at any step ends the whole chain (status -> 'Rejected'),
// not just that step — a chain has no "resume from a later step after
// an earlier rejection" concept; a rejected request must be
// resubmitted as a new workflow_requests row (the partial unique index
// on (college_id, entity_type, entity_id) WHERE status = 'Pending'
// allows exactly that once the old row is resolved).

const workflowRepository = require('../repositories/workflowRepository');
const approvalHistoryRepository = require('../repositories/approvalHistoryRepository');
const auditLogRepository = require('../repositories/auditLogRepository');

// Missing collegeId, entityType, entityId, requestedByUserId, origin,
// or a well-formed approverChain — workflow_requests' own NOT NULL
// columns, raised before any repository call, same as every other
// pre-query guard in this codebase. Also raised by approveRequest/
// rejectRequest when actorUserId itself is missing — there is no
// "anonymous approval," same reasoning attendanceService.markAttendance's
// own actor-identity guard gives.
class WorkflowRequestValidationError extends Error {}

// origin has no DB CHECK constraint (see the migration's own file-level
// comment) — known values ('human'|'ai') enforced here, same house
// convention as academicService.ClassTimetableStatusError.
class WorkflowRequestOriginError extends Error {}

// workflow_requests_requested_by_user_id_fkey violated (Postgres
// 23503) — the given requestedByUserId doesn't exist.
class WorkflowRequestUserNotFoundError extends Error {}

// workflow_requests_entity_pending_key (the partial unique index)
// violated (Postgres 23505) — this entity already has a live Pending
// request.
class WorkflowRequestConflictError extends Error {}

// approveRequest/rejectRequest given an id with no matching row. Not
// the "return null, let the route 404" shape getFeeStructure-style
// getters use (Architecture.md's plain single-entity fetch) — approve/
// reject cannot proceed at all without the row's own approver_chain
// and current_step to validate against, same "a required lookup, not
// an optional fetch" precedent attendanceService.AttendanceClassNotFoundError
// already set for markAttendance's own classId lookup.
class WorkflowRequestNotFoundError extends Error {}

// The request's status is no longer 'Pending' (already Approved or
// Rejected) — a resolved request cannot be acted on again; the caller
// must submit a new request instead.
class WorkflowRequestAlreadyResolvedError extends Error {}

// actorUserId does not match approver_chain[current_step - 1].user_id
// — either the wrong person entirely, or someone whose turn in the
// chain has not arrived (or has already passed) yet.
class WorkflowRequestStepMismatchError extends Error {}

// ADR-005's resolved open question: actorUserId === the request's own
// requested_by_user_id. See the file-level comment for why this is
// enforced only on approveRequest, not rejectRequest.
class WorkflowRequestSelfApprovalError extends Error {}

const VALID_ORIGINS = ['human', 'ai'];

function assertValidOrigin(origin) {
  if (!VALID_ORIGINS.includes(origin)) {
    throw new WorkflowRequestOriginError(`origin ${JSON.stringify(origin)} is not a known value`);
  }
}

// Sequential, 1-indexed, matching array position — current_step - 1
// is used to index straight into this array (see
// workflowRepository.findPendingForApprover's own JSONB path
// expression), so a chain that skipped or misordered a step number
// would silently break that lookup rather than error loudly here.
function assertValidApproverChain(approverChain) {
  if (!Array.isArray(approverChain) || approverChain.length === 0) {
    throw new WorkflowRequestValidationError('approverChain must be a non-empty array');
  }
  approverChain.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || !entry.user_id || !entry.role || entry.step !== index + 1) {
      throw new WorkflowRequestValidationError(
        `approverChain[${index}] must be {step: ${index + 1}, role, user_id}`,
      );
    }
  });
}

// actionManifest is optional and origin-agnostic in this function's own
// signature (any caller could pass one), but in practice only ever
// arrives from an AI L3 tool call today — aiToolRegistry.js's
// buildActionManifest is the one real producer (AI-Governance.md §1's
// Action Manifest, deferred until a real L3 tool existed to design it
// against — see that file's own comment). Every human-initiated
// submitRequest call (staffService/financeService/notificationService's
// human path) simply omits it, leaving the column null — not backfilled,
// not required.
async function submitRequest(client, {
  collegeId, entityType, entityId, requestedByUserId, origin, approverChain, actionManifest,
}) {
  if (!collegeId || !entityType || !entityId || !requestedByUserId || !origin) {
    throw new WorkflowRequestValidationError(
      'collegeId, entityType, entityId, requestedByUserId, and origin are required',
    );
  }
  assertValidOrigin(origin);
  assertValidApproverChain(approverChain);

  let request;
  try {
    request = await workflowRepository.create(client, {
      collegeId,
      entityType,
      entityId,
      requestedByUserId,
      origin,
      approverChain,
      actionManifest: actionManifest || null,
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'workflow_requests_entity_pending_key') {
      throw new WorkflowRequestConflictError(
        `a pending workflow request already exists for entityType ${JSON.stringify(entityType)}, entityId ${JSON.stringify(entityId)}`,
      );
    }
    if (err.code === '23503' && err.constraint === 'workflow_requests_requested_by_user_id_fkey') {
      throw new WorkflowRequestUserNotFoundError(`requestedByUserId ${JSON.stringify(requestedByUserId)} does not exist`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: requestedByUserId,
    action: 'workflow_request_submitted',
    entity: 'workflow_requests',
    entityId: request.id,
    metadata: null,
  });

  return request;
}

// Shared load+validate for approveRequest/rejectRequest: the row must
// exist, still be Pending, and actorUserId must be the resolved
// approver for whichever step is current — every check a step action
// needs regardless of which action (approve/reject) it ends up being.
async function loadPendingStepForActor(client, id, actorUserId) {
  const request = await workflowRepository.findById(client, id);
  if (request === null) {
    throw new WorkflowRequestNotFoundError(`workflow request ${JSON.stringify(id)} does not exist`);
  }
  if (request.status !== 'Pending') {
    throw new WorkflowRequestAlreadyResolvedError(
      `workflow request ${JSON.stringify(id)} is already ${request.status}, not Pending`,
    );
  }

  const stepEntry = request.approver_chain[request.current_step - 1];
  if (!stepEntry || stepEntry.user_id !== actorUserId) {
    throw new WorkflowRequestStepMismatchError(
      `user ${JSON.stringify(actorUserId)} is not the approver for step ${request.current_step} of workflow request ${JSON.stringify(id)}`,
    );
  }

  return request;
}

function assertNotSelfApproval(request, actorUserId) {
  if (actorUserId === request.requested_by_user_id) {
    throw new WorkflowRequestSelfApprovalError(
      `user ${JSON.stringify(actorUserId)} requested workflow request ${JSON.stringify(request.id)} and may not approve it (ADR-005)`,
    );
  }
}

// Approves the current step. Advances current_step if more steps
// remain, otherwise closes the whole request (status -> 'Approved').
// Either way, one approval_history row is written first — the ledger
// records the action taken even if the subsequent workflow_requests
// update were ever to fail, same "write the fact, then react to it"
// ordering reportService.js's own generated_reports row uses.
async function approveRequest(client, id, { actorUserId, remarks } = {}) {
  if (!actorUserId) {
    throw new WorkflowRequestValidationError('actorUserId is required');
  }

  const request = await loadPendingStepForActor(client, id, actorUserId);
  assertNotSelfApproval(request, actorUserId);

  // The guarded state transition runs FIRST, before either write below
  // — see workflowRepository.updatePendingStatus's own comment for why
  // this closes the concurrent-double-approval race. Ordering this
  // ahead of recordAction/the audit log (not just adding the guard) is
  // itself load-bearing: a caller who loses the race gets ZERO side
  // effects, not a stray approval_history/audit_log row claiming an
  // approval that never actually took effect.
  const isFinalStep = request.current_step >= request.approver_chain.length;
  const updated = await workflowRepository.updatePendingStatus(
    client,
    id,
    isFinalStep ? { status: 'Approved' } : { currentStep: request.current_step + 1 },
  );
  if (updated === null) {
    throw new WorkflowRequestAlreadyResolvedError(
      `workflow request ${JSON.stringify(id)} was already resolved by a concurrent request`,
    );
  }

  await approvalHistoryRepository.recordAction(client, {
    collegeId: request.college_id,
    workflowRequestId: id,
    step: request.current_step,
    actorUserId,
    action: 'Approved',
    remarks: remarks || null,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: request.college_id,
    userId: actorUserId,
    action: 'workflow_request_approved',
    entity: 'workflow_requests',
    entityId: id,
    metadata: null,
  });

  return updated;
}

// RS-DAT-002's discretionary-escalation half of structural pattern P1
// (RS-ATT-004/RS-ASM-003, D9/D7, ADL-009/ADL-014): the CURRENT step's
// approver may, at their own discretion, append one more step to the
// SAME pending request rather than resolving it — never a system-
// enforced severity classification, so this never runs automatically,
// only when a caller (attendanceService.escalateAttendanceCorrection/
// assessmentService.escalateMarkCorrection) explicitly invokes it. The
// request stays Pending throughout; only approver_chain and
// current_step change, exactly the "final by default, escalation is
// additive" shape the rule describes — not a reject-and-resubmit.
//
// Only escalable from the chain's own final step: this function
// appends past the end of approver_chain and always advances
// current_step to that new final position. Every real caller today
// (attendance_correction/mark_correction, both single-tier ['tutor'])
// only ever calls this from the one and only step, so this is not a
// narrowing of real behavior — but a caller sitting mid-chain (a future
// multi-step chain) escalating would otherwise silently skip its own
// remaining, already-configured steps by jumping straight to the
// appended one. Rejected outright instead.
async function escalateRequest(client, id, {
  actorUserId, escalateToRole, escalateToUserId, remarks,
} = {}) {
  if (!actorUserId) {
    throw new WorkflowRequestValidationError('actorUserId is required');
  }
  if (!escalateToRole || !escalateToUserId) {
    throw new WorkflowRequestValidationError('escalateToRole and escalateToUserId are required');
  }

  const request = await loadPendingStepForActor(client, id, actorUserId);
  if (request.current_step !== request.approver_chain.length) {
    throw new WorkflowRequestValidationError(
      `workflow request ${JSON.stringify(id)} cannot be escalated mid-chain — only its final configured step may escalate`,
    );
  }

  const nextStep = request.approver_chain.length + 1;
  const approverChain = [...request.approver_chain, { step: nextStep, role: escalateToRole, user_id: escalateToUserId }];

  // Guarded update first — same reasoning as approveRequest's own
  // comment: a race loser gets no approval_history/audit_log row.
  const updated = await workflowRepository.updatePendingStatus(client, id, { approverChain, currentStep: nextStep });
  if (updated === null) {
    throw new WorkflowRequestAlreadyResolvedError(
      `workflow request ${JSON.stringify(id)} was already resolved by a concurrent request`,
    );
  }

  await approvalHistoryRepository.recordAction(client, {
    collegeId: request.college_id,
    workflowRequestId: id,
    step: request.current_step,
    actorUserId,
    action: 'Escalated',
    remarks: remarks || null,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: request.college_id,
    userId: actorUserId,
    action: 'workflow_request_escalated',
    entity: 'workflow_requests',
    entityId: id,
    metadata: { escalateToRole },
  });

  return updated;
}

// Rejects the current step, which ends the whole chain regardless of
// how many steps remained — see the file-level comment.
async function rejectRequest(client, id, { actorUserId, remarks } = {}) {
  if (!actorUserId) {
    throw new WorkflowRequestValidationError('actorUserId is required');
  }

  const request = await loadPendingStepForActor(client, id, actorUserId);

  // Guarded update first — same reasoning as approveRequest's own
  // comment: a race loser gets no approval_history/audit_log row.
  const updated = await workflowRepository.updatePendingStatus(client, id, { status: 'Rejected' });
  if (updated === null) {
    throw new WorkflowRequestAlreadyResolvedError(
      `workflow request ${JSON.stringify(id)} was already resolved by a concurrent request`,
    );
  }

  await approvalHistoryRepository.recordAction(client, {
    collegeId: request.college_id,
    workflowRequestId: id,
    step: request.current_step,
    actorUserId,
    action: 'Rejected',
    remarks: remarks || null,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: request.college_id,
    userId: actorUserId,
    action: 'workflow_request_rejected',
    entity: 'workflow_requests',
    entityId: id,
    metadata: null,
  });

  return updated;
}

// A plain read by the workflow_requests row's own id — needed by
// routes/workflowRequests.js to resolve entity_type/entity_id before
// dispatching approve/reject to the right entity-specific service
// (staffService.approveStaffRegistration/financeService.approveFeeStructure
// each take their OWN entity's id, not a workflow_requests id, so the
// route has to learn which entity this row governs before it can call
// either one). A pure read, not new approval logic — same "thin
// wrapper" precedent findPendingForEntity below already set.
async function getRequest(client, id) {
  return workflowRepository.findById(client, id);
}

// The natural "what does this user need to act on next" read this
// whole table's shape exists for — a thin wrapper, same as
// financeService.listFeeStructuresForClassAndYear.
async function listPendingForApprover(client, userId) {
  if (!userId) {
    throw new WorkflowRequestValidationError('userId is required');
  }
  return workflowRepository.findPendingForApprover(client, userId);
}

// A pure read, not new approval logic (this task's own scope note):
// FinanceService/StaffService need to correlate their own entity id
// (a fee_structures.id, a staff.id) back to the workflow_requests row
// governing it before they can call approveRequest/rejectRequest,
// since neither table stores its own workflow_request_id column (no
// schema change this slice). At most one Pending request can exist
// per entity (workflow_requests_entity_pending_key, the partial unique
// index from the first slice), so filtering findByEntity's
// created-descending results down to the single Pending one (or null)
// is unambiguous — same thin-wrapper shape as listPendingForApprover
// above, just filtered differently.
async function findPendingForEntity(client, entityType, entityId) {
  const requests = await workflowRepository.findByEntity(client, entityType, entityId);
  return requests.find((request) => request.status === 'Pending') || null;
}

module.exports = {
  WorkflowRequestValidationError,
  WorkflowRequestOriginError,
  WorkflowRequestUserNotFoundError,
  WorkflowRequestConflictError,
  WorkflowRequestNotFoundError,
  WorkflowRequestAlreadyResolvedError,
  WorkflowRequestStepMismatchError,
  WorkflowRequestSelfApprovalError,
  submitRequest,
  approveRequest,
  escalateRequest,
  rejectRequest,
  getRequest,
  listPendingForApprover,
  findPendingForEntity,
};
