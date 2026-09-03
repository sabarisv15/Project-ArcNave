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
const vertexCapabilityRegistry = require('../services/vertexCapabilityRegistry');
const aiCostControlService = require('../services/aiCostControlService');
const aiModelVersionService = require('../services/aiModelVersionService');
const aiPromptVersionRegistry = require('../services/aiPromptVersionRegistry');
const config = require('../config');
const { describeFeatureFlags } = require('../featureFlags');

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

  router.get(
    '/ai-config',
    requirePermission('ai_config.read'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { provider, config } = await configurationService.getAiConfig(req.dbClient, req.collegeId);
      res.json({
        provider,
        model: config.model,
        embeddingModel: config.embeddingModel,
        fastModel: config.fastModel,
        baseUrl: config.baseUrl,
        hasApiKey: Boolean(config.apiKey),
      });
    }),
  );

  // Phase 8K-lite: a safe, read-only capability summary for the
  // college's currently-resolved AI provider/model — never a raw
  // provider error, never a frontend-suppliable flag (this reads only
  // the server-resolved cfg, same as GET /ai-config above). Same
  // permission as the config it describes. Non-Vertex-backed adapters
  // (claude/openai/self_hosted — none export getCapabilityProfile) and
  // an unconfigured/misconfigured cfg both return `available: false`
  // with a plain reason rather than a 500 or a guessed capability set.
  router.get(
    '/ai-config/capabilities',
    requirePermission('ai_config.read'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { provider, adapter, config } = await configurationService.getAiConfig(req.dbClient, req.collegeId);
      if (typeof adapter.getCapabilityProfile !== 'function' || !adapter.isConfigured(config)) {
        res.json({ provider, available: false });
        return;
      }
      const profile = adapter.getCapabilityProfile(config);
      // Nested, never spread: toSafeSummary's own `provider` field means
      // "which vendor surface this model profile describes" (always
      // 'vertex_ai' here) — a different concept from this endpoint's own
      // `provider` (which ARCNAVE adapter — 'gemini'/'vertex_maas' — the
      // college is actually on). Spreading would let the profile's field
      // silently clobber the outer one under the same key name.
      res.json({ provider, available: true, capability: vertexCapabilityRegistry.toSafeSummary(profile) });
    }),
  );

  // CEO Vertex/Gemini audit #40/#41/#42/C20/C21 (2026-08-30) — "make sure
  // it shows in frontend": one read-only summary combining every ops
  // signal this audit's second pass built, all previously invisible
  // anywhere in the app. Same permission/tenant-resolution posture as
  // every other route in this file. Never returns projectId/apiKey,
  // same discipline GET /ai-config and GET /ai-config/capabilities
  // already enforce.
  router.get(
    '/ai-config/ops-status',
    requirePermission('ai_config.read'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { provider, config, fallbackProvider } = await configurationService.getAiConfig(
        req.dbClient,
        req.collegeId,
      );
      const usage = await aiCostControlService.getOpsStatus(req.dbClient, req.collegeId);
      const lastObservedVersion = aiModelVersionService.getLastObservedVersion(req.collegeId, provider, config.model);
      res.json({
        provider,
        model: config.model,
        fallback: {
          configured: Boolean(fallbackProvider),
          provider: fallbackProvider,
        },
        modelVersion: {
          configured: config.model,
          // undefined (not null) when no call has landed since the last
          // process restart — aiModelVersionService.js's own comment on
          // why this is in-memory only, not persisted.
          lastObserved: lastObservedVersion,
        },
        ...usage,
      });
    }),
  );

  // ARCNAVE modernization P2 (PDF 1.14) — read-only view of the
  // process-level AI behaviour-trial registry (src/featureFlags.js).
  // Platform-wide, not per-college: it reports env-driven trials, not a
  // tenant's own config, so it does NOT resolve a tenant. Reuses
  // ai_config.read — same "principal-only, no per-category rule yet"
  // posture as the rest of this file. No secret is exposed; every entry
  // is a non-sensitive behaviour toggle.
  router.get(
    '/ai-config/feature-flags',
    requirePermission('ai_config.read'),
    asyncHandler(async (_req, res) => {
      res.json({ flags: describeFeatureFlags(config) });
    }),
  );

  // ARCNAVE modernization P5 ("prompt and model version registry") —
  // read-only view of aiPromptVersionRegistry.js, same
  // platform-wide/no-tenant-resolution/ai_config.read posture as
  // GET /ai-config/feature-flags immediately above (this reports the
  // process's own prompt-module versions, not a tenant's config).
  router.get(
    '/ai-config/prompt-versions',
    requirePermission('ai_config.read'),
    asyncHandler(async (_req, res) => {
      res.json(aiPromptVersionRegistry.describePromptVersions());
    }),
  );

  router.put(
    '/ai-config',
    requirePermission('ai_config.update'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const {
        provider,
        api_key: apiKey,
        model,
        embedding_model: embeddingModel,
        fast_model: fastModel,
        base_url: baseUrl,
      } = req.body || {};
      try {
        const row = await configurationService.setAiConfig(
          req.dbClient,
          req.collegeId,
          {
            provider,
            apiKey,
            model,
            embeddingModel,
            fastModel,
            baseUrl,
          },
          { userId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.json(row);
      } catch (err) {
        if (mapAiConfigError(err, res)) return;
        throw err;
      }
    }),
  );

  return router;
}

module.exports = createAiConfigRouter;
