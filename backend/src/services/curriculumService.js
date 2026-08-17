'use strict';

// Business logic for `regulations`/`subjects` and the Curriculum
// Migration workflow — validation and audit logging on top of
// regulationRepository.js/subjectRepository.js/studentRepository.js,
// none of which do either (CLAUDE.md rule 1). Never calls
// studentService from here (CLAUDE.md rule 4 analogue: repositories
// never call other repositories — this file calls studentRepository
// directly for the one column, regulation_id/pending_regulation_id,
// that only CurriculumService is allowed to write, same reasoning
// financeService.checkScholarshipEligibility reads students through
// StudentService for read access while this file writes through
// studentRepository directly for a column StudentService's own
// ALLOWED_FIELDS deliberately excludes).
//
// BusinessRules.md Academic/Timetable — Curriculum/regulation
// versioning: "a student's regulation is fixed at admission and stays
// fixed except through an official Curriculum Migration workflow...
// historical regulation versions never change." There is no
// updateRegulation/updateSubject-after-publish path exposed here for
// the historical-immutability half of that rule — subjects may be
// edited only up to the point they're used (this slice doesn't gate
// that further; a real "subject already referenced by attendance/exam"
// lock is a future concern, not guessed at here).

const regulationRepository = require('../repositories/regulationRepository');
const subjectRepository = require('../repositories/subjectRepository');
const studentRepository = require('../repositories/studentRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const workflowService = require('./workflowService');
const staffService = require('./staffService');

class RegulationValidationError extends Error {}
class RegulationNameConflictError extends Error {}
class RegulationNotFoundError extends Error {}

class SubjectValidationError extends Error {}
class SubjectCodeConflictError extends Error {}
class SubjectRegulationNotFoundError extends Error {}
class SubjectNotFoundError extends Error {}

class CurriculumMigrationValidationError extends Error {}
class CurriculumMigrationStudentNotFoundError extends Error {}
class CurriculumMigrationRegulationNotFoundError extends Error {}
class CurriculumMigrationNoPendingRequestError extends Error {}

async function createRegulation(client, { collegeId, name, description }, { actorUserId } = {}) {
  if (!collegeId || !name) {
    throw new RegulationValidationError('collegeId and name are required');
  }

  let regulation;
  try {
    regulation = await regulationRepository.create(client, { collegeId, name, description, createdByUserId: actorUserId });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'regulations_college_name_key') {
      throw new RegulationNameConflictError(`a regulation named ${JSON.stringify(name)} already exists for this college`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId, userId: actorUserId, action: 'regulation_created', entity: 'regulations', entityId: regulation.id, metadata: null,
  });

  return regulation;
}

async function getRegulation(client, id) {
  return regulationRepository.findById(client, id);
}

async function listRegulations(client, { limit, offset } = {}) {
  return regulationRepository.list(client, { limit, offset });
}

async function createSubject(client, {
  collegeId, regulationId, subjectCode, subjectName, semester, credits, lectureHours, tutorialHours, practicalHours, subjectType, prerequisites, sourceDocumentId,
}, { actorUserId } = {}) {
  if (!regulationId || !subjectCode || !subjectName || !semester) {
    throw new SubjectValidationError('regulationId, subjectCode, subjectName, and semester are required');
  }

  const regulation = await regulationRepository.findById(client, regulationId);
  if (regulation === null) {
    throw new SubjectRegulationNotFoundError(`regulation ${JSON.stringify(regulationId)} does not exist`);
  }

  let subject;
  try {
    subject = await subjectRepository.create(client, {
      collegeId, regulationId, subjectCode, subjectName, semester, credits, lectureHours, tutorialHours, practicalHours, subjectType, prerequisites, sourceDocumentId,
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'subjects_regulation_subject_code_key') {
      throw new SubjectCodeConflictError(`subject code ${JSON.stringify(subjectCode)} already exists in this regulation`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId, userId: actorUserId, action: 'subject_created', entity: 'subjects', entityId: subject.id, metadata: null,
  });

  return subject;
}

async function getSubject(client, id) {
  return subjectRepository.findById(client, id);
}

async function listSubjectsForRegulation(client, regulationId) {
  return subjectRepository.findByRegulation(client, regulationId);
}

async function updateSubject(client, id, fields, { userId } = {}) {
  let subject;
  try {
    subject = await subjectRepository.update(client, id, fields);
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'subjects_regulation_subject_code_key') {
      throw new SubjectCodeConflictError(`subject code ${JSON.stringify(fields.subjectCode)} already exists in this regulation`);
    }
    throw err;
  }
  if (subject === null) {
    return null;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: subject.college_id, userId, action: 'subject_updated', entity: 'subjects', entityId: id, metadata: null,
  });
  return subject;
}

async function removeSubject(client, id, { userId } = {}) {
  const subject = await subjectRepository.softDelete(client, id);
  if (subject === null) {
    return null;
  }
  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: subject.college_id, userId, action: 'subject_removed', entity: 'subjects', entityId: id, metadata: null,
  });
  return subject;
}

