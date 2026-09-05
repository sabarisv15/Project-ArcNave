'use strict';

// Business logic for Module 3's `classes` table — validation and
// audit logging on top of classRepository.js, which does neither
// (CLAUDE.md rule 1: AI tools call Business Services, never
// repositories directly — this file is what makes that possible for
// classes).
//
// This slice is plain CRUD + validation, same shape as
// staffService.js's second slice: no HOD/Principal review-chain
// transition logic ('Pending HOD' -> 'Approved'/'Pending
// Principal'/'Rejected', per HodDashboard.jsx/PrincipalDashboard.jsx's
// handleTimetableReview) is enforced here beyond validating that a
// given timetableStatus is one of the known literals — that transition
// logic lives in ./timetableApproval.js. CLAUDE.md rule 3:
// WorkflowService is the sole approval gate, and it doesn't exist
// yet (Roadmap.md builds Workflow/Notifications after Attendance/
// Finance/Documents/Reports) — same "out of scope here, not stubbed"
// reasoning studentService.js used for the HOD-override exception.
// "Class Tutor is assigned only by HOD" (BusinessRules.md Staff) is an
// authorization rule, left to the route/RBAC layer once Module 3's API
// exists, matching staffService.js's precedent for "only HOD/Principal
// may add staff."

const classRepository = require('../../repositories/classRepository');
const auditLogRepository = require('../../repositories/auditLogRepository');
const { isUuid, IdentifierResolutionError } = require('../../identifierResolution');
const {
  ClassValidationError,
  ClassTimetableStatusError,
  ClassNameConflictError,
  ClassDepartmentNotFoundError,
  ClassTimetableStatusManagedByWorkflowError,
  ClassGenerationValidationError,
} = require('./errors');

// resolveClassId: mirrors studentService.resolveStudentId/
// staffService.resolveStaffId — given either a real class id or a
// human-readable class_name, returns the real id, or throws
// IdentifierResolutionError if neither resolves within this college.
// Same motivation: an AI Copilot caller only has a class name to go
// on (e.g. "CSE-A"), never the internal id.
async function resolveClassId(client, collegeId, identifier) {
  if (isUuid(identifier)) {
    return identifier;
  }
  const cls = await classRepository.findByCollegeAndClassName(client, collegeId, identifier);
  if (cls === null) {
    throw new IdentifierResolutionError(`no class found named ${JSON.stringify(identifier)} in this college`);
  }
  return cls.id;
}

// Known real timetable_status values, per the migration's own comment
// and .ai/TASK.md's grounding against TutorClass.jsx/
// TutorClassMonitor.jsx.
const VALID_TIMETABLE_STATUSES = ['No Tutor', 'Pending HOD', 'Pending Principal', 'Approved', 'Rejected'];

// The fields this service accepts for create/update, deliberately
// listed here rather than trusting classRepository's own COLUMNS
// whitelist to be the only line of defense — same defense-in-depth
// reasoning as studentService.js/staffService.js's own ALLOWED_FIELDS.
// collegeId is excluded: a class's tenant is set once at creation and
// never moves via update, same as students/staff. tutorUserId dropped
// in Phase 2 step 18 — classTutorService.assignClassTutor/
// reassignClassTutor supersede createClass/updateClass's former
// implicit tutorUserId mutation entirely.
const ALLOWED_FIELDS = [
  'className',
  'department',
  'departmentId',
  'semester',
  'timetableStatus',
  'timetableData',
  'timetableRemarks',
  'maxHoursPerDayPerStaff',
];

function pickClassFields(source) {
  const result = {};
  for (const key of ALLOWED_FIELDS) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

// Phase 2 step 18: tutorUserId is no longer accepted by createClass/
// updateClass at all — a caller-supplied value is now an explicit 400,
// not a silent no-op (dropping it via ALLOWED_FIELDS alone would look
// like it worked). Use classTutorService.assignClassTutor/
// reassignClassTutor (routed through POST/PUT /classes/:id/tutor)
// instead — a genuinely different actor set (HOD-only, own-department)
// than the rest of this file's principal-only create/update.
function assertNoTutorUserIdInFields(fields) {
  if (fields.tutorUserId !== undefined) {
    throw new ClassValidationError(
      'tutorUserId can no longer be set via this endpoint — use POST /classes/:id/tutor (assign) or PUT /classes/:id/tutor (reassign) instead',
    );
  }
}

function assertValidTimetableStatus(timetableStatus) {
  if (timetableStatus !== undefined && !VALID_TIMETABLE_STATUSES.includes(timetableStatus)) {
    throw new ClassTimetableStatusError(`timetableStatus ${JSON.stringify(timetableStatus)} is not a known value`);
  }
}

async function createClass(client, { collegeId, className, ...rest }, { actorUserId } = {}) {
  if (!className) {
    throw new ClassValidationError('className is required');
  }
  assertNoTutorUserIdInFields(rest);
  assertValidTimetableStatus(rest.timetableStatus);

  let cls;
  try {
    cls = await classRepository.create(client, {
      collegeId,
      className,
      ...pickClassFields(rest),
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'classes_college_id_class_name_key') {
      throw new ClassNameConflictError(`className ${JSON.stringify(className)} already exists for this college`);
    }
    if (err.code === '23503' && err.constraint === 'classes_department_id_fkey') {
      throw new ClassDepartmentNotFoundError(`departmentId ${JSON.stringify(rest.departmentId)} does not exist`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'class_created',
    entity: 'classes',
    entityId: cls.id,
    metadata: null,
  });

  return cls;
}

// null means no class exists with this id — not an error. The route
// turns that into 404, same as staffService.getStaff.
async function getClass(client, id) {
  return classRepository.findById(client, id);
}

const WORKFLOW_MANAGED_TIMETABLE_STATUSES = ['Pending HOD', 'Pending Principal', 'Approved', 'Rejected'];

async function updateClass(client, id, fields, { userId }) {
  assertNoTutorUserIdInFields(fields);
  const patch = pickClassFields(fields);
  assertValidTimetableStatus(patch.timetableStatus);
  if (WORKFLOW_MANAGED_TIMETABLE_STATUSES.includes(patch.timetableStatus)) {
    throw new ClassTimetableStatusManagedByWorkflowError(
      `timetableStatus ${JSON.stringify(patch.timetableStatus)} can only be reached via submitTimetableForApproval/approveTimetableApproval/rejectTimetableApproval, not a direct update`,
    );
  }
  const hasChanges = Object.keys(patch).length > 0;

  let cls;
  try {
    cls = await classRepository.update(client, id, patch);
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'classes_college_id_class_name_key') {
      throw new ClassNameConflictError(`className ${JSON.stringify(patch.className)} already exists for this college`);
    }
    if (err.code === '23503' && err.constraint === 'classes_department_id_fkey') {
      throw new ClassDepartmentNotFoundError(`departmentId ${JSON.stringify(patch.departmentId)} does not exist`);
    }
    throw err;
  }

  // hasChanges guards the no-op case (fields had nothing recognized —
  // classRepository.update falls back to a plain findById then). cls
  // !== null guards the id-not-found case. Either way, no row was
  // actually changed, so no audit entry.
  if (hasChanges && cls !== null) {
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId: cls.college_id,
      userId,
      action: 'class_updated',
      entity: 'classes',
      entityId: id,
      metadata: null,
    });
  }

  return cls;
}

