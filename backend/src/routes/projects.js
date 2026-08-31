'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
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
