'use strict';

// Tool definitions batch 5 of aiToolRegistry.js's split — see
// services/aiTools/engine.js's own header comment for the full split.
// Registers each tool with the engine purely for side effect at module
// load time; require()d (never re-exported) by the aiToolRegistry.js
// barrel alongside every other services/aiTools/tools*.js batch.

const { registerTool } = require('./engine');
const assessmentService = require('../assessmentService');
const calendarService = require('../calendarService');
const studentService = require('../studentService');
const financeService = require('../financeService');
const staffService = require('../staffService');
const academicService = require('../academicService');
registerTool({
  name: 'calendar_update_event',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Updates an existing college calendar event. Principal only.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      event_id: {
        type: 'string',
        format: 'uuid',
        description:
          'The calendar event id to update. Must be the exact internal id (from a prior list_calendar_events result) — there is no name to resolve it from, so never guess one.',
      },
      title: { type: 'string', description: 'Optional new title.' },
      event_type: { type: 'string', description: 'Optional new event type.' },
      start_date: { type: 'string', description: 'Optional new ISO date (YYYY-MM-DD).' },
      end_date: { type: 'string', description: 'Optional new ISO date (YYYY-MM-DD).' },
      description: { type: 'string', description: 'Optional new description.' },
    },
    required: ['event_id'],
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    calendarService.updateEvent(
      client,
      params.event_id,
      {
        title: params.title,
        eventType: params.event_type,
        startDate: params.start_date,
        endDate: params.end_date,
        description: params.description,
      },
      { actorUserId: actor.userId, collegeId: actor.collegeId },
    ),
});

// finance_record_payment (RS-FIN-002, D5): first-time marking ONLY —
// class_tutor, not principal (the divergence this rule named
// explicitly, now fixed). markFeePayment itself re-verifies the actor
// is the real, verified tutor of the target student's own class — the
// tool grants no authority the acting tutor didn't already have via
// POST /finance/fee-payments. Fails with FeePaymentAlreadyMarkedError
// if the student already has a fee status on record — the AI MUST
// treat that as a signal to use finance_submit_fee_correction instead
// of retrying this tool, never a reason to guess a workaround.
registerTool({
  name: 'finance_record_payment',
  level: 'L1',
  dataClassification: 'Restricted',
  // RS-FIN-006's own named exception — see assertPolicyAllows's
  // comment. Only 'class_tutor' (the effectiveRole an Institutional
  // Identity Context / real Position-resolved tutor carries), never
  // widened to plain 'staff' — that would loosen Restricted access
  // beyond what the rule actually names.
  classificationOverrideRoles: ['class_tutor'],
  description:
    "Marks a student's fee payment status (paid/not_paid) for the FIRST time only — receipt document " +
    'required as evidence of record. Class tutor, own class only. If the student already has a fee status on ' +
    'record, this fails; use finance_submit_fee_correction instead, never call this tool again for the same ' +
    'student.',
  // Capability Coverage Audit finding (2026-07-26): plain 'staff' was
  // listed here even though the GUI has no fee-entry path for an
  // ordinary (non-tutor) staff account — "AI has full GUI parity,
  // nothing more" violation. Removed; markFeePayment's own tutor-
  // ownership check meant this was never exploitable, but the
  // allowedRoles list must not claim wider reach than the GUI grants.
  allowedRoles: ['principal', 'hod', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      student_id: {
        type: 'string',
        description: "The student id, or the student's roll number, resolved to an id internally.",
      },
      status: { type: 'string', description: "'paid' or 'not_paid'." },
      receipt_document_id: {
        type: 'string',
        description: 'Required id of a previously uploaded receipt document — the evidence of record.',
      },
    },
    required: ['student_id', 'status', 'receipt_document_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const studentId = await studentService.resolveStudentId(client, actor.collegeId, params.student_id);
    return financeService.markFeePayment(
      client,
      {
        collegeId: actor.collegeId,
        studentId,
        status: params.status,
        receiptDocumentId: params.receipt_document_id,
      },
      { actorUserId: actor.userId, actorRole: actor.role },
    );
  },
});

// students_update_profile: updateStudent itself re-verifies
// assertCanModifyStudent (own class/department/college) — same
// carve-out shape as assessment_record_mark. Lifecycle status is
// deliberately NOT a param here — that always goes through
// students_submit_lifecycle_change (Phase 3) instead, since 4 of its
// values are workflow-gated even for a human and the rest already have
// their own direct route (updateStudentLifecycleStatus) this tool does
// not wrap.
registerTool({
  name: 'students_update_profile',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Updates routine profile fields (phone, address, parent contact, notes — never lifecycle status) ' +
    "for a student within the acting user's own scope. Fails if the student is not in the acting user's scope.",
  // 4-login authorization architecture (2026-08-09): 'staff' removed —
  // studentService.assertCanModifyStudent has no plain-'staff' leg at
  // all (only class_tutor/hod/principal), so a personal Staff login
  // would only ever reach a StudentNotAuthorizedError here, exactly
  // matching GUI (middleware/permissions.js's students.update entry no
  // longer lists 'staff' either).
  allowedRoles: ['principal', 'hod', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      student_id: {
        type: 'string',
        description: "The student id, or the student's roll number, resolved to an id internally.",
      },
      phone: { type: 'string', description: 'Optional new phone number.' },
      address: { type: 'string', description: 'Optional new address.' },
      parent_phone: { type: 'string', description: 'Optional new parent phone number.' },
      notes: { type: 'string', description: 'Optional new notes.' },
    },
    required: ['student_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const studentId = await studentService.resolveStudentId(client, actor.collegeId, params.student_id);
    return studentService.updateStudent(
      client,
      studentId,
      {
        phone: params.phone,
        address: params.address,
        parentPhone: params.parent_phone,
        notes: params.notes,
      },
      { userId: actor.userId, actorRole: actor.role },
    );
  },
});

