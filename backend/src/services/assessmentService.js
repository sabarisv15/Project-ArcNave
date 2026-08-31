'use strict';

// Business logic for `assessment_types`/`assessment_marks` — validation
// and audit logging on top of assessmentTypeRepository.js/
// assessmentMarkRepository.js, neither of which do either (CLAUDE.md
// rule 1).
//
// BusinessRules.md Assessment marks: "the assigned Subject Faculty
// records assessment marks for their subject... the system stores the
// marks as entered without performing institutional internal mark
// calculations." No grade/best-of/weightage calculation exists
// anywhere in this file, deliberately — marksObtained is stored
// exactly as given, every time, forever. "Assessment types are
// institution-wide, configurable, editable by authorized
// administrators" — the actor check for create/updateAssessmentType is
// left to the route/RBAC layer (principal-only, same conservative
// default other institution-configuration actions in this codebase
// use), not resolved here.

const assessmentTypeRepository = require('../repositories/assessmentTypeRepository');
const assessmentMarkRepository = require('../repositories/assessmentMarkRepository');
const assessmentMarkCorrectionRepository = require('../repositories/assessmentMarkCorrectionRepository');
const assessmentSubmissionRepository = require('../repositories/assessmentSubmissionRepository');
const assessmentMarkReevaluationRepository = require('../repositories/assessmentMarkReevaluationRepository');
const facultyAllocationRepository = require('../repositories/facultyAllocationRepository');
const classRepository = require('../repositories/classRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const visibilityService = require('./visibilityService');
const workflowService = require('./workflowService');
const workflowChainService = require('./workflowChainService');
const identityService = require('./identityService');
const { isUuid, IdentifierResolutionError } = require('../identifierResolution');

// resolveAssessmentTypeId: mirrors studentService.resolveStudentId/
// staffService.resolveStaffId/academicService.resolveClassId — given
// either a real assessment_types id or its human-readable name (e.g.
// "Midterm"), returns the real id, or throws IdentifierResolutionError
// if neither resolves within this college. Same motivation: an AI
// Copilot caller only ever has the type's name to go on, never its
// internal id, and a guessed/invented value must be a clean
// rejection, not a raw Postgres uuid-cast crash out of
// assessmentMarkRepository's own WHERE clause.
async function resolveAssessmentTypeId(client, collegeId, identifier) {
  if (isUuid(identifier)) {
    return identifier;
  }
  const assessmentType = await assessmentTypeRepository.findByName(client, collegeId, identifier);
  if (assessmentType === null) {
    throw new IdentifierResolutionError(`no assessment type found named ${JSON.stringify(identifier)} in this college`);
  }
  return assessmentType.id;
}

class AssessmentTypeValidationError extends Error {}
class AssessmentTypeNameConflictError extends Error {}
class AssessmentTypeNotFoundError extends Error {}
class AssessmentTypeNotAuthorizedError extends Error {}

// RS-ASM-012 (ADL-030): create is open to any teaching staff member —
// 'staff'/'class_tutor' must actually teach at least one class
// (reusing visibilityService's own SELF_ASSIGNED scope, the same set
// RS-STF-012's Class Log already keys off of); 'hod'/'principal' carry
// broader institutional authority already and are not required to
// teach a class themselves.
async function assertHasTeachingAssignment(client, { actorUserId, actorRole, collegeId }) {
  if (actorRole === 'hod' || actorRole === 'principal') {
    return;
  }
  const classIds = await visibilityService.getVisibleClassIds(client, { actorUserId, actorRole, collegeId });
  if (classIds !== null && classIds.length === 0) {
    throw new AssessmentTypeNotAuthorizedError(`user ${JSON.stringify(actorUserId)} does not teach any class`);
  }
}

class AssessmentMarkValidationError extends Error {}
class AssessmentMarkClassNotFoundError extends Error {}

// recordMark called by a user with no faculty_allocation row for this
// exact (class, subject) — BusinessRules.md: "only the assigned
// Subject Faculty can enter assessment marks." Checked against
// faculty_allocation's existing (class_id, subject, staff_user_id)
// shape, same free-text subject key that table already uses (see the
// migration's own comment on why this doesn't use the newer curriculum
// `subjects` table).
class AssessmentMarkNotAssignedFacultyError extends Error {}

// RS-ASM-002/003 (D7, ADL-014): "First-time entry ... is a direct write.
// Any later write to a mark value that already exists is a correction."
// recordMark called for a (student, assessmentType, class, subject) slot
// that already has a value — the caller must use requestMarkCorrection
// instead of a second direct write.
class AssessmentMarkAlreadyRecordedError extends Error {}

// requestMarkCorrection/approveMarkCorrection/rejectMarkCorrection/
// escalateMarkCorrection's own required inputs missing, or given a
// markId/correctionId with no matching row.
class MarkCorrectionValidationError extends Error {}
class MarkCorrectionNotFoundError extends Error {}

// approveMarkCorrection/rejectMarkCorrection/escalateMarkCorrection
// given a correction with no live Pending workflow_requests row (never
// submitted, or already resolved).
class MarkCorrectionNoPendingRequestError extends Error {}

// escalateMarkCorrection given an escalateToRole other than 'hod' or
// 'principal' — RS-ASM-003's own discretionary-escalation option,
// identical shape to RS-ATT-004's (D9).
class MarkCorrectionInvalidEscalationError extends Error {}

// approveMarkCorrection/rejectMarkCorrection/escalateMarkCorrection
// called by an actor whose CURRENT LOGIN is not a Class Tutor Position
// Account (actorRole !== 'class_tutor') — 4-login authorization
// architecture (2026-08-09), same reasoning as attendanceService's own
// AttendanceCorrectionNotAuthorizedError.
class MarkCorrectionNotAuthorizedError extends Error {}

// Lock/submit workflow errors. A batch is the (academicYear, classId,
// subject, assessmentTypeId) tuple assessment_submissions is keyed by.
class AssessmentSubmissionValidationError extends Error {}
class AssessmentSubmissionNotFoundError extends Error {}

// lockAssessmentSubmission called on a batch that isn't 'draft', or
// submitAssessmentSubmission/unlockAssessmentSubmission called on a
// batch that isn't in the state each requires — see each function's own
// comment for its required starting state.
class AssessmentSubmissionInvalidTransitionError extends Error {}

// recordMark/updateMark called against a batch that is 'locked' (use
// requestMarkCorrection instead) or 'submitted' (use
// requestMarkReevaluation instead) — the direct-edit path only exists
// while a batch is still 'draft'.
class AssessmentBatchNotEditableError extends Error {}

// requestMarkCorrection called against a batch that is not 'locked' —
// 'draft' should be a direct edit, 'submitted' needs a re-evaluation.
class MarkCorrectionWrongBatchStateError extends Error {}

// requestMarkReevaluation/approveMarkReevaluation/rejectMarkReevaluation's
// own required inputs missing, or given a markId/reevaluationId with no
// matching row.
class MarkReevaluationValidationError extends Error {}
class MarkReevaluationNotFoundError extends Error {}

// requestMarkReevaluation called against a batch that has not been
// submitted yet — a dispute over a mark that isn't final yet is a
// correction (once locked) or a direct edit (while still draft), not a
// re-evaluation.
class MarkReevaluationNotSubmittedError extends Error {}

// approveMarkReevaluation/rejectMarkReevaluation given a reevaluation
// with no live Pending workflow_requests row (never submitted, or
// already resolved).
class MarkReevaluationNoPendingRequestError extends Error {}

async function createAssessmentType(client, { collegeId, name, maxMarks }, { actorUserId, actorRole } = {}) {
  if (!collegeId || !name) {
    throw new AssessmentTypeValidationError('collegeId and name are required');
  }
  await assertHasTeachingAssignment(client, { actorUserId, actorRole, collegeId });

  let assessmentType;
  try {
    assessmentType = await assessmentTypeRepository.create(client, {
      collegeId,
      name,
      maxMarks,
      createdByUserId: actorUserId,
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'assessment_types_college_name_key') {
      throw new AssessmentTypeNameConflictError(
        `an assessment type named ${JSON.stringify(name)} already exists for this college`,
      );
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'assessment_type_created',
    entity: 'assessment_types',
    entityId: assessmentType.id,
    metadata: null,
  });

  return assessmentType;
}

async function listAssessmentTypes(client, { limit, offset } = {}) {
  return assessmentTypeRepository.list(client, { limit, offset });
}

// RS-ASM-012 (ADL-030): creator-only, no role override — same
// precedent RS-STF-012's Class Log already set. A row with no recorded
// creator (created_by_user_id IS NULL — pre-existing legacy/seed rows
// only) is the one exception: principal may edit those specifically,
// so no row is left permanently unfixable.
async function assertCanEditAssessmentType(client, id, { actorUserId, actorRole }) {
  const existing = await assessmentTypeRepository.findById(client, id);
  if (existing === null) {
    return;
  }
  if (existing.created_by_user_id === null) {
    if (actorRole === 'principal') {
      return;
    }
    throw new AssessmentTypeNotAuthorizedError(
      `assessment type ${JSON.stringify(id)} has no recorded creator — only principal may edit it`,
    );
  }
  if (existing.created_by_user_id !== actorUserId) {
    throw new AssessmentTypeNotAuthorizedError(
      `user ${JSON.stringify(actorUserId)} did not create assessment type ${JSON.stringify(id)}`,
    );
  }
}

async function updateAssessmentType(client, id, fields, { actorUserId, actorRole } = {}) {
  await assertCanEditAssessmentType(client, id, { actorUserId, actorRole });
  let assessmentType;
  try {
    assessmentType = await assessmentTypeRepository.update(client, id, fields);
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'assessment_types_college_name_key') {
      throw new AssessmentTypeNameConflictError(
        `an assessment type named ${JSON.stringify(fields.name)} already exists for this college`,
      );
    }
    throw err;
  }
  if (assessmentType === null) {
    return null;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: assessmentType.college_id,
    userId: actorUserId,
    action: 'assessment_type_updated',
    entity: 'assessment_types',
    entityId: id,
    metadata: null,
  });
  return assessmentType;
}

