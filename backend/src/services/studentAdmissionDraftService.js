'use strict';

// Create Student admission wizard — draft lifecycle + the async
// extraction orchestration. CLAUDE.md rule 1: calls other services/
// repositories, never touched directly by a route beyond this file.
//
// Ownership model: a draft is a personal worklist for the Class Tutor
// who started it (same "Save Draft/Resume Draft is personal, not
// shared" reasoning studentAdmissionDraftRepository.findInProgressByCreator
// already documents) — every function below that takes a draftId
// re-verifies created_by_user_id === the caller's own userId, the same
// "resolve the real assignment, don't just trust a role string"
// discipline studentService.js uses for tutor/hod/principal, just
// simpler here (a draft has exactly one owner, not a scoped role).
//
// background_jobs.read is Principal-only (middleware/permissions.js) —
// a Class Tutor can never poll GET /background-jobs/:id directly, so
// getDraft below embeds the current extraction job's live status/
// progress/result inline instead of exposing that route to a wider
// audience than it already has.

const { appPool } = require('../db/pool');
const studentAdmissionDraftRepository = require('../repositories/studentAdmissionDraftRepository');
const studentAdmissionDraftDocumentRepository = require('../repositories/studentAdmissionDraftDocumentRepository');
const documentTypeRegistryRepository = require('../repositories/documentTypeRegistryRepository');
const documentService = require('./documentService');
const documentExtractionService = require('./documentExtractionService');
const studentService = require('./studentService');
const identityService = require('./identityService');
const backgroundJobService = require('./backgroundJobService');
const auditLogRepository = require('../repositories/auditLogRepository');

class StudentAdmissionDraftValidationError extends Error {}
class StudentAdmissionDraftNotClassTutorError extends Error {}
class StudentAdmissionDraftNotFoundError extends Error {}
class StudentAdmissionDraftForbiddenError extends Error {}
class StudentAdmissionDraftUnknownDocTypeError extends Error {}

async function assertOwnsDraft(client, draftId, userId) {
  const draft = await studentAdmissionDraftRepository.findById(client, draftId);
  if (draft === null) {
    throw new StudentAdmissionDraftNotFoundError(`no draft found with id ${JSON.stringify(draftId)}`);
  }
  if (draft.created_by_user_id !== userId) {
    throw new StudentAdmissionDraftForbiddenError(
      `user ${JSON.stringify(userId)} does not own draft ${JSON.stringify(draftId)}`,
    );
  }
  return draft;
}

// Same tutor-own-class resolution createStudent uses — a draft is
// scoped to the Class Tutor's own class from the moment it's created,
// same reason class_id is never trusted from client input there either.
//
// 4-login authorization architecture (2026-08-09): actorRole must be
// the CURRENT LOGIN's identity ('class_tutor') — a personal Staff
// login must not reach this even if that person occupies the L4 seat.
async function createDraft(client, { collegeId, userId, actorRole }) {
  if (actorRole !== 'class_tutor') {
    throw new StudentAdmissionDraftNotClassTutorError(
      `user ${JSON.stringify(userId)}'s current login (role ${JSON.stringify(actorRole)}) is not a Class Tutor Position Account`,
    );
  }
  const tutorClassId = await identityService.resolveActiveClassTutorPosition(client, { userId, collegeId });
  if (tutorClassId === null) {
    throw new StudentAdmissionDraftNotClassTutorError(`user ${JSON.stringify(userId)} is not the tutor of any class`);
  }
  return studentAdmissionDraftRepository.create(client, {
    collegeId,
    createdByUserId: userId,
    classId: tutorClassId,
  });
}

async function listMyDrafts(client, { userId }) {
  return studentAdmissionDraftRepository.findInProgressByCreator(client, userId);
}

// Embeds the latest extraction job's live status, so the frontend can
// poll this ONE endpoint (not the Principal-only /background-jobs/:id)
// during "Extracting Details with AI." "Latest" = the most recent
// extraction_job_id among this draft's own documents — every document
// processed by the same extraction run shares that same job id.
async function getDraft(client, draftId, { userId }) {
  const draft = await assertOwnsDraft(client, draftId, userId);
  const documents = await studentAdmissionDraftDocumentRepository.findByDraftId(client, draftId);

  const latestJobId = documents
    .filter((d) => d.extraction_job_id)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
  const extractionJob = latestJobId ? await backgroundJobService.find(client, latestJobId.extraction_job_id) : null;

  return { draft, documents, extractionJob };
}

