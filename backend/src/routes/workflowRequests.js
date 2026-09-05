'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/rbac');
const workflowService = require('../services/workflowService');
const staffService = require('../services/staffService');
const notificationService = require('../services/notificationService');
const academicService = require('../services/academicService');
const documentService = require('../services/documentService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// dispatchWorkflowAction's own guard against the generic endpoint
// silently under-applying a correction-type request — see its comment.
class WorkflowRequestWrongEndpointError extends Error {}

// Generic pending-approvals surface (Architecture.md 2.4/2.5, CLAUDE.md
// rule 3): a HOD/Principal's "what's waiting on me" list is the same
// query regardless of which entity a request governs
// (workflowService.listPendingForApprover), so GET /pending is a
// genuine workflowService-only read — no dispatch needed, there is
// nothing entity-specific about "list what this user must act on."
//
// requireAuth, not requireRole: workflowService.listPendingForApprover
// is itself the authorization boundary (it only ever returns rows
// where the caller IS the resolved approver for the current step,
// via approver_chain -> current_step - 1 ->> 'user_id' = userId), same
// "the service is the gate, not a role name" reasoning
// attendance.js's own router comment gives for AttendanceForbiddenError.
// A staff member and a principal hit the identical query; a staff
// member's list is simply always empty unless they hold an approver
// role on some chain.
//
// approve/reject are NOT workflowService-only, despite that being this
// session's own first-draft framing: workflowService.approveRequest/
// rejectRequest only ever flip the workflow_requests row itself.
// staffService.approveStaffRegistration does real, load-bearing work on
// TOP of that (staff_code assignment + user activation + credentials
// email — BusinessRules.md's "Staff ID generated -> credentials
// emailed -> login enabled"). Calling workflowService.approveRequest
// directly for that entity type would flip workflow_requests.status to
// 'Approved' while leaving the staff member never activated — a real
// regression, not an acceptable gap.
//
// So this route resolves the pending request's own entity_type first
// (workflowService.getRequest, a plain read added for exactly this)
// and dispatches to the matching, ALREADY-EXISTING entity-specific
// service function — no new service logic, only routing between
// functions that already exist. Anything that isn't 'staff_registration'
// or 'notification' falls back to calling workflowService.approveRequest/
// rejectRequest directly, so a future entity type with no dedicated
// cascade still works through this same generic endpoint without this
// route needing to change. 'attendance_correction', 'fee_correction',
// and 'mark_correction' deliberately do NOT route through here at all —
// each has its own dedicated approve/reject route (routes/attendance.js,
// routes/finance.js, routes/assessments.js) that a correction's real
// approver uses instead, same reasoning staff_registration's dedicated
// cascade needs one.
//
// 'notification' (Module 9's draft_notification/request_notification_send
// AI tools, and any future human-drafted notification) is a genuine
// two-step cascade on approve, unlike staff_registration's one call:
// notificationService.approveNotification (flips workflow_requests ->
// 'Approved' AND notifications.status -> 'Approved'), THEN
// notificationService.dispatchApprovedNotification (the actual send —
// sendEmail, a notification_delivery row, notifications.status ->
// 'Dispatched'). Approval alone is not "done" for a notification.
// Reject is a single call — a rejected notification is simply never
// dispatched (notificationService.dispatchApprovedNotification's own
// NotificationNotApprovedError guard already blocks a stray dispatch
// attempt against it, structurally, not just by this route's own care).
function mapWorkflowRequestsError(err, res) {
  if (err instanceof workflowService.WorkflowRequestValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowService.WorkflowRequestNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowService.WorkflowRequestAlreadyResolvedError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof WorkflowRequestWrongEndpointError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  // Wrong actor entirely, or not this actor's turn in the chain yet —
  // same 403 attendance.js's own AttendanceForbiddenError mapping uses
  // for "authenticated but not permitted to act on this specific row."
  if (err instanceof workflowService.WorkflowRequestStepMismatchError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  // ADR-005: a requester may not approve their own request.
  if (err instanceof workflowService.WorkflowRequestSelfApprovalError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffRegistrationNotPendingError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassTimetableApprovalNotPendingError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.SubstituteAssignmentRequestNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.SubstituteAssignmentPeriodNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.SubstituteAssignmentConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof notificationService.NotificationValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof notificationService.NotificationNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (
    err instanceof notificationService.NotificationNoPendingRequestError ||
    err instanceof notificationService.NotificationNotApprovedError
  ) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  // 501: the approval itself succeeded (workflowService.approveRequest
  // already resolved, same as any other approved chain) — dispatch is
  // what has no real implementation for this channel yet, an honest
  // "this isn't built" rather than a 500 (this server's own bug) or a
  // silent 200 pretending a send happened. The notification stays
  // 'Approved', not 'Dispatched' — see dispatchApprovedNotification's
  // own comment.
  if (err instanceof notificationService.NotificationChannelNotImplementedError) {
    res.status(501).json({ detail: err.message });
    return true;
  }
  // Institutional Documents Phase 3 — publish/supersede cascade
  // (documentService.approvePublish/rejectPublish/approveSupersede/
  // rejectSupersede below), same shape staff_registration's own error
  // mapping above already establishes.
  if (err instanceof documentService.DocumentValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.DocumentVersionNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.DocumentNoPendingRequestError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.DocumentPublicationStateError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  return false;
}

// Shared by approve/reject: resolves the pending request's entity_type/
// entity_id, then calls whichever of the functions (per entity type)
// actually resolves this action, returning its result as-is — each
// branch's return shape is whatever that entity's own service already
// returns (a { workflowRequest, staff } pair for staff registrations,
// a plain workflow_requests row for the generic fallback), not
// normalized to one shape, since these are genuinely different
// resources and a caller reading a staff-registration action already
// expects staff fields back, same as staffService.approveStaffRegistration's
// own callers always have.
async function dispatchWorkflowAction(req, action) {
  const request = await workflowService.getRequest(req.dbClient, req.params.id);
  if (request === null) {
    return { notFound: true };
  }

  const actorUserId = identityService.resolveActorUserId(req.capabilities);
  const remarks = req.body && req.body.remarks;

  if (request.entity_type === 'staff_registration') {
    const fn = action === 'approve' ? staffService.approveStaffRegistration : staffService.rejectStaffRegistration;
    return { result: await fn(req.dbClient, request.entity_id, { actorUserId, remarks }) };
  }
  if (request.entity_type === 'timetable_approval') {
    const fn =
      action === 'approve' ? academicService.approveTimetableApproval : academicService.rejectTimetableApproval;
    return { result: await fn(req.dbClient, request.entity_id, { actorUserId, remarks }) };
  }
  // RS-CLS-007: entity_id here is the substitute_assignment_requests
  // row's id, not a substitute_assignments id (that row doesn't exist
  // yet, pre-approval) — academicService.approveSubstituteAssignment's
  // own real work (creating the substitute_assignments fact) happens on
  // top of workflowService.approveRequest, same two-step cascade
  // staff_registration needs.
  if (request.entity_type === 'substitute_assignment') {
    const fn =
      action === 'approve' ? academicService.approveSubstituteAssignment : academicService.rejectSubstituteAssignment;
    return { result: await fn(req.dbClient, request.entity_id, { actorUserId, remarks }) };
  }
  if (request.entity_type === 'institutional_document_publish') {
    const fn = action === 'approve' ? documentService.approvePublish : documentService.rejectPublish;
    return { result: await fn(req.dbClient, request.entity_id, { actorUserId, remarks }) };
  }
  if (request.entity_type === 'institutional_document_supersede') {
    const fn = action === 'approve' ? documentService.approveSupersede : documentService.rejectSupersede;
    return { result: await fn(req.dbClient, request.entity_id, { actorUserId, remarks }) };
  }
  if (request.entity_type === 'notification') {
    if (action === 'reject') {
      return {
        result: await notificationService.rejectNotification(req.dbClient, request.entity_id, { actorUserId, remarks }),
      };
    }
    // Two real steps, not one — see the file-level comment: approval
    // alone doesn't dispatch anything.
    await notificationService.approveNotification(req.dbClient, request.entity_id, { actorUserId, remarks });
    return { result: await notificationService.dispatchApprovedNotification(req.dbClient, request.entity_id) };
  }
  // RS-DAT-002 (structural pattern P1): a correction's original row
  // must never be touched except through its own dedicated
  // apply-on-approve cascade (attendanceService.approveAttendanceCorrection/
  // financeService.approveFeeCorrection) — calling the generic
  // workflowService.approveRequest below for either of these would
  // silently flip the workflow_requests row to 'Approved' while never
  // marking the correction applied, exactly the "approved but nothing
  // actually changed" bug this endpoint's own file-level comment
  // already documents fee_structure/staff_registration needing a real
  // cascade for. Reject outright rather than silently under-applying —
  // routes/attendance.js's/routes/finance.js's own dedicated routes are
  // where these two entity types must be approved from.
  if (
    request.entity_type === 'attendance_correction' ||
    request.entity_type === 'fee_correction' ||
    request.entity_type === 'mark_correction'
  ) {
    throw new WorkflowRequestWrongEndpointError(
      `${JSON.stringify(request.entity_type)} requests must be ${action}d through their own dedicated route, not the generic workflow-requests endpoint`,
    );
  }

  const fn = action === 'approve' ? workflowService.approveRequest : workflowService.rejectRequest;
  return { result: await fn(req.dbClient, req.params.id, { actorUserId, remarks }) };
}

const workflowRequestIdParams = z.object({ id: z.string() });
const approveWorkflowRequestSchema = z.object({
  params: workflowRequestIdParams,
  body: z.object({ remarks: z.string().optional() }).optional(),
});
const rejectWorkflowRequestSchema = z.object({
  params: workflowRequestIdParams,
  body: z.object({ remarks: z.string().optional() }).optional(),
});

function createWorkflowRequestsRouter() {
  const router = express.Router();

  router.get(
    '/workflow-requests/pending',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const pending = await workflowService.listPendingForApprover(
        req.dbClient,
        identityService.resolveActorUserId(req.capabilities),
      );
      res.json(pending);
    }),
  );

  router.post(
    '/workflow-requests/:id/approve',
    requireAuth,
    validate(approveWorkflowRequestSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const { notFound, result } = await dispatchWorkflowAction(req, 'approve');
        if (notFound) {
          res.status(404).json({ detail: `No workflow request found with id ${JSON.stringify(req.params.id)}` });
          return;
        }
        res.json(result);
      } catch (err) {
        if (mapWorkflowRequestsError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/workflow-requests/:id/reject',
    requireAuth,
    validate(rejectWorkflowRequestSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const { notFound, result } = await dispatchWorkflowAction(req, 'reject');
        if (notFound) {
          res.status(404).json({ detail: `No workflow request found with id ${JSON.stringify(req.params.id)}` });
          return;
        }
        res.json(result);
      } catch (err) {
        if (mapWorkflowRequestsError(err, res)) return;
        throw err;
      }
    }),
  );

  return router;
}

module.exports = createWorkflowRequestsRouter;
module.exports.schemas = {
  '/workflow-requests/{id}/approve': { post: approveWorkflowRequestSchema },
  '/workflow-requests/{id}/reject': { post: rejectWorkflowRequestSchema },
};
