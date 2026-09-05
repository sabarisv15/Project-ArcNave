'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/rbac');
const projectService = require('../services/projectService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function mapProjectServiceError(err, res) {
  if (err instanceof projectService.ProjectValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof projectService.ProjectNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof projectService.ProjectForbiddenError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof projectService.ProjectDocumentAlreadyAttachedError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  return false;
}

// requireAuth only — a project has no role-based access rule, only
// "must be the owner," which projectService enforces itself. Same
// shape as routes/personalNotes.js.
const projectIdParams = z.object({ id: z.string() });
const projectDocumentParams = z.object({ id: z.string(), documentId: z.string() });
const createProjectSchema = z.object({ body: z.object({ name: z.string().optional() }).optional() });
const updateProjectSchema = z.object({
  params: projectIdParams,
  body: z
    .object({
      name: z.string().optional(),
      instructions: z.string().optional(),
      pinned: z.any().optional(),
    })
    .optional(),
});
const deleteProjectSchema = z.object({ params: projectIdParams });
const listProjectDocumentsSchema = z.object({ params: projectIdParams });
const attachProjectDocumentSchema = z.object({
  params: projectIdParams,
  body: z.object({ document_id: z.string().optional() }).optional(),
});
const detachProjectDocumentSchema = z.object({ params: projectDocumentParams });

function createProjectsRouter() {
  const router = express.Router();

  router.get(
    '/projects',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const projects = await projectService.listOwnProjects(req.dbClient, {
        userId: identityService.resolveActorUserId(req.capabilities),
      });
      res.json(projects);
    }),
  );

  router.post(
    '/projects',
    requireAuth,
    validate(createProjectSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { name } = req.body || {};
      try {
        const project = await projectService.createProject(
          req.dbClient,
          { name },
          { userId: identityService.resolveActorUserId(req.capabilities), collegeId: req.collegeId },
        );
        res.status(201).json(project);
      } catch (err) {
        if (mapProjectServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.put(
    '/projects/:id',
    requireAuth,
    validate(updateProjectSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { name, instructions, pinned } = req.body || {};
      try {
        const project = await projectService.updateProject(
          req.dbClient,
          req.params.id,
          { name, instructions, pinned },
          { userId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.json(project);
      } catch (err) {
        if (mapProjectServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.delete(
    '/projects/:id',
    requireAuth,
    validate(deleteProjectSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        await projectService.deleteProject(req.dbClient, req.params.id, {
          userId: identityService.resolveActorUserId(req.capabilities),
        });
        res.status(204).end();
      } catch (err) {
        if (mapProjectServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // Reference-only document context (Approved Spec §12) — never a new
  // upload path (CLAUDE.md rule 2 / ADR-009 Amendment 1), only a link
  // to a document the user already owns.
  router.get(
    '/projects/:id/documents',
    requireAuth,
    validate(listProjectDocumentsSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const documents = await projectService.listProjectDocuments(req.dbClient, req.params.id, {
          userId: identityService.resolveActorUserId(req.capabilities),
        });
        res.json(documents);
      } catch (err) {
        if (mapProjectServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/projects/:id/documents',
    requireAuth,
    validate(attachProjectDocumentSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { document_id: documentId } = req.body || {};
      try {
        const link = await projectService.attachProjectDocument(
          req.dbClient,
          req.params.id,
          { documentId },
          { userId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.status(201).json(link);
      } catch (err) {
        if (mapProjectServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.delete(
    '/projects/:id/documents/:documentId',
    requireAuth,
    validate(detachProjectDocumentSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        await projectService.detachProjectDocument(req.dbClient, req.params.id, req.params.documentId, {
          userId: identityService.resolveActorUserId(req.capabilities),
        });
        res.status(204).end();
      } catch (err) {
        if (mapProjectServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  return router;
}

module.exports = createProjectsRouter;
module.exports.schemas = {
  '/projects': { post: createProjectSchema },
  '/projects/{id}': { put: updateProjectSchema, delete: deleteProjectSchema },
  '/projects/{id}/documents': { get: listProjectDocumentsSchema, post: attachProjectDocumentSchema },
  '/projects/{id}/documents/{documentId}': { delete: detachProjectDocumentSchema },
};