async function updateDraft(client, draftId, fields, { userId }) {
  await assertOwnsDraft(client, draftId, userId);
  return studentAdmissionDraftRepository.update(client, draftId, fields);
}

// Upload/replace one card's file. Aadhaar/student_photo/fee_receipt
// (ocr_enabled: false in the registry) are stored but never classified
// — classifyDocument is only called for registry rows with
// ocr_enabled: true, same gate extractFields itself independently
// re-checks (CLAUDE.md rule 8 belt-and-suspenders for aadhaar
// specifically).
async function uploadDraftDocument(client, draftId, { docType, fileName, mimeType, fileBuffer }, { userId }) {
  const draft = await assertOwnsDraft(client, draftId, userId);
  if (!docType || !fileName || !mimeType || !fileBuffer) {
    throw new StudentAdmissionDraftValidationError('docType, fileName, mimeType, and fileBuffer are required');
  }

  const registryRow = await documentTypeRegistryRepository.findByKey(client, docType);
  if (registryRow === null) {
    throw new StudentAdmissionDraftUnknownDocTypeError(
      `no document_type_registry row for key ${JSON.stringify(docType)}`,
    );
  }

  const existing = await studentAdmissionDraftDocumentRepository.findByDraftIdAndDocType(client, draftId, docType);
  const oldStoragePath = existing ? existing.storage_path : null;

  const stored = await documentService.storeDraftAdmissionDocument({
    collegeId: draft.college_id,
    draftId,
    docType,
    fileName,
    mimeType,
    fileBuffer,
  });

  const row = existing
    ? await studentAdmissionDraftDocumentRepository.updateFile(client, existing.id, stored)
    : await studentAdmissionDraftDocumentRepository.create(client, {
        collegeId: draft.college_id,
        draftId,
        docType,
        ...stored,
      });

  // Old bytes are discarded only after the new row/file are both safely
  // in place — never the reverse, which could lose the only copy on a
  // mid-request failure.
  if (oldStoragePath) {
    await documentService.discardDraftAdmissionDocument(oldStoragePath);
  }

  if (!registryRow.ocr_enabled) {
    return { document: row, classification: null };
  }

  const classification = await documentExtractionService.classifyDocument(client, {
    collegeId: draft.college_id,
    fileBuffer,
    mimeType,
  });
  const classified = await studentAdmissionDraftDocumentRepository.updateClassification(client, row.id, classification);

  return { document: classified, classification };
}

async function removeDraftDocument(client, draftId, docType, { userId }) {
  await assertOwnsDraft(client, draftId, userId);
  const existing = await studentAdmissionDraftDocumentRepository.findByDraftIdAndDocType(client, draftId, docType);
  if (existing === null) {
    return null;
  }
  await documentService.discardDraftAdmissionDocument(existing.storage_path);
  return studentAdmissionDraftDocumentRepository.deleteById(client, existing.id);
}