// staff_update_profile: updateStaff has no internal per-row scoping
// (routes/staff.js's own `staff.update` permission is already
// principal-only) — same authority as the human dashboard, no more.
registerTool({
  name: 'staff_update_profile',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Updates routine profile fields for any staff member. Principal only — staff.update is a ' +
    "principal-only action on the dashboard too, not HOD's.",
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      staff_id: {
        type: 'string',
        description: "The staff id, or the staff member's staff code, resolved to an id internally.",
      },
      phone: { type: 'string', description: 'Optional new phone number.' },
      designation: { type: 'string', description: 'Optional new designation.' },
      qualification: { type: 'string', description: 'Optional new qualification.' },
      department_id: { type: 'string', description: 'Optional new department id.' },
    },
    required: ['staff_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const staffId = await staffService.resolveStaffId(client, actor.collegeId, params.staff_id);
    return staffService.updateStaff(
      client,
      staffId,
      {
        phone: params.phone,
        designation: params.designation,
        qualification: params.qualification,
        departmentId: params.department_id,
      },
      { userId: actor.userId },
    );
  },
});

// Workflow-submitting tools (L3 — create the same request a human
// submission already uses; never mutate the underlying record
// directly) --------------------------------------------------------

// The service functions these wrap each return their OWN shape (a raw
// workflow_requests row, or an object nesting one under
// `workflowRequest`) — never the notification-row shape
// assertL3ResultNotBypassed's `result.workflow_request_id` check
// happens to already match. This tags the real workflow request's
// id/status onto whatever the service returned, satisfying that same
// generic post-check without changing the check itself or any
// existing service function's own return contract.
function withWorkflowRequestId(result, workflowRequest) {
  return { ...result, workflow_request_id: workflowRequest.id, status: workflowRequest.status };
}

// finance_submit_fee_correction (RS-FIN-003, D5): "any later change to
// a fee status already marked once is a correction." Per RS-FIN-003's
// own AI field ("L3 workflow-submitting... routed to L3's own-department
// queue"), the AI tool is deliberately narrower than the human path
// (which also allows L4/class_tutor to submit) — only hod/principal
// may invoke this tool, a higher trust bar for an AI-initiated
// financial correction. Does NOT change the fee status — a hod must
// approve via POST /finance/fee-corrections/:correctionId/approve
// first; getEffectiveFeePaymentForStudent is what reflects an approved
// correction.
registerTool({
  name: 'finance_submit_fee_correction',
  level: 'L3',
  dataClassification: 'Restricted',
  description:
    "Submits a correction to a student's already-marked fee status for hod approval. Does NOT change " +
    'the fee status — a hod must approve it first. Hod or principal only.',
  allowedRoles: ['principal', 'hod'],
  params: {
    type: 'object',
    properties: {
      fee_payment_id: {
        type: 'string',
        format: 'uuid',
        description:
          'The id of the existing fee payment row to correct — from a prior finance read. Must be the exact internal id, there is no name to resolve it from.',
      },
      proposed_status: { type: 'string', description: "The corrected status: 'paid' or 'not_paid'." },
      reason: { type: 'string', description: 'Reason for the correction.' },
    },
    required: ['fee_payment_id', 'proposed_status'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const result = await financeService.requestFeeCorrection(
      client,
      params.fee_payment_id,
      { proposedStatus: params.proposed_status, reason: params.reason },
      { requestedByUserId: actor.userId, origin: 'ai' },
    );
    return withWorkflowRequestId(result.correction, result.workflowRequest);
  },
});

// assessment_submit_mark_correction (RS-ASM-003, D7): "any later write
// to a mark value that already exists is a correction." Per RS-ASM-003's
// own AI field ("L3 workflow-submitting"), the human path names Subject
// Faculty as the submitter (same broad role set assessment_record_mark
// above already uses) — does NOT change the mark itself, a class tutor
// must approve via POST /assessment-marks/corrections/:correctionId/approve
// first; getEffectiveMark is what reflects an approved correction.
registerTool({
  name: 'assessment_submit_mark_correction',
  level: 'L3',
  dataClassification: 'Internal',
  description:
    "Submits a correction to a student's already-recorded mark for the class tutor's approval. Does " +
    'NOT change the mark — a class tutor must approve it first.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      assessment_mark_id: {
        type: 'string',
        format: 'uuid',
        description:
          'The id of the existing assessment mark row to correct — from a prior marks read. Must be the exact internal id, there is no name to resolve it from.',
      },
      proposed_marks_obtained: { type: 'number', description: 'The corrected mark.' },
      reason: { type: 'string', description: 'Reason for the correction.' },
    },
    required: ['assessment_mark_id', 'proposed_marks_obtained'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const result = await assessmentService.requestMarkCorrection(
      client,
      params.assessment_mark_id,
      { proposedMarksObtained: params.proposed_marks_obtained, reason: params.reason },
      { requestedByUserId: actor.userId, origin: 'ai' },
    );
    return withWorkflowRequestId(result.correction, result.workflowRequest);
  },
});