async function assertIsAssignedFaculty(client, classId, subject, actorUserId) {
  const allocations = await facultyAllocationRepository.findByClassId(client, classId);
  const isAssigned = allocations.some((a) => a.subject === subject && a.staff_user_id === actorUserId);
  if (!isAssigned) {
    throw new AssessmentMarkNotAssignedFacultyError(
      `user ${JSON.stringify(actorUserId)} is not the assigned Subject Faculty for ${JSON.stringify(subject)} in class ${JSON.stringify(classId)}`,
    );
  }
}

// Looks up the assessment_submissions batch row for a (academicYear,
// classId, subject, assessmentTypeId) tuple. Returns a synthetic
// { status: 'draft' } when no row exists yet — a batch with no marks
// entered at all is implicitly draft, same "row's mere existence
// carries meaning" precedent assessment_marks.marksObtained's own
// migration comment already sets, applied one level up.
async function findBatchStatus(client, { academicYear, classId, subject, assessmentTypeId }) {
  const submission = await assessmentSubmissionRepository.findOne(client, {
    academicYear,
    classId,
    subject,
    assessmentTypeId,
  });
  return submission || { status: 'draft' };
}

// Direct-edit gate shared by recordMark (new marks) and updateMark
// (existing marks): both are only a plain write while the batch is
// still 'draft'. 'locked' routes through requestMarkCorrection (tutor
// approval); 'submitted' routes through requestMarkReevaluation (HOD
// approval).
function assertBatchDraft(batch) {
  if (batch.status === 'locked') {
    throw new AssessmentBatchNotEditableError(
      'this assessment has been locked — submit a correction request instead of editing directly',
    );
  }
  if (batch.status === 'submitted') {
    throw new AssessmentBatchNotEditableError(
      'this assessment has already been submitted — submit a re-evaluation request instead of editing directly',
    );
  }
}

