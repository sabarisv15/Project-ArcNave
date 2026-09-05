'use strict';

// Tool definitions batch 3 of aiToolRegistry.js's split — see
// services/aiTools/engine.js's own header comment for the full split.
// Registers each tool with the engine purely for side effect at module
// load time; require()d (never re-exported) by the aiToolRegistry.js
// barrel alongside every other services/aiTools/tools*.js batch.

const { registerTool } = require('./engine');
const aiActorContext = require('../aiActorContext');
// --- Real tool #5 — AI attendance assistant ----------------------------
// mark_attendance_nl: BusinessRules.md AI Attendance Management. AI-
// Governance.md §1 lists "modify attendance" as its own L3 example
// ("AI, please mark Sunil absent") — but that example is the AI
// deciding/initiating a change on someone else's behalf. This tool is
// structurally the other case §1 already carves out for Send Alert: a
// human's own real-time command about their own already-eligible
// action, with the AI acting only as a natural-language front end, not
// an independent decision-maker. It can never do anything the acting
// user couldn't already do by calling POST /api/v1/attendance directly
// — attendanceService.markAttendanceByRollNumbers's own call into
// markAttendance re-verifies the exact same tutor/HOD/scheduled-staff/
// substitute eligibility check (assertCanMark) that route already
// enforces; the tool grants no authority the human didn't already have.
// Registered L1 (not L3) for that reason — see AI-Governance.md §1's
// own updated note for the explicit carve-out, added in this same
// slice. No WorkflowService submission here, matching Send Alert's own
// "direct, human-triggered action" precedent, not a new exception
// invented ad hoc.
const attendanceService = require('../attendanceService');

registerTool({
  name: 'mark_attendance_nl',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Marks attendance for the session the acting faculty member is currently teaching, from a list of ' +
    'absent roll numbers (e.g. "mark roll numbers 35, 67, and 25 absent") — every other enrolled student in that ' +
    "session is marked Present. Resolves the current session from the acting user's own approved timetable " +
    'allocation or substitute assignment; fails if they have no active session right now.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      absent_roll_numbers: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Roll numbers to mark Absent. Every other student enrolled in the resolved class is marked Present.',
      },
    },
    required: ['absent_roll_numbers'],
    additionalProperties: false,
  },
  // Second optimization pass, finding #4: the true affected count is
  // the resolved session's whole roster (every enrolled student is
  // touched, not just the named absentees) — not knowable without
  // running the handler's own session/roster resolution first, which
  // this pre-mutation gate deliberately doesn't do (out of scope for a
  // surgical pass; attendanceService would need its own dry-run/count
  // support to make that exact). absent_roll_numbers.length is used
  // instead as a cheap, honest proxy: no real class session in this
  // domain has anywhere near 300 students, so this is a pure backstop
  // against a malformed/injected oversized list, never a limit a
  // legitimate single-session attendance call could realistically hit —
  // no confirmAt tier is set, matching that (a routine call should
  // never pause for confirmation here).
  maxAffectedRows: {
    estimate: (params) => (Array.isArray(params.absent_roll_numbers) ? params.absent_roll_numbers.length : 0),
    rejectAt: 300,
  },
  handler: (client, params, actor) =>
    attendanceService.markAttendanceByRollNumbers(
      client,
      { absentRollNumbers: params.absent_roll_numbers },
      { actorUserId: actor.userId, actorRole: actor.role, collegeId: actor.collegeId },
    ),
});

// --- Real tool #6 — Academic Calendar read (task #20) -------------------
// list_calendar_events: BusinessRules.md Platform administration,
// Academic Calendar — "AI can answer calendar questions but never
// creates or edits an event without authorization." L1/Inform, a pure
// read with no external effect; Internal classification (semester
// dates/holidays/exam windows carry no student-identifying or contact
// data, unlike AI-Governance.md §4's Confidential/Restricted rows).
// Thin wrapper over calendarService.listEvents, which itself has no
// write path at all — the "never creates or edits" half of the rule is
// satisfied structurally, not by a runtime check this tool would have
// to get right. Open to every tenant role, same as the human-facing
// GET /calendar-events route (one shared institutional calendar, not
// scoped per role).
const calendarService = require('../calendarService');

