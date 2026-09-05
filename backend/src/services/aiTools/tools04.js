'use strict';

// Tool definitions batch 4 of aiToolRegistry.js's split — see
// services/aiTools/engine.js's own header comment for the full split.
// Registers each tool with the engine purely for side effect at module
// load time; require()d (never re-exported) by the aiToolRegistry.js
// barrel alongside every other services/aiTools/tools*.js batch.

const { registerTool } = require('./engine');
const academicService = require('../academicService');
const assessmentService = require('../assessmentService');
const studentService = require('../studentService');
const calendarService = require('../calendarService');
const REQUIREMENT_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: 'The subject name.' },
    subject_type: { type: 'string', description: "'Theory' or 'Practical'. Defaults to 'Theory'." },
    staff_user_ids: {
      type: 'array',
      items: { type: 'string' },
      description: 'Faculty user id(s) teaching this subject — one for Theory, up to two (co-teaching) for Practical.',
    },
    periods_per_week: { type: 'number', description: 'How many periods/week this subject needs.' },
  },
  required: ['subject', 'staff_user_ids', 'periods_per_week'],
  additionalProperties: false,
};

registerTool({
  name: 'academic_generate_timetable',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Generates a draft timetable (faculty allocation) for a class from a list of subject/faculty/' +
    'periods-per-week requirements — the same action available on the class Timetable screen. Produces a ' +
    'proposal only; it still needs submitting via academic_submit_timetable_for_approval before it locks ' +
    "attendance marking. Fails if the acting user is not this class's own Class Tutor (or principal/hod), or " +
    "if the class's timetable is already Approved (use academic_revise_timetable for an approved class instead).",
  // 4-login authorization architecture (2026-08-09): 'staff' removed —
  // timetable generation is L4/HOD/Principal authority only, never a
  // personal Staff login's, even for a person who occupies the L4 seat
  // (academicService.assertCanGenerateForClass now rejects 'staff'
  // outright). No Staff-level leg exists for this capability at all.
  allowedRoles: ['principal', 'hod', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      class_id: {
        type: 'string',
        description: 'The class id, or the class name (e.g. "3rd Sem · CSE-A"), resolved to an id internally.',
      },
      requirements: {
        type: 'array',
        items: REQUIREMENT_ITEM_SCHEMA,
        description: 'One entry per subject that needs periods scheduled.',
      },
      max_hours_per_day: {
        type: 'number',
        description: "Optional cap on one faculty member's periods/day. Defaults to the class's own configured limit.",
      },
    },
    required: ['class_id', 'requirements'],
    additionalProperties: false,
  },
  // Second optimization pass, finding #4: the actual write count is
  // roughly one faculty_allocation row per period across every
  // requirement — Σ periods_per_week is an exact, zero-cost estimate
  // computable directly from the already-validated params, not a proxy.
  // Scoped to one class only (class_id is required), so a normal
  // request is tens of periods at most; confirmAt sits above a full
  // single-class weekly schedule, rejectAt guards against a malformed/
  // injected requirements array trying to generate an implausible
  // number of periods in one call.
  maxAffectedRows: {
    estimate: (params) => (params.requirements || []).reduce((sum, r) => sum + (Number(r.periods_per_week) || 0), 0),
    confirmAt: 40,
    rejectAt: 200,
  },
  handler: async (client, params, actor) => {
    const classId = await academicService.resolveClassId(client, actor.collegeId, params.class_id);
    const requirements = (params.requirements || []).map((r) => ({
      subject: r.subject,
      subjectType: r.subject_type,
      staffUserIds: r.staff_user_ids,
      periodsPerWeek: r.periods_per_week,
    }));
    return academicService.generateTimetable(client, classId, requirements, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      maxHoursPerDay: params.max_hours_per_day,
    });
  },
});

registerTool({
  name: 'academic_revise_timetable',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Revises an already-generated timetable for a class — only the named subjects' sessions are " +
    'regenerated, everything else on the class is left alone. Same access rule as academic_generate_timetable ' +
    "(this class's own Class Tutor, or principal/hod). If the class is already Approved, this creates a new " +
    'Revision Proposal through the same submit/approve chain, per RS-TTB-001 — attendance marking locks again ' +
    "from the moment it's submitted.",
  // 4-login authorization architecture (2026-08-09): same reasoning as
  // academic_generate_timetable above — 'staff' removed.
  allowedRoles: ['principal', 'hod', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      class_id: { type: 'string', description: 'The class id, or the class name, resolved to an id internally.' },
      requirements: {
        type: 'array',
        items: REQUIREMENT_ITEM_SCHEMA,
        description: "Only the subjects being changed — every other subject's existing sessions are untouched.",
      },
      max_hours_per_day: { type: 'number', description: "Optional cap on one faculty member's periods/day." },
    },
    required: ['class_id', 'requirements'],
    additionalProperties: false,
  },
  // Same reasoning as academic_generate_timetable's own maxAffectedRows
  // comment — identical requirements shape, identical write pattern.
  maxAffectedRows: {
    estimate: (params) => (params.requirements || []).reduce((sum, r) => sum + (Number(r.periods_per_week) || 0), 0),
    confirmAt: 40,
    rejectAt: 200,
  },
  handler: async (client, params, actor) => {
    const classId = await academicService.resolveClassId(client, actor.collegeId, params.class_id);
    const requirements = (params.requirements || []).map((r) => ({
      subject: r.subject,
      subjectType: r.subject_type,
      staffUserIds: r.staff_user_ids,
      periodsPerWeek: r.periods_per_week,
    }));
    return academicService.reviseTimetable(client, classId, requirements, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      maxHoursPerDay: params.max_hours_per_day,
    });
  },
});