// Round 10 P2/P3 finding: marksObtained had no range/sanity check at
// all — a negative value or one exceeding the assessment type's own
// max_marks would be stored exactly as given, same as any legitimate
// value. Distinct from this file's own "no grade/weightage calculation"
// rule above (BusinessRules.md) — that rule is about not deriving a
// SECOND number from marksObtained, not about accepting an impossible
// one. maxMarks is genuinely optional at the schema level
// (assessment_types.max_marks is nullable — an institution may not have
// set one yet), so the upper-bound half of this check only applies once
// a real max_marks exists; the non-negative half always applies.
function assertMarksInRange(marksObtained, maxMarks) {
  if (Number(marksObtained) < 0) {
    throw new AssessmentMarkValidationError(`marksObtained (${marksObtained}) cannot be negative`);
  }
  if (maxMarks !== null && maxMarks !== undefined && Number(marksObtained) > Number(maxMarks)) {
    throw new AssessmentMarkValidationError(
      `marksObtained (${marksObtained}) cannot exceed this assessment type's max_marks (${maxMarks})`,
    );
  }
}

// RS-ASM-002 (D7, ADL-014): first-time entry ONLY — a direct, audited
// write by the assigned Subject Faculty, allowed only while the batch
// is still 'draft' (assertBatchDraft). Refuses outright
// (AssessmentMarkAlreadyRecordedError) if this exact (student,
// assessmentType, class, subject) slot already has a value — use
// updateMark for a same-slot edit while still draft, or
// requestMarkCorrection/requestMarkReevaluation once locked/submitted.
// Mirrors financeService.markFeePayment's identical first-write-only
// shape (RS-FIN-002/003).
async function recordMark(
  client,
  { academicYear, classId, subject, assessmentTypeId, studentId, marksObtained },
  { actorUserId } = {},
) {
  if (
    !academicYear ||
    !classId ||
    !subject ||
    !assessmentTypeId ||
    !studentId ||
    marksObtained === undefined ||
    marksObtained === null
  ) {
    throw new AssessmentMarkValidationError(
      'academicYear, classId, subject, assessmentTypeId, studentId, and marksObtained are required',
    );
  }

  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new AssessmentMarkClassNotFoundError(`class ${JSON.stringify(classId)} does not exist`);
  }
  await assertIsAssignedFaculty(client, classId, subject, actorUserId);

  const batch = await findBatchStatus(client, {
    academicYear,
    classId,
    subject,
    assessmentTypeId,
  });
  assertBatchDraft(batch);

  // Checked after assertBatchDraft, not before: a batch that can't be
  // directly edited at all should reject on THAT state, not on the
  // proposed value's range — same "state gate before value validation"
  // ordering the rest of this function already uses (class exists,
  // then faculty-assigned, then batch-editable, then value-specific
  // checks).
  const assessmentType = await assessmentTypeRepository.findById(client, assessmentTypeId);
  assertMarksInRange(marksObtained, assessmentType ? assessmentType.max_marks : null);

  const existing = await assessmentMarkRepository.findOne(client, {
    studentId,
    assessmentTypeId,
    classId,
    subject,
  });
  if (existing !== null) {
    throw new AssessmentMarkAlreadyRecordedError(
      `student ${JSON.stringify(studentId)} already has a mark on record for this assessment — edit it directly while still draft, or submit a correction/re-evaluation once locked/submitted`,
    );
  }

  const mark = await assessmentMarkRepository.create(client, {
    collegeId: cls.college_id,
    academicYear,
    classId,
    subject,
    assessmentTypeId,
    studentId,
    marksObtained,
    enteredByUserId: actorUserId,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: actorUserId,
    action: 'assessment_mark_recorded',
    entity: 'assessment_marks',
    entityId: mark.id,
    metadata: { subject, assessmentTypeId },
  });

  return mark;
}