registerTool({
  name: 'list_calendar_events',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Lists academic calendar events (semester dates, holidays, exams, and other institution-defined ' +
    'events) for the acting college, optionally within a date range. Read-only — never creates or edits an event.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      from_date: {
        type: 'string',
        description:
          'Optional ISO date (YYYY-MM-DD) — only events starting on or after this date. Omit unless the user explicitly named a date/range; never invent one.',
      },
      to_date: {
        type: 'string',
        description:
          'Optional ISO date (YYYY-MM-DD) — only events starting on or before this date. Omit unless the user explicitly named a date/range; never invent one.',
      },
    },
    additionalProperties: false,
  },
  // limit: a safety backstop, not a functional truncation — a college's
  // real calendar-event count (semester dates, holidays, exams) never
  // realistically approaches this; it exists purely to bound what gets
  // JSON-stringified into the LLM prompt for an unfiltered, all-time
  // query. The human-facing GET /calendar-events route is untouched —
  // this limit is only ever passed by this tool.
  handler: (client, params, actor) =>
    calendarService.listEvents(client, {
      collegeId: actor.collegeId,
      fromDate: params.from_date,
      toDate: params.to_date,
      limit: 500,
    }),
});

// --- Role-aware ERP Copilot tools (this slice) -------------------------
// Every tool below follows three standing rules recorded in
// AI-Governance.md's own "Same-Actor Direct-Action Carve-Out" section:
//   1. Domain-prefixed name (students_*/attendance_*/assessment_*/
//      academic_*/staff_*/finance_*/workflow_*), one Business Service
//      call each — never an intent-branching dispatcher (a single
//      tool can only have one dataClassification/allowedRoles pair,
//      and AI-Governance.md §2 forbids business logic inside a tool
//      wrapper, so a dispatcher can't exist here without breaking
//      both).
//   2. Scope (own class(es)/department/college) is always resolved
//      from `actor` alone, inside the relevant Business Service
//      (visibilityService.getVisibleClassIds/staffService.
//      findHodDepartmentId — the same "context builder" every other
//      scoped read/write in this codebase already shares), never from
//      a caller-supplied classId/departmentId.
//   3. A tool may skip WorkflowService only where the human dashboard
//      action it mirrors is ALREADY a direct write for that exact
//      role today (verified against the real route+service code, not
//      assumed) — everywhere a human already needs approval, the tool
//      creates the identical workflow request instead and never
//      mutates directly. Delete is never a direct tool, full stop.

// Read tools (L1) ------------------------------------------------------

const studentService = require('../studentService');

registerTool({
  name: 'students_roster',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Lists students within the acting user's own scope — their own taught/tutored class(es), their own " +
    'department (HOD), or the whole college (principal). Roster/profile data only — never includes attendance ' +
    'or marks; use attendance_summary or assessment_marks_summary for those. Only ever returns a name for a ' +
    "roll number that's actually enrolled in THIS college's own student records — it has no knowledge of " +
    "roll/register numbers that only appear in an attached document you've separately read, since a document's " +
    "own roll numbers aren't necessarily this college's own enrolled students. If roll numbers you read from a " +
    "document don't resolve to real students here, say so — never substitute an " +
    'unrelated/unfiltered roster as if it answered the question.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      roll_numbers: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional — narrow the roster to exactly these roll numbers (e.g. ones already named earlier ' +
          'in this conversation or by the user) instead of returning the whole scope unfiltered. Omit to list ' +
          'everyone in scope.',
      },
    },
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    studentService.listStudents(
      client,
      { limit: 500, rollNumbers: params.roll_numbers },
      aiActorContext.buildActorContextForIdentity(actor),
    ),
});

const analyticsService = require('../analyticsService');

registerTool({
  name: 'attendance_summary',
  level: 'L1',
  analyticsSourced: true,
  dataClassification: 'Internal',
  description:
    "Attendance rate per class within the acting user's own scope (own taught/tutored classes, own " +
    'department, or whole college), optionally within a date range. Use this for ANY question about attendance ' +
    "— rates, percentages, who's attending, department/class attendance — not students_roster (which never " +
    'includes attendance data).',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      start_date: {
        type: 'string',
        description:
          'Optional ISO date (YYYY-MM-DD) lower bound — omit unless the user explicitly named a specific date or range; never invent one to narrow an otherwise-unqualified question.',
      },
      end_date: {
        type: 'string',
        description:
          'Optional ISO date (YYYY-MM-DD) upper bound — omit unless the user explicitly named a specific date or range; never invent one to narrow an otherwise-unqualified question.',
      },
    },
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    analyticsService.getAttendanceRateForActor(client, aiActorContext.buildActorContextForIdentity(actor), {
      startDate: params.start_date,
      endDate: params.end_date,
    }),
});

