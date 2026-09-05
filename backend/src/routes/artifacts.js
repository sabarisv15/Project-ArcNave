'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/rbac');
const artifactService = require('../services/artifactService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function mapArtifactServiceError(err, res) {
  if (err instanceof artifactService.ArtifactValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof artifactService.ArtifactNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof artifactService.ArtifactForbiddenError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof artifactService.ArtifactAlreadyPublishedError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  return false;
}

const artifactIdParams = z.object({ id: z.string() });
const listArtifactsSchema = z.object({
  query: z.object({ limit: z.string().optional(), offset: z.string().optional() }).optional(),
});
const getArtifactSchema = z.object({ params: artifactIdParams });
const listArtifactVersionsSchema = z.object({ params: artifactIdParams });
const createArtifactSchema = z.object({
  body: z
    .object({
      title: z.string().optional(),
      content: z.any().optional(),
      conversation_id: z.string().optional(),
      source_message_id: z.string().optional(),
      artifact_type: z.string().optional(),
    })
    .optional(),
});
const updateArtifactSchema = z.object({
  params: artifactIdParams,
  body: z
    .object({
      title: z.string().optional(),
      content: z.any().optional(),
      conversation_id: z.string().optional(),
    })
    .optional(),
});
const deleteArtifactSchema = z.object({ params: artifactIdParams });
const publishArtifactSchema = z.object({
  params: artifactIdParams,
  body: z.object({ format: z.string().optional() }).optional(),
});
const exportArtifactSchema = z.object({
  params: artifactIdParams,
  body: z.object({ format: z.string().optional() }).optional(),
});

// requireAuth only — same self-owned-resource shape as
// routes/personalNotes.js/routes/projects.js/routes/conversations.js.
function createArtifactsRouter() {
  const router = express.Router();

  router.get(
    '/artifacts',
    requireAuth,
    validate(listArtifactsSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { limit, offset } = req.query || {};
      const artifacts = await artifactService.listOwnArtifacts(req.dbClient, {
        userId: identityService.resolveActorUserId(req.capabilities),
        limit: limit !== undefined ? Number(limit) : undefined,
        offset: offset !== undefined ? Number(offset) : undefined,
      });
      res.json(artifacts);
    }),
  );

  router.get(
    '/artifacts/:id',
    requireAuth,
    validate(getArtifactSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const artifact = await artifactService.getOwnArtifact(req.dbClient, req.params.id, {
          userId: identityService.resolveActorUserId(req.capabilities),
        });
        res.json(artifact);
      } catch (err) {
        if (mapArtifactServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.get(
    '/artifacts/:id/versions',
    requireAuth,
    validate(listArtifactVersionsSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        const versions = await artifactService.listOwnArtifactVersions(req.dbClient, req.params.id, {
          userId: identityService.resolveActorUserId(req.capabilities),
        });
        res.json(versions);
      } catch (err) {
        if (mapArtifactServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/artifacts',
    requireAuth,
    validate(createArtifactSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const {
        title,
        content,
        conversation_id: conversationId,
        source_message_id: sourceMessageId,
        artifact_type: artifactType,
      } = req.body || {};
      try {
        const artifact = await artifactService.createArtifact(
          req.dbClient,
          {
            title,
            content,
            conversationId,
            sourceMessageId,
            artifactType,
          },
          { userId: identityService.resolveActorUserId(req.capabilities), collegeId: req.collegeId },
        );
        res.status(201).json(artifact);
      } catch (err) {
        if (mapArtifactServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.put(
    '/artifacts/:id',
    requireAuth,
    validate(updateArtifactSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { title, content, conversation_id: conversationId } = req.body || {};
      try {
        const artifact = await artifactService.updateArtifact(
          req.dbClient,
          req.params.id,
          { title, content, conversationId },
          { userId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.json(artifact);
      } catch (err) {
        if (mapArtifactServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.delete(
    '/artifacts/:id',
    requireAuth,
    validate(deleteArtifactSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        await artifactService.deleteArtifact(req.dbClient, req.params.id, {
          userId: identityService.resolveActorUserId(req.capabilities),
        });
        res.status(204).end();
      } catch (err) {
        if (mapArtifactServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/artifacts/:id/publish',
    requireAuth,
    validate(publishArtifactSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { format } = req.body || {};
      try {
        const artifact = await artifactService.publishArtifact(req.dbClient, req.params.id, {
          userId: identityService.resolveActorUserId(req.capabilities),
          collegeId: req.collegeId,
          format,
        });
        res.json(artifact);
      } catch (err) {
        if (mapArtifactServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  // The retroactive "give me this as docx too" action — mirrors
  // /publish's shape (same response shape, a document reference) but
  // never touches the artifact's own status/publishedDocumentId, and
  // works on a draft artifact too. See artifactService.exportArtifactAs.
  router.post(
    '/artifacts/:id/export',
    requireAuth,
    validate(exportArtifactSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { format } = req.body || {};
      try {
        const document = await artifactService.exportArtifactAs(req.dbClient, req.params.id, format, {
          userId: identityService.resolveActorUserId(req.capabilities),
          collegeId: req.collegeId,
        });
        res.status(201).json(document);
      } catch (err) {
        if (mapArtifactServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  return router;
}

module.exports = createArtifactsRouter;
module.exports.schemas = {
  '/artifacts': { get: listArtifactsSchema, post: createArtifactSchema },
  '/artifacts/{id}': { get: getArtifactSchema, put: updateArtifactSchema, delete: deleteArtifactSchema },
  '/artifacts/{id}/versions': { get: listArtifactVersionsSchema },
  '/artifacts/{id}/publish': { post: publishArtifactSchema },
  '/artifacts/{id}/export': { post: exportArtifactSchema },
};