// The 'draft'-only counterpart to recordMark: a plain edit to a slot
// that already has a value, allowed only before the batch is locked.
// Mirrors recordMark's own shape (faculty-assignment check, batch-state
// check, audit log) but updates in place rather than inserting.
async function updateMark(client, markId, { marksObtained } = {}, { actorUserId } = {}) {
  if (marksObtained === undefined || marksObtained === null) {
    throw new AssessmentMarkValidationError('marksObtained is required');
  }

  const mark = await assessmentMarkRepository.findById(client, markId);
  if (mark === null) {
    throw new AssessmentMarkClassNotFoundError(`assessment mark ${JSON.stringify(markId)} does not exist`);
  }
  await assertIsAssignedFaculty(client, mark.class_id, mark.subject, actorUserId);

  const batch = await findBatchStatus(client, {
    academicYear: mark.academic_year,
    classId: mark.class_id,
    subject: mark.subject,
    assessmentTypeId: mark.assessment_type_id,
  });
  assertBatchDraft(batch);

  // Same "state gate before value validation" ordering recordMark uses
  // — see its own comment.
  const assessmentType = await assessmentTypeRepository.findById(client, mark.assessment_type_id);
  assertMarksInRange(marksObtained, assessmentType ? assessmentType.max_marks : null);

  const updated = await assessmentMarkRepository.update(client, markId, { marksObtained });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: mark.college_id,
    userId: actorUserId,
    action: 'assessment_mark_updated',
    entity: 'assessment_marks',
    entityId: markId,
    metadata: null,
  });

  return updated;
}

async function getOrCreateBatch(client, { collegeId, academicYear, classId, subject, assessmentTypeId }) {
  const existing = await assessmentSubmissionRepository.findOne(client, {
    academicYear,
    classId,
    subject,
    assessmentTypeId,
  });
  if (existing !== null) {
    return existing;
  }
  return assessmentSubmissionRepository.create(client, {
    collegeId,
    academicYear,
    classId,
    subject,
    assessmentTypeId,
    status: 'draft',
  });
}

// "Save and Lock": draft -> locked, freezing direct edits for this
// batch. Only the assigned Subject Faculty may lock their own batch.
async function lockAssessmentSubmission(
  client,
  { academicYear, classId, subject, assessmentTypeId },
  { actorUserId } = {},
) {
  if (!academicYear || !classId || !subject || !assessmentTypeId) {
    throw new AssessmentSubmissionValidationError('academicYear, classId, subject, and assessmentTypeId are required');
  }
  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new AssessmentMarkClassNotFoundError(`class ${JSON.stringify(classId)} does not exist`);
  }
  await assertIsAssignedFaculty(client, classId, subject, actorUserId);

  const batch = await getOrCreateBatch(client, {
    collegeId: cls.college_id,
    academicYear,
    classId,
    subject,
    assessmentTypeId,
  });
  if (batch.status !== 'draft') {
    throw new AssessmentSubmissionInvalidTransitionError(
      `assessment batch is ${JSON.stringify(batch.status)}, not 'draft' — cannot lock`,
    );
  }

  const updated = await assessmentSubmissionRepository.update(client, batch.id, {
    status: 'locked',
    lockedAt: new Date(),
    lockedByUserId: actorUserId,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: actorUserId,
    action: 'assessment_submission_locked',
    entity: 'assessment_submissions',
    entityId: updated.id,
    metadata: { subject, assessmentTypeId },
  });

  return updated;
}

