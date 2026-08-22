'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/rbac');
const conversationService = require('../services/conversationService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function mapConversationServiceError(err, res) {
  if (err instanceof conversationService.ConversationValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof conversationService.ConversationNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof conversationService.ConversationForbiddenError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  return false;
}

// requireAuth only — same self-owned-resource shape as
// routes/personalNotes.js/routes/projects.js. Every route implicitly
// scopes to identityService.resolveActorUserId(req.capabilities);
// nothing here ever accepts a userId from the request.
function createConversationsRouter() {
  const router = express.Router();

  router.get('/conversations', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const {
      project_id: projectId, search, archived, limit, offset,
    } = req.query || {};
    const conversations = await conversationService.listOwnConversations(req.dbClient, {
      userId: identityService.resolveActorUserId(req.capabilities),
      projectId,
      search,
      archived: archived !== undefined ? archived === 'true' : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
    });
    res.json(conversations);
  }));

  router.post('/conversations', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { title, project_id: projectId } = req.body || {};
    const conversation = await conversationService.createConversation(
      req.dbClient,
      { title, projectId },
      { userId: identityService.resolveActorUserId(req.capabilities), collegeId: req.collegeId },
    );
    res.status(201).json(conversation);
  }));

  router.put('/conversations/:id', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const {
      title, project_id: projectId, pinned, archived,
    } = req.body || {};
    try {
      const conversation = await conversationService.updateConversation(
        req.dbClient,
        req.params.id,
        {
          title, projectId, pinned, archived,
        },
        { userId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.json(conversation);
    } catch (err) {
      if (mapConversationServiceError(err, res)) return;
      throw err;
    }
  }));

  router.delete('/conversations/:id', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      await conversationService.deleteConversation(req.dbClient, req.params.id, { userId: identityService.resolveActorUserId(req.capabilities) });
      res.status(204).end();
    } catch (err) {
      if (mapConversationServiceError(err, res)) return;
      throw err;
    }
  }));

  router.get('/conversations/:id/messages', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { limit, offset } = req.query || {};
    try {
      const messages = await conversationService.listMessages(
        req.dbClient,
        req.params.id,
        {
          userId: identityService.resolveActorUserId(req.capabilities),
          limit: limit !== undefined ? Number(limit) : undefined,
          offset: offset !== undefined ? Number(offset) : undefined,
        },
      );
      res.json(messages);
    } catch (err) {
      if (mapConversationServiceError(err, res)) return;
      throw err;
    }
  }));

  router.post('/conversations/:id/messages', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const {
      role, content, tool_used: toolUsed, tool_params: toolParams,
      presentation, raw_data: rawData, parent_message_id: parentMessageId,
      attachments, input_tokens: inputTokens, output_tokens: outputTokens,
    } = req.body || {};
    try {
      const message = await conversationService.addMessage(
        req.dbClient,
        req.params.id,
        {
          role, content, toolUsed, toolParams, presentation, rawData, parentMessageId, attachments, inputTokens, outputTokens,
        },
        { userId: identityService.resolveActorUserId(req.capabilities), collegeId: req.collegeId },
      );
      res.status(201).json(message);
    } catch (err) {
      if (mapConversationServiceError(err, res)) return;
      throw err;
    }
  }));

  router.patch('/conversations/:id/messages/:messageId', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { content } = req.body || {};
    try {
      const message = await conversationService.editMessage(
        req.dbClient,
        req.params.id,
        req.params.messageId,
        { content },
        { userId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.json(message);
    } catch (err) {
      if (mapConversationServiceError(err, res)) return;
      throw err;
    }
  }));

  return router;
}

module.exports = createConversationsRouter;
