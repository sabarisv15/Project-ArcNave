'use strict';

// Tool definitions batch 11 of aiToolRegistry.js's split — see
// services/aiTools/engine.js's own header comment for the full split.
// Registers each tool with the engine purely for side effect at module
// load time; require()d (never re-exported) by the aiToolRegistry.js
// barrel alongside every other services/aiTools/tools*.js batch.

const { registerTool } = require('./engine');
const academicService = require('../academicService');
const collegeProfileService = require('../collegeProfileService');
const academicYearService = require('../academicYearService');
// --- Phase 8 (ROLE-COVERAGE "Intentionally Deferred" remediation) -----
// Three real, acknowledged gaps closed here — see
// docs/bka/20-matrices/ROLE-COVERAGE.md's "Intentionally Deferred"
// section. Each tool is a thin wrapper over the exact same Business
// Service function its own existing REST route already calls (never
// new business logic), reusing that route's own permission key rather
// than inventing a new one.

const classTutorService = require('../classTutorService');

// HOD -> Assign Class Tutor: classes.assign_tutor (['hod']) already
// gates routes/classes.js's POST /classes/:id/tutor
// (classTutorService.assignClassTutor). Reassignment (PUT, ['hod'])
// is deliberately NOT covered here — the ROLE-COVERAGE gap named only
// first-time assignment, and reassignment is a distinct GUI action
// this pass wasn't asked to close. Not humanOnly: this is a plain role
// (HOD, own department) + row-state (no existing occupant) gate,
// immediately executed the same way the GUI's own tutor-assignment
// action already is today — no different in kind from
// students_update_profile/staff_update_profile/calendar_create_event
// above, none of which are humanOnly either. L1: an internal record
// write with no external dispatch (contrast upload_institutional_document/
// class_send_alert, both humanOnly because they put something in front
// of a document repository or a real recipient outside this system).
registerTool({
  name: 'class_assign_tutor',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Assigns a Class Tutor to a class that does not have one yet — the same action as the class's own " +
    "Assign Tutor action. Fails if the acting user is not this department's HOD, or if the class already has an " +
    'active Class Tutor (use a reassignment instead, not exposed here).',
  allowedRoles: ['hod'],
  params: {
    type: 'object',
    properties: {
      class_id: { type: 'string', description: 'The class id, or the class name, resolved to an id internally.' },
      new_tutor_user_id: { type: 'string', description: 'The user id of the staff member to assign as Class Tutor.' },
    },
    required: ['class_id', 'new_tutor_user_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const classId = await academicService.resolveClassId(client, actor.collegeId, params.class_id);
    return classTutorService.assignClassTutor(client, classId, {
      newTutorUserId: params.new_tutor_user_id,
      actorUserId: actor.userId,
    });
  },
});

// Principal -> Department CRUD: departments.create/update/delete
// (['principal']) already gate routes/departments.js's own POST/PUT/
// DELETE /departments(/:id) (collegeProfileService.createDepartment/
// updateDepartment/removeDepartment). Create/update are plain L1
// record writes, same reasoning as class_assign_tutor above. Delete is
// different: this file's own standing rule for the Copilot tools above
// is explicit — "Delete is never a direct tool, full stop." — so
// departments_delete is humanOnly: true (the LLM may explain what a
// delete would do, but only the user's own explicit confirm action in
// the chat UI reaches the handler), matching the
// upload_institutional_document/class_send_alert pattern for an
// action with real, non-undoable-by-another-write consequences
// (cascading department removal) rather than the "record write you
// can just write again" shape create/update have.
registerTool({
  name: 'departments_create',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Creates a new department — the same action as the Institution -> Departments -> Add Department ' +
    "screen. Immediately generates that department's classes from courseDuration/defaultSections (same as the " +
    'GUI action).',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The department name, e.g. "ECE".' },
      approved_intake: { type: 'number', description: 'Optional approved student intake for this department.' },
      course_duration: { type: 'number', description: 'Course duration in years (integer, at least 2).' },
      default_sections: { type: 'number', description: 'Default number of sections per year (positive integer).' },
    },
    required: ['name', 'course_duration', 'default_sections'],
    additionalProperties: false,
  },
  // Second optimization pass, finding #4: course_duration × default_sections
  // is the exact, deterministic number of classes this call cascades
  // into creating (one class per year × section) — not a proxy, the
  // real count, computable directly from the two required params with
  // no DB call. confirmAt sits above what any real department's own
  // course structure needs; rejectAt guards against a malformed/
  // injected huge duration or section count triggering a runaway
  // class-creation cascade.
  maxAffectedRows: {
    estimate: (params) => (Number(params.course_duration) || 0) * (Number(params.default_sections) || 0),
    confirmAt: 30,
    rejectAt: 100,
  },
  handler: (client, params, actor) =>
    collegeProfileService.createDepartment(
      client,
      {
        collegeId: actor.collegeId,
        name: params.name,
        approvedIntake: params.approved_intake,
        courseDuration: params.course_duration,
        defaultSections: params.default_sections,
      },
      { actorUserId: actor.userId },
    ),
});