// locked -> draft: staff changed their mind before submitting. Only
// available while still 'locked' — once 'submitted', there is no way
// back to direct editing (requestMarkReevaluation is the only path).
async function unlockAssessmentSubmission(
  client,
  { academicYear, classId, subject, assessmentTypeId },
  { actorUserId } = {},
) {
  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new AssessmentMarkClassNotFoundError(`class ${JSON.stringify(classId)} does not exist`);
  }
  await assertIsAssignedFaculty(client, classId, subject, actorUserId);

  const batch = await assessmentSubmissionRepository.findOne(client, {
    academicYear,
    classId,
    subject,
    assessmentTypeId,
  });
  if (batch === null) {
    throw new AssessmentSubmissionNotFoundError(
      'no assessment batch found for this academicYear/classId/subject/assessmentTypeId',
    );
  }
  if (batch.status !== 'locked') {
    throw new AssessmentSubmissionInvalidTransitionError(
      `assessment batch is ${JSON.stringify(batch.status)}, not 'locked' — cannot unlock`,
    );
  }

  const updated = await assessmentSubmissionRepository.update(client, batch.id, {
    status: 'draft',
    lockedAt: null,
    lockedByUserId: null,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: actorUserId,
    action: 'assessment_submission_unlocked',
    entity: 'assessment_submissions',
    entityId: updated.id,
    metadata: { subject, assessmentTypeId },
  });

  return updated;
}

// "Submit whenever ready": locked -> submitted. Must be locked first —
// submitting directly from 'draft' is refused so nothing reaches the
// HOD without the faculty explicitly freezing it first.
async function submitAssessmentSubmission(
  client,
  { academicYear, classId, subject, assessmentTypeId },
  { actorUserId } = {},
) {
  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new AssessmentMarkClassNotFoundError(`class ${JSON.stringify(classId)} does not exist`);
  }
  await assertIsAssignedFaculty(client, classId, subject, actorUserId);

  const batch = await assessmentSubmissionRepository.findOne(client, {
    academicYear,
    classId,
    subject,
    assessmentTypeId,
  });
  if (batch === null) {
    throw new AssessmentSubmissionNotFoundError(
      'no assessment batch found for this academicYear/classId/subject/assessmentTypeId',
    );
  }
  if (batch.status !== 'locked') {
    throw new AssessmentSubmissionInvalidTransitionError(
      `assessment batch is ${JSON.stringify(batch.status)}, not 'locked' — lock it before submitting`,
    );
  }

  const updated = await assessmentSubmissionRepository.update(client, batch.id, {
    status: 'submitted',
    submittedAt: new Date(),
    submittedByUserId: actorUserId,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: actorUserId,
    action: 'assessment_submission_submitted',
    entity: 'assessment_submissions',
    entityId: updated.id,
    metadata: { subject, assessmentTypeId },
  });

  return updated;
}

async function getAssessmentSubmissionStatus(client, { academicYear, classId, subject, assessmentTypeId }) {
  return findBatchStatus(client, {
    academicYear,
    classId,
    subject,
    assessmentTypeId,
  });
}

// RS-ASM-003 (D7, RS-DAT-002 structural pattern P1, ADL-014): "Any later
// write to a mark value that already exists is a correction, and the
// class's L4 approves it." Modeled directly on
// attendanceService.requestAttendanceCorrection/approveAttendanceCorrection/
// rejectAttendanceCorrection — the class's own tutor (not hod, unlike
// fee corrections) is the approver, same role RS-ASM-003 names
// explicitly ("the same role L4 already plays for attendance
// corrections").
async function requestMarkCorrection(
  client,
  markId,
  { proposedMarksObtained, reason } = {},
  { requestedByUserId, origin = 'human' } = {},
) {
  if (proposedMarksObtained === undefined || proposedMarksObtained === null) {
    throw new MarkCorrectionValidationError('proposedMarksObtained is required');
  }
  if (!requestedByUserId) {
    throw new MarkCorrectionValidationError('requestedByUserId is required');
  }

  const mark = await assessmentMarkRepository.findById(client, markId);
  if (mark === null) {
    throw new MarkCorrectionNotFoundError(`assessment mark ${JSON.stringify(markId)} does not exist`);
  }

  const batch = await findBatchStatus(client, {
    academicYear: mark.academic_year,
    classId: mark.class_id,
    subject: mark.subject,
    assessmentTypeId: mark.assessment_type_id,
  });
  if (batch.status !== 'locked') {
    throw new MarkCorrectionWrongBatchStateError(
      batch.status === 'draft'
        ? 'this assessment is still draft — edit the mark directly instead of requesting a correction'
        : 'this assessment has already been submitted — submit a re-evaluation request instead',
    );
  }

  const cls = await classRepository.findById(client, mark.class_id);
  const tutorUserId = cls
    ? await identityService.resolvePositionOccupant(client, { collegeId: cls.college_id, classId: cls.id })
    : null;

  const workflowRequest = await workflowService.submitRequest(client, {
    collegeId: mark.college_id,
    entityType: 'mark_correction',
    entityId: markId,
    requestedByUserId,
    origin,
    approverChain: [{ step: 1, role: 'tutor', user_id: tutorUserId }],
  });

  const correction = await assessmentMarkCorrectionRepository.create(client, {
    collegeId: mark.college_id,
    assessmentMarkId: markId,
    requestedByUserId,
    proposedMarksObtained,
    reason,
    workflowRequestId: workflowRequest.id,
  });

  return { workflowRequest, correction };
}