// Same underlying read as attendance_summary, filtered/sorted to
// below-threshold classes — kept as its own tool rather than an
// `intent`/`mode` flag on attendance_summary, per this section's own
// naming rule. The filter itself is a trivial array predicate, not
// query construction, so it stays in this thin handler rather than
// becoming a second analyticsService function.
registerTool({
  name: 'students_low_attendance',
  level: 'L1',
  analyticsSourced: true,
  dataClassification: 'Internal',
  description:
    "Lists classes within the acting user's own scope whose attendance rate is at or below a threshold " +
    'percent (default 75) — the same data as attendance_summary, filtered to the classes that need attention.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      threshold_percent: {
        type: 'number',
        description: 'Attendance rate percent at or below which a class is included. Defaults to 75.',
      },
    },
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const rows = await analyticsService.getAttendanceRateForActor(
      client,
      aiActorContext.buildActorContextForIdentity(actor),
    );
    const threshold = typeof params.threshold_percent === 'number' ? params.threshold_percent : 75;
    return rows.filter((row) => row.attendanceRatePercent !== null && row.attendanceRatePercent <= threshold);
  },
});

const assessmentService = require('../assessmentService');

// Classified Internal here, not the Confidential default
// AI-Governance.md §4's data table gives marks generally — a
// deliberate, documented call (see AI-Governance.md's own new note):
// the same tutor already has full read+write access to these exact
// marks on the human dashboard (recordMark has no extra gate beyond
// assertIsAssignedFaculty), so reading what you can already edit is
// not a new exposure. Kept college-wide unrestricted for principal via
// the same actor-derived scoping every other tool here uses.
registerTool({
  name: 'assessment_marks_summary',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Reads (never writes) assessment marks within the acting user's own scope (own taught classes, own " +
    'department, or whole college), optionally filtered by academic year, subject, or assessment type. Use this ' +
    'for viewing/listing marks (e.g. "who failed", "show marks for..."); use assessment_record_mark instead to ' +
    "record or update one student's mark.",
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      academic_year: { type: 'string', description: "Optional academic year filter, e.g. '2025-2026'." },
      subject: { type: 'string', description: 'Optional subject filter.' },
      assessment_type_id: {
        type: 'string',
        description:
          'Optional assessment type filter — either the exact internal id (if already known from a prior tool result) or the assessment type\'s real name (e.g. "Midterm"), resolved to an id internally. Omit if unsure of the exact name rather than guessing one.',
      },
    },
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const assessmentTypeId = params.assessment_type_id
      ? await assessmentService.resolveAssessmentTypeId(client, actor.collegeId, params.assessment_type_id)
      : undefined;
    return assessmentService.listMarksForActor(client, aiActorContext.buildActorContextForIdentity(actor), {
      academicYear: params.academic_year,
      subject: params.subject,
      assessmentTypeId,
    });
  },
});

// attendance_outstanding_absence_flags (RS-ATT-008, D6, Stage 6): L1
// read — the flag itself is system-raised and L3-closed only
// (attendanceService.closeAbsenceFlag has no AI entry point, per
// RS-ATT-008's own "L3 MUST open and close it out"), so this tool is
// read-only, mirroring assessment_marks_summary's own scoped-read shape.
registerTool({
  name: 'attendance_outstanding_absence_flags',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Lists students currently flagged for more than five consecutive full-day absences, within the ' +
    "acting user's own scope (own tutored class, own department, or whole college), still awaiting L3 review " +
    'and closure. Read-only — this tool cannot close a flag.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) =>
    attendanceService.listOutstandingAbsenceFlagsForActor(client, aiActorContext.buildActorContextForIdentity(actor)),
});

const academicService = require('../academicService');

registerTool({
  name: 'academic_class_timetable',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Faculty allocation / timetable for classes within the acting user's own scope (own taught/tutored " +
    'classes, own department, or whole college).',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) =>
    academicService.getClassTimetableForActor(client, aiActorContext.buildActorContextForIdentity(actor)),
});

// Capability Coverage Audit finding (2026-07-26, cross-role #1):
// RS-TTB-001 (generate/revise timetable) shipped this session with
// zero AI tool coverage for any role — a fresh parity gap, not a
// pre-existing one. generateTimetable/reviseTimetable already do all
// real authorization themselves (academicService.assertCanGenerateForClass,
// same ownership check both the 'staff' and genuine 'class_tutor' seat
// login shapes resolve through) — these two tools are thin wrappers,
// identical in shape to assessment_record_mark above, not new logic.