// Looks the class up first, both to get collegeId for the audit entry
// (removeClass's signature, matching staffService.removeStaff, takes
// no collegeId of its own) and to avoid logging a removal for an id
// that never existed. Still a hard DELETE, not a soft-delete: the ERD
// has no soft-delete column yet — same open question flagged for
// students/staff, not resolved here either.
async function removeClass(client, id, { userId }) {
  const cls = await classRepository.findById(client, id);
  if (cls === null) {
    return null;
  }

  await classRepository.remove(client, id);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId,
    action: 'class_removed',
    entity: 'classes',
    entityId: id,
    metadata: null,
  });

  return cls;
}

async function listClasses(client, { limit, offset } = {}) {
  return classRepository.list(client, { limit, offset });
}

function sectionLabel(index) {
  return String.fromCharCode(65 + index);
}

// RS-CLS-001/RS-CLS-002: "A class is auto-generated the moment a
// department is created... one class per (year-within-department ×
// section) combination, for every year after the first." Called by
// collegeProfileService.createDepartment (L1, post-onboarding) and
// platformService.createDepartmentAtOnboarding (Platform Admin) right
// after the department row itself is created — never invoked on its
// own from a route, since a department without generated classes is
// not a state this rule allows to exist.
//
// courseDuration/defaultSections are both required here, not defaulted:
// per product decision, there is no platform-wide section-count
// default — the department's own creator must specify it, so a
// caller missing either is a caller bug (should have required it
// before ever reaching here), not a business-data gap to paper over
// silently.
//
// Year 1 is permanently excluded (RS-CLS-001, a platform invariant,
// not configurable) — in-scope years run from 2 to courseDuration
// inclusive. One academic year = two semesters (RS-CLS-002's own
// Progression row), so year Y covers semester numbers (Y-1)*2+1 and
// (Y-1)*2+2 — e.g. year 2 of a 4-year course covers semesters 3-4,
// year 4 covers semesters 7-8. Section labels are plain A, B, C...
// (String.fromCharCode), matching the rule's own "two sections" example
// wording, not a stored label of their own.
//
// Reuses createClass unchanged for each row (conflict mapping, audit
// logging) rather than a bespoke bulk-insert — generation differs from
// an ordinary create only in how many rows and what className/semester
// values are computed, not in what a "created class" means.
async function generateClassesForDepartment(
  client,
  { departmentId, collegeId, name, courseDuration, defaultSections },
  { actorUserId } = {},
) {
  if (!Number.isInteger(courseDuration) || courseDuration < 2) {
    throw new ClassGenerationValidationError(
      `courseDuration must be an integer of at least 2 (year 1 is always out of scope — RS-CLS-001), got ${JSON.stringify(courseDuration)}`,
    );
  }
  if (!Number.isInteger(defaultSections) || defaultSections < 1) {
    throw new ClassGenerationValidationError(
      `defaultSections must be a positive integer, got ${JSON.stringify(defaultSections)}`,
    );
  }

  const created = [];
  for (let year = 2; year <= courseDuration; year += 1) {
    const semesters = [(year - 1) * 2 + 1, (year - 1) * 2 + 2];
    for (const semesterNumber of semesters) {
      for (let sectionIndex = 0; sectionIndex < defaultSections; sectionIndex += 1) {
        const section = sectionLabel(sectionIndex);
        // eslint-disable-next-line no-await-in-loop
        const cls = await createClass(
          client,
          {
            collegeId,
            className: `${name} Sem ${semesterNumber} ${section}`,
            department: name,
            departmentId,
            semester: String(semesterNumber),
          },
          { actorUserId },
        );
        created.push(cls);
      }
    }
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'department_classes_generated',
    entity: 'departments',
    entityId: departmentId,
    metadata: { classCount: created.length, courseDuration, defaultSections },
  });

  return created;
}

module.exports = {
  resolveClassId,
  pickClassFields,
  assertNoTutorUserIdInFields,
  assertValidTimetableStatus,
  createClass,
  getClass,
  updateClass,
  removeClass,
  listClasses,
  sectionLabel,
  generateClassesForDepartment,
};