async function loadPendingMarkCorrectionApproval(client, correctionId) {
  const correction = await assessmentMarkCorrectionRepository.findById(client, correctionId);
  if (correction === null) {
    throw new MarkCorrectionNotFoundError(`assessment mark correction ${JSON.stringify(correctionId)} does not exist`);
  }
  if (correction.workflow_request_id === null) {
    throw new MarkCorrectionNoPendingRequestError(
      `assessment mark correction ${JSON.stringify(correctionId)} has no workflow request`,
    );
  }
  const pending = await workflowService.getRequest(client, correction.workflow_request_id);
  if (pending === null || pending.status !== 'Pending') {
    throw new MarkCorrectionNoPendingRequestError(
      `assessment mark correction ${JSON.stringify(correctionId)} has no pending approval request`,
    );
  }
  return { correction, pending };
}

// RS-DAT-002: the original assessment_marks row is never touched by a
// correction — only assessment_mark_corrections.applied_at is set;
// getEffectiveMark below is what "recomputes from it."
async function approveMarkCorrection(client, correctionId, { actorUserId, actorRole, remarks } = {}) {
  if (actorRole !== 'class_tutor') {
    throw new MarkCorrectionNotAuthorizedError(
      `user ${JSON.stringify(actorUserId)}'s current login (role ${JSON.stringify(actorRole)}) is not a Class Tutor Position Account`,
    );
  }
  const { correction, pending } = await loadPendingMarkCorrectionApproval(client, correctionId);
  await workflowService.approveRequest(client, pending.id, { actorUserId, remarks });

  const applied = await assessmentMarkCorrectionRepository.markApplied(client, correctionId);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: correction.college_id,
    userId: actorUserId,
    action: 'assessment_mark_correction_approved',
    entity: 'assessment_mark_corrections',
    entityId: correctionId,
    metadata: null,
  });

  return applied;
}

async function rejectMarkCorrection(client, correctionId, { actorUserId, actorRole, remarks } = {}) {
  if (actorRole !== 'class_tutor') {
    throw new MarkCorrectionNotAuthorizedError(
      `user ${JSON.stringify(actorUserId)}'s current login (role ${JSON.stringify(actorRole)}) is not a Class Tutor Position Account`,
    );
  }
  const { correction, pending } = await loadPendingMarkCorrectionApproval(client, correctionId);
  await workflowService.rejectRequest(client, pending.id, { actorUserId, remarks });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: correction.college_id,
    userId: actorUserId,
    action: 'assessment_mark_correction_rejected',
    entity: 'assessment_mark_corrections',
    entityId: correctionId,
    metadata: null,
  });

  return correction;
}

// RS-ASM-003: "L4 MAY choose to escalate a specific correction further
// up the institution's configured chain" — identical discretionary
// option to RS-ATT-004's (D9), same 'hod'/'principal' target set.
async function escalateMarkCorrection(client, correctionId, { actorUserId, actorRole, escalateToRole, remarks } = {}) {
  if (actorRole !== 'class_tutor') {
    throw new MarkCorrectionNotAuthorizedError(
      `user ${JSON.stringify(actorUserId)}'s current login (role ${JSON.stringify(actorRole)}) is not a Class Tutor Position Account`,
    );
  }
  if (!['hod', 'principal'].includes(escalateToRole)) {
    throw new MarkCorrectionInvalidEscalationError(
      `escalateToRole must be 'hod' or 'principal', got ${JSON.stringify(escalateToRole)}`,
    );
  }

  const { correction, pending } = await loadPendingMarkCorrectionApproval(client, correctionId);
  const mark = await assessmentMarkRepository.findById(client, correction.assessment_mark_id);
  const cls = await classRepository.findById(client, mark.class_id);

  const escalateToUserId = await workflowChainService.resolveRoleUserId(client, escalateToRole, {
    collegeId: correction.college_id,
    departmentId: cls.department_id,
  });

  const updated = await workflowService.escalateRequest(client, pending.id, {
    actorUserId,
    escalateToRole,
    escalateToUserId,
    remarks,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: correction.college_id,
    userId: actorUserId,
    action: 'assessment_mark_correction_escalated',
    entity: 'assessment_mark_corrections',
    entityId: correctionId,
    metadata: { escalateToRole },
  });

  return updated;
}

async function listMarkCorrectionsForMark(client, markId) {
  return assessmentMarkCorrectionRepository.listForMark(client, markId);
}