// Capability Coverage Audit finding: Send Alert had no AI tool at all,
// leaving the "AI may draft the wording, a human reviews before send"
// rule with nothing to invoke. humanOnly: true — same pattern
// upload_institutional_document uses — means the LLM can compose a
// draft message and show it in chat, but can never call this tool
// on its own; only the user's own explicit confirm action in the
// chat UI reaches it. Calls the exact same academicService.sendClassAlert
// the human Send Alert button uses — sendClassAlert's own comment
// documents this AI-drafted/human-confirmed path as the intended
// future variant, not a new authorization surface (same tutor-or-
// assigned-faculty ownership check either way, widened by ADL-024).
registerTool({
  name: 'class_send_alert',
  level: 'L2',
  dataClassification: 'Internal',
  humanOnly: true,
  description:
    'Sends a plain-text alert (WhatsApp/Email/SMS, best-effort per channel) to every student in the ' +
    "acting user's own class. Never sends automatically — only reachable via the user's own explicit confirm " +
    "action in the chat UI, after reviewing the drafted wording. Fails if the acting user is not this class's " +
    'own Class Tutor.',
  allowedRoles: ['staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      class_id: { type: 'string', description: 'The class id, or the class name, resolved to an id internally.' },
      body: {
        type: 'string',
        description: 'The plain-text message body to send, as reviewed and confirmed by the user.',
      },
    },
    required: ['class_id', 'body'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const classId = await academicService.resolveClassId(client, actor.collegeId, params.class_id);
    return academicService.sendClassAlert(client, classId, params.body, {
      actorUserId: actor.userId,
      actorRole: actor.role,
    });
  },
});

// Capability Coverage Audit finding: only substitute_duties_list/
// substitute_duty_acknowledge existed — viewing/acknowledging an
// already-made request, never initiating a new one. RS-CLS-007's own
// actor set ("the absent staff member, the department's L3, or the
// class's own L4") is enforced entirely inside
// academicService.requestSubstituteAssignment against the specific
// class/department — same "role list only narrows who reaches the
// tool, the service is the real gate" split every other actor-scoped
// tool here already uses, so allowedRoles is deliberately wide
// (whoever the service actually authorizes decides, not this list).
registerTool({
  name: 'substitute_request_initiate',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Initiates a new substitute-teacher request for one period of a class — the same action as the ' +
    "class's Substitute Assignments screen. The acting user must be the absent staff member named, the " +
    "department's HOD, or the class's own Class Tutor; any other caller is rejected.",
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      class_id: { type: 'string', description: 'The class id, or the class name, resolved to an id internally.' },
      timetable_period_id: {
        type: 'string',
        description: 'The timetable period (day/hour slot) this substitute covers.',
      },
      assignment_date: { type: 'string', description: 'The calendar date (YYYY-MM-DD) the substitution covers.' },
      original_staff_user_id: { type: 'string', description: 'The absent staff member being substituted for.' },
      substitute_staff_user_id: { type: 'string', description: 'The staff member covering the period.' },
      reason: { type: 'string', description: 'Optional reason for the request.' },
    },
    required: ['class_id', 'timetable_period_id', 'assignment_date', 'substitute_staff_user_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const classId = await academicService.resolveClassId(client, actor.collegeId, params.class_id);
    return academicService.requestSubstituteAssignment(
      client,
      {
        classId,
        timetablePeriodId: params.timetable_period_id,
        assignmentDate: params.assignment_date,
        originalStaffUserId: params.original_staff_user_id,
        substituteStaffUserId: params.substitute_staff_user_id,
        reason: params.reason,
      },
      { requestedByUserId: actor.userId, requestedByRole: actor.role },
    );
  },
});

const staffService = require('../staffService');

registerTool({
  name: 'staff_roster',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Lists staff in the acting user's own department (HOD) or the whole college (principal). Not " +
    'available to plain staff — a tutor has no dashboard reason to browse the staff directory.',
  allowedRoles: ['principal', 'hod'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) =>
    staffService.listStaffForActor(client, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      collegeId: actor.collegeId,
    }),
});

const financeService = require('../financeService');