// The background job's own handler — runs OCR+extraction for every
// uploaded, ocr_enabled document in the draft, merges fields across
// them, auto-fills the draft's own profile columns with every
// NON-conflicting accepted value (a conflicting field is left alone —
// the AI Review Panel resolves those, never an automatic guess), and
// returns { fields, conflicts, summary } as job.result for the
// Extraction Summary/Review Panel to render.
//
// getJobId is a thunk, not a plain id: buildExtractionHandler's caller
// (runExtraction) has to pass this handler INTO backgroundJobService.
// enqueue() before enqueue's own INSERT produces a real job id — the
// handler only actually RUNS later (setImmediate), by which point
// enqueue has already returned and the caller has the real id, so a
// closure over a variable the caller assigns right after enqueue
// resolves is what lets the handler see it without a circular
// dependency. Every extraction_status write below reuses that SAME id,
// never null — clobbering it back to null here was this function's own
// bug, caught by a live end-to-end smoke test: getDraft's "latest job"
// lookup depends on this column actually holding the real id.
function buildExtractionHandler(collegeId, draftId, getJobId) {
  return async ({ reportProgress }) => {
    const client = await appPool.connect();
    let documents;
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
      const allDocuments = await studentAdmissionDraftDocumentRepository.findByDraftId(client, draftId);
      const registryRows = await documentTypeRegistryRepository.findByModule(client, 'student_admission');
      const ocrEnabledKeys = new Set(registryRows.filter((r) => r.ocr_enabled).map((r) => r.key));
      documents = allDocuments.filter((d) => ocrEnabledKeys.has(d.doc_type) && d.storage_path);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    const perDocumentResults = [];
    let processed = 0;
    for (const doc of documents) {
      // eslint-disable-next-line no-await-in-loop
      const buffer = await documentService.readDraftAdmissionDocument(doc.storage_path);
      const stepClient = await appPool.connect();
      try {
        // eslint-disable-next-line no-await-in-loop
        await stepClient.query('BEGIN');
        // eslint-disable-next-line no-await-in-loop
        await stepClient.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
        // eslint-disable-next-line no-await-in-loop
        const lang = await documentExtractionService.resolveOcrLang(stepClient, collegeId);
        // eslint-disable-next-line no-await-in-loop
        const ocrResult = await documentExtractionService.runOcr(buffer, doc.mime_type, { lang });
        // eslint-disable-next-line no-await-in-loop
        const extraction = await documentExtractionService.extractFields(stepClient, {
          collegeId,
          docType: doc.doc_type,
          text: ocrResult.text,
        });
        // eslint-disable-next-line no-await-in-loop
        await studentAdmissionDraftDocumentRepository.updateExtractionResult(stepClient, doc.id, {
          extractionStatus: 'ocr_completed',
          extractionJobId: getJobId(),
          ocrEngine: ocrResult.ocrEngine,
          ocrEngineVersion: ocrResult.ocrEngineVersion,
          aiModel: extraction.aiModel,
          aiModelVersion: extraction.aiModelVersion,
          promptVersion: extraction.promptVersion,
        });
        // eslint-disable-next-line no-await-in-loop
        await stepClient.query('COMMIT');
        perDocumentResults.push({
          docType: doc.doc_type,
          ocrConfidence: ocrResult.ocrConfidence,
          fields: extraction.fields,
        });
      } catch (err) {
        // eslint-disable-next-line no-await-in-loop
        await stepClient.query('ROLLBACK').catch(() => {});
        const failClient = await appPool.connect();
        try {
          // eslint-disable-next-line no-await-in-loop
          await failClient.query('BEGIN');
          // eslint-disable-next-line no-await-in-loop
          await failClient.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
          // eslint-disable-next-line no-await-in-loop
          await studentAdmissionDraftDocumentRepository.updateExtractionResult(failClient, doc.id, {
            extractionStatus: 'ocr_failed',
            extractionJobId: getJobId(),
            ocrEngine: null,
            ocrEngineVersion: null,
            aiModel: null,
            aiModelVersion: null,
            promptVersion: null,
          });
          // eslint-disable-next-line no-await-in-loop
          await failClient.query('COMMIT');
        } finally {
          failClient.release();
        }
      } finally {
        stepClient.release();
      }

      processed += 1;
      // eslint-disable-next-line no-await-in-loop
      await reportProgress(Math.round((processed / documents.length) * 100));
    }

    const mergedFields = documentExtractionService.mergeFieldsAcrossDocuments(perDocumentResults);
    const nonConflicting = Object.fromEntries(
      Object.entries(mergedFields)
        .filter(([, field]) => !field.conflict)
        .map(([name, field]) => [name, field.value]),
    );

    const finalClient = await appPool.connect();
    try {
      await finalClient.query('BEGIN');
      await finalClient.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
      const currentDraft = await studentAdmissionDraftRepository.findById(finalClient, draftId);
      const checklist = documentExtractionService.buildReviewChecklist(mergedFields, {
        pincode: nonConflicting.pincode || (currentDraft && currentDraft.pincode),
        phone: nonConflicting.phone || (currentDraft && currentDraft.phone),
        bankIfscCode: nonConflicting.bankIfscCode || (currentDraft && currentDraft.bank_ifsc_code),
      });
      if (Object.keys(nonConflicting).length > 0) {
        await studentAdmissionDraftRepository.update(finalClient, draftId, nonConflicting);
      }
      await finalClient.query('COMMIT');

      return {
        fields: mergedFields,
        checklist,
        summary: {
          documentsProcessed: documents.length,
          fieldsExtracted: Object.keys(mergedFields).length,
          fieldsNeedingReview: checklist.length,
        },
      };
    } catch (err) {
      await finalClient.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      finalClient.release();
    }
  };
}