// The 'submitted'-only counterpart to requestMarkCorrection: a student
// disputing an already-submitted mark. Approver is HOD (Level 3 in the
// Principal=1/L2=2/HOD=3/Staff=4 chain), not the class tutor — a
// materially different actor and moment from a faculty self-correction
// while merely locked, hence the separate table/workflow entityType
// (see the migration's own file-level comment).
async function requestMarkReevaluation(
  client,
  markId,
  { proposedMarksObtained, reason } = {},
  { requestedByUserId, origin = 'human' } = {},
) {
  if (proposedMarksObtained === undefined || proposedMarksObtained === null) {
    throw new MarkReevaluationValidationError('proposedMarksObtained is required');
  }
  if (!requestedByUserId) {
    throw new MarkReevaluationValidationError('requestedByUserId is required');
  }

  const mark = await assessmentMarkRepository.findById(client, markId);
  if (mark === null) {
    throw new MarkReevaluationNotFoundError(`assessment mark ${JSON.stringify(markId)} does not exist`);
  }

  const batch = await findBatchStatus(client, {
    academicYear: mark.academic_year,
    classId: mark.class_id,
    subject: mark.subject,
    assessmentTypeId: mark.assessment_type_id,
  });
  if (batch.status !== 'submitted') {
    throw new MarkReevaluationNotSubmittedError(
      'this assessment has not been submitted yet — a re-evaluation only applies to a submitted mark',
    );
  }

  const cls = await classRepository.findById(client, mark.class_id);
  const hodUserId = await workflowChainService.resolveRoleUserId(client, 'hod', {
    collegeId: mark.college_id,
    departmentId: cls ? cls.department_id : undefined,
  });

  const workflowRequest = await workflowService.submitRequest(client, {
    collegeId: mark.college_id,
    entityType: 'mark_reevaluation',
    entityId: markId,
    requestedByUserId,
    origin,
    approverChain: [{ step: 1, role: 'hod', user_id: hodUserId }],
  });

  const reevaluation = await assessmentMarkReevaluationRepository.create(client, {
    collegeId: mark.college_id,
    assessmentMarkId: markId,
    requestedByUserId,
    proposedMarksObtained,
    reason,
    workflowRequestId: workflowRequest.id,
  });

  return { workflowRequest, reevaluation };
}

async function loadPendingMarkReevaluationApproval(client, reevaluationId) {
  const reevaluation = await assessmentMarkReevaluationRepository.findById(client, reevaluationId);
  if (reevaluation === null) {
    throw new MarkReevaluationNotFoundError(
      `assessment mark re-evaluation ${JSON.stringify(reevaluationId)} does not exist`,
    );
  }
  if (reevaluation.workflow_request_id === null) {
    throw new MarkReevaluationNoPendingRequestError(
      `assessment mark re-evaluation ${JSON.stringify(reevaluationId)} has no workflow request`,
    );
  }
  const pending = await workflowService.getRequest(client, reevaluation.workflow_request_id);
  if (pending === null || pending.status !== 'Pending') {
    throw new MarkReevaluationNoPendingRequestError(
      `assessment mark re-evaluation ${JSON.stringify(reevaluationId)} has no pending approval request`,
    );
  }
  return { reevaluation, pending };
}

async function approveMarkReevaluation(client, reevaluationId, { actorUserId, remarks } = {}) {
  const { reevaluation, pending } = await loadPendingMarkReevaluationApproval(client, reevaluationId);
  await workflowService.approveRequest(client, pending.id, { actorUserId, remarks });

  const applied = await assessmentMarkReevaluationRepository.markApplied(client, reevaluationId);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: reevaluation.college_id,
    userId: actorUserId,
    action: 'assessment_mark_reevaluation_approved',
    entity: 'assessment_mark_reevaluations',
    entityId: reevaluationId,
    metadata: null,
  });

  return applied;
}

async function rejectMarkReevaluation(client, reevaluationId, { actorUserId, remarks } = {}) {
  const { reevaluation, pending } = await loadPendingMarkReevaluationApproval(client, reevaluationId);
  await workflowService.rejectRequest(client, pending.id, { actorUserId, remarks });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: reevaluation.college_id,
    userId: actorUserId,
    action: 'assessment_mark_reevaluation_rejected',
    entity: 'assessment_mark_reevaluations',
    entityId: reevaluationId,
    metadata: null,
  });

  return reevaluation;
}

async function listMarkReevaluationsForMark(client, markId) {
  return assessmentMarkReevaluationRepository.listForMark(client, markId);
}