registerTool({
  name: 'staff_submit_registration',
  level: 'L3',
  dataClassification: 'Internal',
  description:
    'Submits a pending staff registration for HOD then principal approval. Does NOT activate the ' +
    "staff member — approval must happen via the workflow approvals screen first. HOD (of that staff member's " +
    'own department) or principal.',
  allowedRoles: ['principal', 'hod'],
  params: {
    type: 'object',
    properties: {
      staff_id: {
        type: 'string',
        description:
          "The id of the pending staff registration to submit for approval, or that staff member's staff code, resolved to an id internally.",
      },
    },
    required: ['staff_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const staffId = await staffService.resolveStaffId(client, actor.collegeId, params.staff_id);
    const workflowRequest = await staffService.submitStaffRegistration(client, staffId, {
      requestedByUserId: actor.userId,
      origin: 'ai',
    });
    return withWorkflowRequestId(workflowRequest, workflowRequest);
  },
});

registerTool({
  name: 'students_submit_lifecycle_change',
  level: 'L3',
  dataClassification: 'Internal',
  description:
    'Submits a student lifecycle status change (Discontinued/Debarred/Dismissed/Graduated) for ' +
    'principal approval. Does NOT change the status — approval must happen via the workflow approvals screen first.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      student_id: {
        type: 'string',
        description: "The student id, or the student's roll number, resolved to an id internally.",
      },
      new_status: { type: 'string', description: 'One of Discontinued, Debarred, Dismissed, Graduated.' },
      reason: { type: 'string', description: 'Reason for the change.' },
      effective_date: { type: 'string', description: 'Optional ISO date (YYYY-MM-DD) the change should take effect.' },
    },
    required: ['student_id', 'new_status', 'reason'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const studentId = await studentService.resolveStudentId(client, actor.collegeId, params.student_id);
    const result = await studentService.requestLifecycleStatusChange(
      client,
      studentId,
      { newStatus: params.new_status, reason: params.reason, effectiveDate: params.effective_date },
      { requestedByUserId: actor.userId, origin: 'ai' },
    );
    return withWorkflowRequestId(result, result.workflowRequest);
  },
});

registerTool({
  name: 'students_submit_transfer',
  level: 'L3',
  dataClassification: 'Internal',
  description:
    'Submits an internal (same-college) student transfer request for principal approval. Does NOT ' +
    'move the student — approval must happen via the workflow approvals screen first.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      student_id: {
        type: 'string',
        description: "The student id, or the student's roll number, resolved to an id internally.",
      },
      destination_class_id: {
        type: 'string',
        description: 'The class id to transfer to, or its class name, resolved to an id internally.',
      },
      reason: { type: 'string', description: 'Reason for the transfer.' },
    },
    required: ['student_id', 'destination_class_id', 'reason'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const [studentId, destinationClassId] = await Promise.all([
      studentService.resolveStudentId(client, actor.collegeId, params.student_id),
      academicService.resolveClassId(client, actor.collegeId, params.destination_class_id),
    ]);
    const result = await studentService.requestInternalTransfer(
      client,
      studentId,
      { destinationClassId, reason: params.reason },
      { requestedByUserId: actor.userId, origin: 'ai' },
    );
    return withWorkflowRequestId(result, result.workflowRequest);
  },
});

registerTool({
  name: 'academic_submit_timetable_for_approval',
  level: 'L3',
  dataClassification: 'Internal',
  description:
    "Submits a class's draft timetable for HOD then principal approval. Does NOT approve it — " +
    'attendance marking for that class stays locked until a human approves via the workflow approvals screen.',
  allowedRoles: ['principal', 'hod'],
  params: {
    type: 'object',
    properties: {
      class_id: {
        type: 'string',
        description:
          'The class id whose timetable should be submitted for approval, or its class name, resolved to an id internally.',
      },
    },
    required: ['class_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const classId = await academicService.resolveClassId(client, actor.collegeId, params.class_id);
    const workflowRequest = await academicService.submitTimetableForApproval(client, classId, {
      requestedByUserId: actor.userId,
      origin: 'ai',
    });
    return withWorkflowRequestId(workflowRequest, workflowRequest);
  },
});