// RS-FIN-001/004 (D4, Stage 4): there is no fee amount or fee-structure
// concept left anywhere in this schema — "there is no amount to
// summarise." Counts only (paid/not_paid/total marked), never a
// collected/outstanding total.
registerTool({
  name: 'finance_status_summary',
  level: 'L1',
  dataClassification: 'Restricted',
  description:
    'College-wide fee status counts (paid/not_paid) — never an amount, since ARCNAVE tracks no fee ' +
    'amount at all. Principal only — fee data is Restricted, and only the principal role has AI access to ' +
    'Restricted data.',
  allowedRoles: ['principal'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client) => financeService.getFeeStatusSummary(client),
});

const workflowService = require('../workflowService');

// Capability Coverage Audit finding (2026-07-26): Class Tutor is the
// sole approver for the attendance/marks correction chains
// (workflowChainService resolves both to 'tutor'), and the
// Dashboard's "Needs Your Attention" widget depends on this exact
// query — but 'class_tutor' was missing from allowedRoles, so AI
// could never surface a tutor's own pending-approval queue.
// listPendingForApprover is already purely userId-scoped (queries by
// the row's own assigned approver, same as principal/hod use today),
// so no handler change is needed — same "extend the existing tool,
// don't duplicate it" fix as Phase 1's other role-list gaps.
registerTool({
  name: 'workflow_pending_summary',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Workflow requests currently awaiting the acting user's own approval — the same list the Approvals " +
    'screen shows, not an exhaustive history of every request ever submitted in their department/college.',
  allowedRoles: ['principal', 'hod', 'class_tutor'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => workflowService.listPendingForApprover(client, actor.userId),
});

// Direct-write tools (L1 — skip WorkflowService; verified the human
// dashboard path is already direct for these exact roles) -------------

// assessment_record_mark: mirrors mark_attendance_nl's own carve-out
// exactly. recordMark itself re-verifies assertIsAssignedFaculty(classId,
// subject, actorUserId) — the tool grants no authority the acting
// faculty member didn't already have via POST /assessments/marks.
registerTool({
  name: 'assessment_record_mark',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Records (or updates) one student's mark for the acting user's own class/subject — the same " +
    'recordMark action available on the dashboard. Fails if the acting user is not the assigned Subject Faculty ' +
    'for that class/subject.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      academic_year: { type: 'string', description: "Academic year, e.g. '2025-2026'." },
      class_id: {
        type: 'string',
        description: 'The class id, or the class name (e.g. "3rd Sem · CSE-A"), resolved to an id internally.',
      },
      subject: { type: 'string', description: 'The subject.' },
      assessment_type_id: {
        type: 'string',
        description: 'The assessment type id, or its real name (e.g. "Midterm"), resolved to an id internally.',
      },
      student_id: {
        type: 'string',
        description: "The student id, or the student's roll number, resolved to an id internally.",
      },
      marks_obtained: {
        type: 'number',
        description: 'The mark, stored exactly as given — no grading/weighting is applied.',
      },
    },
    required: ['academic_year', 'class_id', 'subject', 'assessment_type_id', 'student_id', 'marks_obtained'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const [classId, assessmentTypeId, studentId] = await Promise.all([
      academicService.resolveClassId(client, actor.collegeId, params.class_id),
      assessmentService.resolveAssessmentTypeId(client, actor.collegeId, params.assessment_type_id),
      studentService.resolveStudentId(client, actor.collegeId, params.student_id),
    ]);
    return assessmentService.recordMark(
      client,
      {
        academicYear: params.academic_year,
        classId,
        subject: params.subject,
        assessmentTypeId,
        studentId,
        marksObtained: params.marks_obtained,
      },
      { actorUserId: actor.userId },
    );
  },
});

// calendar_create_event / calendar_update_event: two tools, not one
// "manage" tool with a mode flag — createEvent/updateEvent are two
// distinct Business Service methods, per this section's own naming
// rule (governing principle 0/1), even though they share a domain.
// Both direct — calendarService has no workflow step at all, and both
// are principal-only, matching the human dashboard's own calendar.write
// permission.
registerTool({
  name: 'calendar_create_event',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Creates a college calendar event (semester date, holiday, exam window, etc). Principal only.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Event title.' },
      event_type: { type: 'string', description: "Event type, e.g. 'holiday', 'exam'." },
      start_date: { type: 'string', description: 'ISO date (YYYY-MM-DD).' },
      end_date: { type: 'string', description: 'Optional ISO date (YYYY-MM-DD).' },
      description: { type: 'string', description: 'Optional description.' },
    },
    required: ['title', 'event_type', 'start_date'],
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    calendarService.createEvent(
      client,
      {
        collegeId: actor.collegeId,
        title: params.title,
        eventType: params.event_type,
        startDate: params.start_date,
        endDate: params.end_date,
        description: params.description,
      },
      { actorUserId: actor.userId },
    ),
});
