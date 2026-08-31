'use strict';

const express = require('express');
const multer = require('multer');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const studentAdmissionDraftService = require('../services/studentAdmissionDraftService');
const studentService = require('../services/studentService');
const identityService = require('../services/identityService');

// Same 15mb ceiling routes/documents.js's own base64 upload route
// already uses for a document file — multipart sidesteps Express's
// separate express.json() 100kb default entirely (a different body
// parser), so this is the real, only limit for this route.
const upload = multer({ limits: { fileSize: 15 * 1024 * 1024 } });

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function mapDraftServiceError(err, res) {
  if (err instanceof studentAdmissionDraftService.StudentAdmissionDraftValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentAdmissionDraftService.StudentAdmissionDraftUnknownDocTypeError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentAdmissionDraftService.StudentAdmissionDraftNotClassTutorError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentAdmissionDraftService.StudentAdmissionDraftForbiddenError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentAdmissionDraftService.StudentAdmissionDraftNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  return false;
}

// Every route here also maps studentService.createStudent's own errors
// (completeDraft's terminal step) — reusing that mapping would require
// importing routes/students.js's private helper, so this is a small,
// deliberate duplication rather than reaching into another route file's
// internals (same "each router owns its own error mapping" convention
// this codebase already follows, e.g. curriculum.js/students.js don't
// share one either despite both touching students).
function mapStudentServiceError(err, res) {
  if (err instanceof studentService.StudentValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentRollNoConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentClassNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentNotClassTutorError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentClassMismatchError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  return false;
}

// requirePermission('students.create') for creation only (same gate
// POST /students already uses — ['staff']); every other route here is
// requireAuth + the service's own ownership check
// (studentAdmissionDraftService.assertOwnsDraft), same "reads/updates on
// an already-scoped resource don't need a second role gate" shape
// GET/PUT /students/:id already uses.
function createAdmissionDraftsRouter() {
  const router = express.Router();

  router.post(
    '/students/admission-drafts',
    requirePermission('students.create'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const draft = await studentAdmissionDraftService.createDraft(req.dbClient, {
          collegeId: req.collegeId,
          userId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
        });
        res.status(201).json(draft);
      } catch (err) {
        if (mapDraftServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/students/admission-drafts',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const drafts = await studentAdmissionDraftService.listMyDrafts(req.dbClient, {
        userId: identityService.resolveActorUserId(req.capabilities),
      });
      res.json(drafts);
    }),
  );

  router.get(
    '/students/admission-drafts/:draftId',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const state = await studentAdmissionDraftService.getDraft(req.dbClient, req.params.draftId, {
          userId: identityService.resolveActorUserId(req.capabilities),
        });
        res.json(state);
      } catch (err) {
        if (mapDraftServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.patch(
    '/students/admission-drafts/:draftId',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const draft = await studentAdmissionDraftService.updateDraft(req.dbClient, req.params.draftId, req.body || {}, {
          userId: identityService.resolveActorUserId(req.capabilities),
        });
        res.json(draft);
      } catch (err) {
        if (mapDraftServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/students/admission-drafts/:draftId/documents',
    requireAuth,
    upload.single('file'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      if (!req.file) {
        res.status(400).json({ detail: 'file is required' });
        return;
      }
      try {
        const result = await studentAdmissionDraftService.uploadDraftDocument(
          req.dbClient,
          req.params.draftId,
          {
            docType: (req.body || {}).docType,
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
            fileBuffer: req.file.buffer,
          },
          { userId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.status(201).json(result);
      } catch (err) {
        if (mapDraftServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.delete(
    '/students/admission-drafts/:draftId/documents/:docType',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        await studentAdmissionDraftService.removeDraftDocument(req.dbClient, req.params.draftId, req.params.docType, {
          userId: identityService.resolveActorUserId(req.capabilities),
        });
        res.status(204).end();
      } catch (err) {
        if (mapDraftServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/students/admission-drafts/:draftId/extract',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const job = await studentAdmissionDraftService.runExtraction(req.dbClient, req.params.draftId, {
          userId: identityService.resolveActorUserId(req.capabilities),
        });
        res.status(202).json(job);
      } catch (err) {
        if (mapDraftServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/students/admission-drafts/:draftId/complete',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const student = await studentAdmissionDraftService.completeDraft(req.dbClient, req.params.draftId, {
          userId: identityService.resolveActorUserId(req.capabilities),
          actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
        });
        res.status(201).json(student);
      } catch (err) {
        if (mapDraftServiceError(err, res)) return;
        if (mapStudentServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  return router;
}

module.exports = createAdmissionDraftsRouter;
