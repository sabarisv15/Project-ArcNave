'use strict';

// Business logic for the per-class Examination section — validation
// and audit logging on top of examTimetableVersionRepository.js
// (which does neither, CLAUDE.md rule 1) and documentService (the
// sole file-storage owner, CLAUDE.md rule 2 — this file never calls
// documentRepository or fileStorage directly, only documentService).
//
// BusinessRules.md Examination management: "no separate Exam Cell
// module... each class has a generic Examination section, owned by
// that class's Tutor, for official (University/DOTE) examination
// timetables and related documents... the Tutor verifies AI-extracted
// data and publishes without HOD or Principal approval."
//
// AI extraction/diffing ("AI extracts relevant class timetable data
// from PDFs, compares revisions, highlights differences" and the
// "alert only on meaningful change" rule) is a separate, larger slice
// — not built here, same "split off a genuinely separate piece" this
// codebase's own syllabus-extraction precedent (curriculumService)
// already follows. What IS built here: class-scoped document upload,
// version numbering, and the "Current Official" flag — the structural
// half of the rule, independent of whether a human or an AI-assisted
// extraction produced the uploaded file.

const classRepository = require('../repositories/classRepository');
const identityService = require('./identityService');
const documentService = require('./documentService');
const examTimetableVersionRepository = require('../repositories/examTimetableVersionRepository');
const auditLogRepository = require('../repositories/auditLogRepository');

class ExaminationValidationError extends Error {}
class ExaminationClassNotFoundError extends Error {}

// uploadExamDocument/publishExamTimetableVersion called by a user who
// is not the class's own tutor — BusinessRules.md names the Class
// Tutor as the sole actor for this whole section ("owned by that
// class's Tutor"), same per-row identity check
// studentService.createStudent's own StudentNotClassTutorError
// already establishes.
class ExaminationNotTutorError extends Error {}

class ExaminationDocumentNotFoundError extends Error {}

// publishExamTimetableVersion given a documentId that exists but
// belongs to a different class (or no class at all) — publishing a
// student document or another class's document as this class's exam
// timetable would silently cross a boundary BusinessRules.md's
// "each class maintains its own examination timetable" rule exists to
// prevent.
class ExaminationDocumentClassMismatchError extends Error {}

// Phase 2 step 14: classes.tutor_user_id -> the Position/Account/
// Occupant model, same swap sendClassAlert's own gate already made
// (step 13) — identityService.resolvePositionOccupant's {classId}
// overload is the one entry point, never a direct
// positionRepository/resolver call of this file's own.
//
// 4-login authorization architecture (2026-08-09): actorRole must be
// 'class_tutor' — the CURRENT LOGIN's identity. Position Occupancy
// alone (resolvePositionOccupant matching actorUserId) is informational
// and must never substitute for this, even for a personal Staff login
// belonging to the class's real tutor.
async function assertIsTutor(client, classId, actorUserId, actorRole) {
  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new ExaminationClassNotFoundError(`class ${JSON.stringify(classId)} does not exist`);
  }
  if (actorRole !== 'class_tutor') {
    throw new ExaminationNotTutorError(`user ${JSON.stringify(actorUserId)}'s current login (role ${JSON.stringify(actorRole)}) is not a Class Tutor Position Account`);
  }
  const tutorUserId = await identityService.resolvePositionOccupant(client, { collegeId: cls.college_id, classId });
  if (tutorUserId !== actorUserId) {
    throw new ExaminationNotTutorError(`user ${JSON.stringify(actorUserId)} is not the tutor of class ${JSON.stringify(classId)}`);
  }
  return cls;
}

// docType is free text (e.g. 'exam_timetable', 'exam_announcement') —
// BusinessRules.md's own "generic repository for documents,
// announcements, updates, and information decided by the Class Tutor"
// deliberately doesn't enumerate fixed types here, matching every
// other free-text doc_type precedent in this schema.
async function uploadExamDocument(client, classId, { docType, fileName, mimeType, fileBuffer }, { actorUserId, actorRole } = {}) {
  const cls = await assertIsTutor(client, classId, actorUserId, actorRole);
  return documentService.uploadDocument(
    client,
    {
      collegeId: cls.college_id, classId, docType, fileName, mimeType, fileBuffer,
    },
    { actorUserId },
  );
}

async function listExamDocumentsForClass(client, classId) {
  return documentService.listDocumentsForClass(client, classId);
}

// BusinessRules.md: "revised timetables are uploaded as new versions;
// after review and publication, the latest version becomes Current
// Official." Publishing is a separate, explicit step from uploading
// (uploadExamDocument above) — an uploaded PDF isn't official until
// the Tutor deliberately publishes it, same "review, then publish"
// two-step shape Rule 19's own wording describes.
async function publishExamTimetableVersion(client, classId, documentId, { actorUserId, actorRole } = {}) {
  const cls = await assertIsTutor(client, classId, actorUserId, actorRole);

  const document = await documentService.getDocument(client, documentId);
  if (document === null) {
    throw new ExaminationDocumentNotFoundError(`document ${JSON.stringify(documentId)} does not exist`);
  }
  if (document.class_id !== classId) {
    throw new ExaminationDocumentClassMismatchError(
      `document ${JSON.stringify(documentId)} does not belong to class ${JSON.stringify(classId)}`,
    );
  }

  await examTimetableVersionRepository.clearCurrentOfficialForClass(client, classId);
  const versionNumber = (await examTimetableVersionRepository.countForClass(client, classId)) + 1;
  const version = await examTimetableVersionRepository.create(client, {
    collegeId: cls.college_id, classId, documentId, versionNumber, publishedByUserId: actorUserId,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: actorUserId,
    action: 'exam_timetable_published',
    entity: 'exam_timetable_versions',
    entityId: version.id,
    metadata: { versionNumber },
  });

  return version;
}

async function getCurrentOfficialTimetable(client, classId) {
  return examTimetableVersionRepository.findCurrentOfficialForClass(client, classId);
}

async function listExamTimetableVersions(client, classId) {
  return examTimetableVersionRepository.listForClass(client, classId);
}

module.exports = {
  ExaminationValidationError,
  ExaminationClassNotFoundError,
  ExaminationNotTutorError,
  ExaminationDocumentNotFoundError,
  ExaminationDocumentClassMismatchError,
  uploadExamDocument,
  listExamDocumentsForClass,
  publishExamTimetableVersion,
  getCurrentOfficialTimetable,
  listExamTimetableVersions,
};
