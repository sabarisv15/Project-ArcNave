'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/rbac');
const examinationService = require('../services/examinationService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function mapExaminationServiceError(err, res) {
  if (err instanceof examinationService.ExaminationValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof examinationService.ExaminationClassNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof examinationService.ExaminationNotTutorError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof examinationService.ExaminationDocumentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof examinationService.ExaminationDocumentClassMismatchError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  return false;
}

const classIdParams = z.object({ id: z.string() });
const uploadExamDocumentSchema = z.object({
  params: classIdParams,
  body: z
    .object({
      doc_type: z.string().optional(),
      file_name: z.string().optional(),
      mime_type: z.string().optional(),
      file_base64: z.string().optional(),
    })
    .optional(),
});
const listExamDocumentsSchema = z.object({ params: classIdParams });
const publishExamTimetableSchema = z.object({
  params: classIdParams,
  body: z.object({ document_id: z.string().optional() }).optional(),
});
const getCurrentExamTimetableSchema = z.object({ params: classIdParams });
const listExamTimetableVersionsSchema = z.object({ params: classIdParams });

function createExaminationRouter() {
  const router = express.Router();

  // requireAuth, not requirePermission: BusinessRules.md names the
  // Class Tutor as the sole actor for this whole section —
  // examinationService.assertIsTutor's own per-row check
  // (ExaminationNotTutorError) is the real gate, same "the service is
  // the gate" reasoning every other Tutor-scoped action in this
  // codebase uses. file_base64, same "no multipart parser exists yet"
  // convention routes/documents.js's own UPLOAD_BODY_FIELDS uses.
  router.post(
    '/classes/:id/examination-documents',
    requireAuth,
    validate(uploadExamDocumentSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { doc_type: docType, file_name: fileName, mime_type: mimeType, file_base64: fileBase64 } = req.body || {};
      if (typeof fileBase64 !== 'string' || fileBase64.length === 0) {
        res.status(400).json({ detail: 'file_base64 is required' });
        return;
      }
      try {
        const document = await examinationService.uploadExamDocument(
          req.dbClient,
          req.params.id,
          {
            docType,
            fileName,
            mimeType,
            fileBuffer: Buffer.from(fileBase64, 'base64'),
          },
          {
            actorUserId: identityService.resolveActorUserId(req.capabilities),
            actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
          },
        );
        res.status(201).json(document);
      } catch (err) {
        if (mapExaminationServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/classes/:id/examination-documents',
    requireAuth,
    validate(listExamDocumentsSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const documents = await examinationService.listExamDocumentsForClass(req.dbClient, req.params.id);
      res.json(documents);
    }),
  );

  router.post(
    '/classes/:id/examination-timetable/publish',
    requireAuth,
    validate(publishExamTimetableSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { document_id: documentId } = req.body || {};
      try {
        const version = await examinationService.publishExamTimetableVersion(req.dbClient, req.params.id, documentId, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
        });
        res.status(201).json(version);
      } catch (err) {
        if (mapExaminationServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/classes/:id/examination-timetable/current',
    requireAuth,
    validate(getCurrentExamTimetableSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const version = await examinationService.getCurrentOfficialTimetable(req.dbClient, req.params.id);
      if (version === null) {
        res
          .status(404)
          .json({ detail: `No current official examination timetable for class ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.json(version);
    }),
  );

  router.get(
    '/classes/:id/examination-timetable/versions',
    requireAuth,
    validate(listExamTimetableVersionsSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const versions = await examinationService.listExamTimetableVersions(req.dbClient, req.params.id);
      res.json(versions);
    }),
  );

  return router;
}

module.exports = createExaminationRouter;
module.exports.schemas = {
  '/classes/{id}/examination-documents': { post: uploadExamDocumentSchema, get: listExamDocumentsSchema },
  '/classes/{id}/examination-timetable/publish': { post: publishExamTimetableSchema },
  '/classes/{id}/examination-timetable/current': { get: getCurrentExamTimetableSchema },
  '/classes/{id}/examination-timetable/versions': { get: listExamTimetableVersionsSchema },
};