async function runExtraction(client, draftId, { userId }) {
  const draft = await assertOwnsDraft(client, draftId, userId);

  // See buildExtractionHandler's own comment: jobId is assigned right
  // after enqueue() resolves, below — the handler itself only runs
  // later (setImmediate), by which point this closure already has the
  // real value.
  let jobId;
  const job = await backgroundJobService.enqueue(
    client,
    {
      collegeId: draft.college_id,
      name: 'admission_extraction',
      jobType: 'admission_extraction',
      createdByUserId: userId,
    },
    buildExtractionHandler(draft.college_id, draftId, () => jobId),
  );
  jobId = job.id;

  // Every document about to be processed points at this job id right
  // away (extraction_status left as-is — 'uploaded' until the handler
  // itself flips it to 'ocr_completed'/'ocr_failed') so getDraft's own
  // "latest job" lookup finds it immediately, not only once the handler
  // starts writing results.
  const documents = await studentAdmissionDraftDocumentRepository.findByDraftId(client, draftId);
  for (const doc of documents) {
    if (doc.storage_path) {
      // eslint-disable-next-line no-await-in-loop
      await studentAdmissionDraftDocumentRepository.updateExtractionResult(client, doc.id, {
        extractionStatus: doc.extraction_status,
        extractionJobId: job.id,
        ocrEngine: doc.ocr_engine,
        ocrEngineVersion: doc.ocr_engine_version,
        aiModel: doc.ai_model,
        aiModelVersion: doc.ai_model_version,
        promptVersion: doc.prompt_version,
      });
    }
  }

  return job;
}

// Final submit: create the real student (existing, unchanged
// studentService.createStudent, now widened per Phase 1), then promote
// every draft document with an actual file into a REAL `documents` row
// via the existing, unchanged documentService.uploadDocument —
// documents.student_id is correct from that row's very first insert,
// so the "immutable once uploaded" invariant is never touched. Draft
// storage is discarded only after every document has been successfully
// re-persisted as a real document.
async function completeDraft(client, draftId, { userId, actorRole }) {
  const draft = await assertOwnsDraft(client, draftId, userId);
  const documents = await studentAdmissionDraftDocumentRepository.findByDraftId(client, draftId);
  const collegeId = draft.college_id;

  const student = await studentService.createStudent(client, {
    collegeId,
    userId,
    actorRole,
    ...studentAdmissionDraftRepository.toServiceFields(draft),
  });

  let documentsUploaded = 0;
  for (const doc of documents) {
    if (!doc.storage_path) {
      continue; // eslint-disable-line no-continue
    }
    // eslint-disable-next-line no-await-in-loop
    const buffer = await documentService.readDraftAdmissionDocument(doc.storage_path);
    // eslint-disable-next-line no-await-in-loop
    await documentService.uploadDocument(
      client,
      {
        collegeId,
        studentId: student.id,
        docType: doc.doc_type,
        fileName: doc.file_name,
        mimeType: doc.mime_type,
        fileBuffer: buffer,
      },
      { actorUserId: userId },
    );
    documentsUploaded += 1;
  }

  for (const doc of documents) {
    if (doc.storage_path) {
      // eslint-disable-next-line no-await-in-loop
      await documentService.discardDraftAdmissionDocument(doc.storage_path);
    }
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId,
    action: 'student_admission_completed',
    entity: 'students',
    entityId: student.id,
    metadata: { documentsUploaded, draftId },
  });

  await studentAdmissionDraftRepository.updateStatus(client, draftId, 'completed');

  return student;
}

module.exports = {
  StudentAdmissionDraftValidationError,
  StudentAdmissionDraftNotClassTutorError,
  StudentAdmissionDraftNotFoundError,
  StudentAdmissionDraftForbiddenError,
  StudentAdmissionDraftUnknownDocTypeError,
  createDraft,
  listMyDrafts,
  getDraft,
  updateDraft,
  uploadDraftDocument,
  removeDraftDocument,
  runExtraction,
  completeDraft,
};