// RS-DAT-002's "effective value" half for marks: the original
// assessment_marks row (unchanged) overridden by whichever of the
// latest APPLIED correction/re-evaluation happened most recently, if
// either exists. Mirrors financeService.getEffectiveFeePaymentForStudent/
// attendanceService.getEffectiveAttendanceSession exactly, extended to
// two possible override sources instead of one.
async function getEffectiveMark(client, markId) {
  const mark = await assessmentMarkRepository.findById(client, markId);
  if (mark === null) {
    return null;
  }

  const [latestCorrection, latestReevaluation] = await Promise.all([
    assessmentMarkCorrectionRepository.findLatestApplied(client, markId),
    assessmentMarkReevaluationRepository.findLatestApplied(client, markId),
  ]);

  let latestApplied = null;
  let source = null;
  if (latestCorrection !== null) {
    latestApplied = latestCorrection;
    source = 'correction';
  }
  if (
    latestReevaluation !== null &&
    (latestApplied === null || latestReevaluation.applied_at > latestApplied.applied_at)
  ) {
    latestApplied = latestReevaluation;
    source = 'reevaluation';
  }

  if (latestApplied === null) {
    return { ...mark, effective: false };
  }

  return {
    ...mark,
    marks_obtained: latestApplied.proposed_marks_obtained,
    effective: true,
    effective_source: source,
    effective_correction_id: latestApplied.id,
  };
}

// BusinessRules.md: "mark entry uses filters such as Academic Year,
// Department, Class, Subject, and Assessment." departmentId is
// resolved to a list of classIds here (see
// assessmentMarkRepository.findByFilters' own comment on why that
// join doesn't live in the repository) — combined with an explicit
// classId if both are given, though naming both is an unusual caller
// choice, not one this function second-guesses.
async function listMarksForFilters(
  client,
  { academicYear, departmentId, classId, classIds: callerClassIds, subject, assessmentTypeId } = {},
) {
  let classIds = callerClassIds;
  if (departmentId !== undefined) {
    const classesInDept = await classRepository.findByDepartmentId(client, departmentId);
    classIds = classesInDept.map((c) => c.id);
    if (classIds.length === 0) {
      return [];
    }
  }

  return assessmentMarkRepository.findByFilters(client, {
    academicYear,
    classId,
    classIds,
    subject,
    assessmentTypeId,
  });
}

// Scope-aware entry point for the assessment_marks_summary AI tool:
// resolves the actor's own visible classIds via
// visibilityService.getVisibleClassIds — the one shared resolver every
// scoped AI read uses (accepts this same {actorUserId, actorRole,
// collegeId} legacy shape directly) — never a caller-supplied classId/
// departmentId. null from getVisibleClassIds means "unrestricted"
// (principal), so no classIds filter is applied at all in that case.
// actorInput: either the legacy {actorUserId, actorRole, collegeId}
// shape or an already-built ActorContext (Phase 4 Group (a)) —
// forwarded straight into getVisibleClassIds unchanged either way; see
// analyticsService.getAttendanceRateForActor's own comment.
async function listMarksForActor(client, actorInput, { academicYear, subject, assessmentTypeId } = {}) {
  const classIds = await visibilityService.getVisibleClassIds(client, actorInput);
  if (classIds !== null && classIds.length === 0) {
    return [];
  }
  return assessmentMarkRepository.findByFilters(client, {
    academicYear,
    classIds: classIds !== null ? classIds : undefined,
    subject,
    assessmentTypeId,
  });
}

async function removeMark(client, id, { actorUserId } = {}) {
  const mark = await assessmentMarkRepository.softDelete(client, id);
  if (mark === null) {
    return null;
  }
  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: mark.college_id,
    userId: actorUserId,
    action: 'assessment_mark_removed',
    entity: 'assessment_marks',
    entityId: id,
    metadata: null,
  });
  return mark;
}

module.exports = {
  AssessmentTypeValidationError,
  AssessmentTypeNameConflictError,
  AssessmentTypeNotAuthorizedError,
  AssessmentMarkValidationError,
  AssessmentMarkClassNotFoundError,
  AssessmentMarkNotAssignedFacultyError,
  AssessmentMarkAlreadyRecordedError,
  MarkCorrectionValidationError,
  MarkCorrectionNotFoundError,
  MarkCorrectionNoPendingRequestError,
  MarkCorrectionInvalidEscalationError,
  MarkCorrectionNotAuthorizedError,
  MarkCorrectionWrongBatchStateError,
  AssessmentSubmissionValidationError,
  AssessmentSubmissionNotFoundError,
  AssessmentSubmissionInvalidTransitionError,
  AssessmentBatchNotEditableError,
  MarkReevaluationValidationError,
  MarkReevaluationNotFoundError,
  MarkReevaluationNotSubmittedError,
  MarkReevaluationNoPendingRequestError,
  createAssessmentType,
  listAssessmentTypes,
  resolveAssessmentTypeId,
  updateAssessmentType,
  recordMark,
  updateMark,
  lockAssessmentSubmission,
  unlockAssessmentSubmission,
  submitAssessmentSubmission,
  getAssessmentSubmissionStatus,
  requestMarkCorrection,
  approveMarkCorrection,
  rejectMarkCorrection,
  escalateMarkCorrection,
  listMarkCorrectionsForMark,
  requestMarkReevaluation,
  approveMarkReevaluation,
  rejectMarkReevaluation,
  listMarkReevaluationsForMark,
  getEffectiveMark,
  listMarksForFilters,
  listMarksForActor,
  removeMark,
};