registerTool({
  name: 'departments_update',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Updates an existing department's name/approved intake/course duration/default sections — the same " +
    'action as the Institution -> Departments -> Edit Department screen. Only the fields actually passed are ' +
    'changed.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      department_id: {
        type: 'string',
        description: 'The department id, or the department name, resolved to an id internally.',
      },
      name: { type: 'string', description: 'New department name, if changing.' },
      approved_intake: { type: 'number', description: 'New approved student intake, if changing.' },
      course_duration: { type: 'number', description: 'New course duration in years, if changing.' },
      default_sections: { type: 'number', description: 'New default number of sections per year, if changing.' },
    },
    required: ['department_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const departmentId = await collegeProfileService.resolveDepartmentId(client, actor.collegeId, params.department_id);
    const fields = {};
    if (params.name !== undefined) fields.name = params.name;
    if (params.approved_intake !== undefined) fields.approvedIntake = params.approved_intake;
    if (params.course_duration !== undefined) fields.courseDuration = params.course_duration;
    if (params.default_sections !== undefined) fields.defaultSections = params.default_sections;
    return collegeProfileService.updateDepartment(client, departmentId, fields, { actorUserId: actor.userId });
  },
});

registerTool({
  name: 'departments_delete',
  level: 'L2',
  dataClassification: 'Internal',
  humanOnly: true,
  description:
    'Deletes a department — the same action as the Institution -> Departments -> Delete Department ' +
    "screen. Never called by the AI on its own — only reachable via the user's own explicit confirm action in " +
    'the chat UI, after being shown what will be removed.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      department_id: {
        type: 'string',
        description: 'The department id, or the department name, resolved to an id internally.',
      },
    },
    required: ['department_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const departmentId = await collegeProfileService.resolveDepartmentId(client, actor.collegeId, params.department_id);
    return collegeProfileService.removeDepartment(client, departmentId, {
      actorUserId: actor.userId,
      collegeId: actor.collegeId,
    });
  },
});

// Principal -> Academic Year lifecycle: academic_years.create/
// activate/complete (['principal']) already gate
// routes/academicYears.js's own POST /academic-years(/:id/activate,
// /:id/complete) (academicYearService.createAcademicYear/
// activateAcademicYear/completeAcademicYear). RS-ACA-002's own
// lifecycle is Draft -> Active -> Completed only — there is no
// separate archive action to cover (academicYearService exports only
// these three; record archival is a different mechanism entirely, per
// RS-DAT-003, already out of AI tool scope like every other Archived
// Records action). Create is a plain L1 record write (same reasoning
// as departments_create above). Activate/complete are humanOnly: true
// — both are one-way, college-wide lifecycle transitions with no
// undo (activate closes out whichever year was previously Active;
// complete is terminal per RS-ACA-002), the same "real, not-undoable-
// by-another-write consequences" reasoning departments_delete above
// uses, even though neither is literally a SQL DELETE.
registerTool({
  name: 'academic_year_create',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Creates a new academic year in Draft status — the same action as the Academic Year -> Add Academic ' +
    'Year screen. Does not activate it; use academic_year_activate separately once ready.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      year_label: { type: 'string', description: 'The academic year label, e.g. "2026-2027".' },
      start_date: { type: 'string', description: 'Optional start date (YYYY-MM-DD).' },
      end_date: { type: 'string', description: 'Optional end date (YYYY-MM-DD).' },
    },
    required: ['year_label'],
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    academicYearService.createAcademicYear(
      client,
      {
        collegeId: actor.collegeId,
        yearLabel: params.year_label,
        startDate: params.start_date,
        endDate: params.end_date,
      },
      { actorUserId: actor.userId },
    ),
});

registerTool({
  name: 'academic_year_activate',
  level: 'L2',
  dataClassification: 'Internal',
  humanOnly: true,
  description:
    "Activates a Draft academic year, making it the college's one Active academic year — the same " +
    'action as the Academic Year -> Activate screen. Never called by the AI on its own — only reachable via the ' +
    "user's own explicit confirm action in the chat UI. Fails if another academic year is already Active, or if " +
    'this one is not currently Draft.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      academic_year_id: {
        type: 'string',
        description: 'The academic year id, or its year_label, resolved to an id internally.',
      },
    },
    required: ['academic_year_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const academicYearId = await academicYearService.resolveAcademicYearId(
      client,
      actor.collegeId,
      params.academic_year_id,
    );
    return academicYearService.activateAcademicYear(client, academicYearId, { actorUserId: actor.userId });
  },
});

registerTool({
  name: 'academic_year_complete',
  level: 'L2',
  dataClassification: 'Internal',
  humanOnly: true,
  description:
    'Marks the currently Active academic year as Completed (terminal, no further transitions) — the ' +
    'same action as the Academic Year -> Complete screen. Never called by the AI on its own — only reachable via ' +
    "the user's own explicit confirm action in the chat UI. Fails if this academic year is not currently Active.",
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      academic_year_id: {
        type: 'string',
        description: 'The academic year id, or its year_label, resolved to an id internally.',
      },
    },
    required: ['academic_year_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const academicYearId = await academicYearService.resolveAcademicYearId(
      client,
      actor.collegeId,
      params.academic_year_id,
    );
    return academicYearService.completeAcademicYear(client, academicYearId, { actorUserId: actor.userId });
  },
});
