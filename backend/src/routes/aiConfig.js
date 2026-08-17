'use strict';

// Per-college AI provider config — principal-only, same conservative
// default routes/configurations.js's own PUT already uses (a real
// per-category authorization rule doesn't exist yet for this either).
// GET never returns api_key or its ciphertext, ever — only hasApiKey
// (a boolean) — same discipline configurationService.setAiConfig's own
// return value already enforces for PUT's response.

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission } = require('../middleware/rbac');
const configurationService = require('../services/configurationService');
const aiProviders = require('../services/aiProviders');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function mapAiConfigError(err, res) {
  if (err instanceof configurationService.AiConfigValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof aiProviders.AiProviderUnknownError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  return false;
}

function createAiConfigRouter() {
  const router = express.Router();

  router.get('/ai-config', requirePermission('ai_config.read'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { provider, config } = await configurationService.getAiConfig(req.dbClient, req.collegeId);
    res.json({
      provider,
      model: config.model,
      embeddingModel: config.embeddingModel,
      baseUrl: config.baseUrl,
      hasApiKey: Boolean(config.apiKey),
    });
  }));

  router.put('/ai-config', requirePermission('ai_config.update'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const {
      provider, api_key: apiKey, model, embedding_model: embeddingModel, base_url: baseUrl,
    } = req.body || {};
    try {
      const row = await configurationService.setAiConfig(req.dbClient, req.collegeId, {
        provider, apiKey, model, embeddingModel, baseUrl,
      }, { userId: identityService.resolveActorUserId(req.capabilities) });
      res.json(row);
    } catch (err) {
      if (mapAiConfigError(err, res)) return;
      throw err;
    }
  }));

  return router;
}

module.exports = createAiConfigRouter;