// BusinessRules.md: "internal department or course transfers update
// academic context while preserving enrollment continuity... a
// student's regulation is fixed after admission except through an
// official Curriculum Migration workflow." Single-step chain
// (Principal only) — same reasoning financeService.
// submitFeeStructureApproval gives for fee_structures: nothing scopes
// a student's regulation to one department the way Staff's
// HOD->Principal chain needs a real HOD to resolve.
async function requestCurriculumMigration(client, studentId, toRegulationId, { requestedByUserId, origin = 'human' } = {}) {
  if (!requestedByUserId) {
    throw new CurriculumMigrationValidationError('requestedByUserId is required');
  }

  const student = await studentRepository.findById(client, studentId);
  if (student === null) {
    throw new CurriculumMigrationStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }
  const toRegulation = await regulationRepository.findById(client, toRegulationId);
  if (toRegulation === null) {
    throw new CurriculumMigrationRegulationNotFoundError(`regulation ${JSON.stringify(toRegulationId)} does not exist`);
  }

  const principal = await staffService.findPrincipal(client, student.college_id);

  const request = await workflowService.submitRequest(client, {
    collegeId: student.college_id,
    entityType: 'curriculum_migration',
    entityId: student.id,
    requestedByUserId,
    origin,
    approverChain: [{ step: 1, role: 'principal', user_id: principal.user_id }],
  });

  await studentRepository.update(client, studentId, { pendingRegulationId: toRegulationId });

  return request;
}

async function loadPendingCurriculumMigration(client, studentId) {
  const student = await studentRepository.findById(client, studentId);
  if (student === null) {
    throw new CurriculumMigrationStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }

  const pending = await workflowService.findPendingForEntity(client, 'curriculum_migration', studentId);
  if (pending === null) {
    throw new CurriculumMigrationNoPendingRequestError(`student ${JSON.stringify(studentId)} has no pending curriculum migration request`);
  }

  return { student, pending };
}

async function approveCurriculumMigration(client, studentId, { actorUserId, remarks } = {}) {
  const { student, pending } = await loadPendingCurriculumMigration(client, studentId);
  await workflowService.approveRequest(client, pending.id, { actorUserId, remarks });

  const updated = await studentRepository.update(client, studentId, {
    regulationId: student.pending_regulation_id,
    pendingRegulationId: null,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: student.college_id,
    userId: actorUserId,
    action: 'curriculum_migration_approved',
    entity: 'students',
    entityId: studentId,
    metadata: null,
  });

  return updated;
}

async function rejectCurriculumMigration(client, studentId, { actorUserId, remarks } = {}) {
  const { student, pending } = await loadPendingCurriculumMigration(client, studentId);
  await workflowService.rejectRequest(client, pending.id, { actorUserId, remarks });

  const updated = await studentRepository.update(client, studentId, { pendingRegulationId: null });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: student.college_id,
    userId: actorUserId,
    action: 'curriculum_migration_rejected',
    entity: 'students',
    entityId: studentId,
    metadata: null,
  });

  return updated;
}

module.exports = {
  RegulationValidationError,
  RegulationNameConflictError,
  RegulationNotFoundError,
  SubjectValidationError,
  SubjectCodeConflictError,
  SubjectRegulationNotFoundError,
  SubjectNotFoundError,
  CurriculumMigrationValidationError,
  CurriculumMigrationStudentNotFoundError,
  CurriculumMigrationRegulationNotFoundError,
  CurriculumMigrationNoPendingRequestError,
  createRegulation,
  getRegulation,
  listRegulations,
  createSubject,
  getSubject,
  listSubjectsForRegulation,
  updateSubject,
  removeSubject,
  requestCurriculumMigration,
  approveCurriculumMigration,
  rejectCurriculumMigration,
};
