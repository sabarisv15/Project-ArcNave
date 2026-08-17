'use strict';

// AI Experience Layer (AIX) — Follow-up Suggestions. A fixed map from
// "tool that just ran" to related tools worth suggesting next.
// Suggestions are only ever tools that actually exist in the real Tool
// Registry AND are on the acting role's own allowedRoles list — never
// a freeform LLM-invented action, and never a capability (export,
// notify parents, etc.) this codebase doesn't actually have. This file
// reads registry metadata only (the same fields GET /ai/tools already
// exposes); it never calls a tool or a Business Service itself.

const aiToolRegistry = require('../aiToolRegistry');

const FOLLOW_UP_MAP = {
  students_roster: [
    { toolName: 'attendance_summary', label: 'Check attendance for these students' },
    { toolName: 'assessment_marks_summary', label: 'View their assessment marks' },
  ],
  attendance_summary: [
    { toolName: 'students_low_attendance', label: 'See only the classes below threshold' },
    { toolName: 'draft_notification', label: 'Draft a notification about attendance' },
  ],
  students_low_attendance: [
    { toolName: 'draft_notification', label: 'Draft a notification to follow up' },
    { toolName: 'attendance_summary', label: 'View full attendance summary' },
  ],
  assessment_marks_summary: [
    { toolName: 'assessment_record_mark', label: 'Record or update a mark' },
    { toolName: 'students_roster', label: 'View the class roster' },
  ],
  academic_class_timetable: [
    { toolName: 'attendance_summary', label: 'View attendance for this class' },
  ],
  staff_roster: [
    { toolName: 'staff_update_profile', label: 'Update a staff profile' },
  ],
  finance_status_summary: [
    { toolName: 'finance_record_payment', label: 'Record a fee payment' },
  ],
  draft_notification: [
    { toolName: 'request_notification_send', label: 'Submit the draft for approval' },
  ],
  mark_attendance_nl: [
    { toolName: 'attendance_summary', label: 'View updated attendance summary' },
  ],
};

const MAX_SUGGESTIONS = 5;

function isSupportedForRole(toolName, role) {
  const tool = aiToolRegistry.getTool(toolName);
  return !!tool && Array.isArray(tool.allowedRoles) && tool.allowedRoles.includes(role);
}

function buildFollowUps(toolName, role) {
  const candidates = FOLLOW_UP_MAP[toolName] || [];
  return candidates
    .filter((c) => isSupportedForRole(c.toolName, role))
    .slice(0, MAX_SUGGESTIONS)
    .map((c) => ({ label: c.label, tool: c.toolName }));
}

module.exports = { buildFollowUps, FOLLOW_UP_MAP };
