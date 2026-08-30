'use strict';

// Vertex AI Capability Registry (Phase 8) — the single, server-side
// source of truth for what a specific CONFIGURED Gemini/Vertex model
// actually supports, keyed by the real dimensions that vary it: GCP
// project, Vertex region/location, model id, and (where Google exposes
// one) model version. This replaces scattering model-specific
// conditions across the codebase with one place every consumer queries.
//
// It does NOT replace gemini.js's/vertexMaas.js's own hardcoded
// `supportsVision`/`supportsAudioVideo` module exports — those stay,
// pinned by an existing test (ai-providers.test.js) that reads them as
// plain booleans regardless of any cfg. This registry is additive: both
// adapters also expose `getCapabilityProfile(cfg)`/`supportsCapability(cfg,
// capability)`, which route through here instead.
//
// This registry never queries a live GCP API (IAM permissions, quota,
// Model Garden availability, data-governance policy) — this codebase has
// no real GCP project reachable from this dev environment (gemini.js's
// own header comment already states that caveat for the adapter itself).
// Everything below is a curated table, verified either against Google's
// published Vertex AI/Gemini documentation or this project's own
// LIVE-VERIFIED probes (cited per entry) — never a guessed `true`. A
// model with no curated entry gets the conservative "nothing asserted"
// fallback (unknownModelProfile), and that fallback is logged once per
// lookup miss rather than happening silently — Phase 8's own "do not
// silently downgrade without recording the route used" applies here at
// the registry's own boundary, even though the full request-level
// provenance record is a separate, not-yet-built piece (Phase 8A/8J).
//
// Never trust a capability flag from the frontend: every function here
// takes only a server-resolved adapter cfg (configurationService.
// getAiConfig()'s own return value) or explicit projectId/location/
// modelId/modelVersion — nothing here ever reads req.body/req.query.

const logger = require('../logging/logger');

// Mirrors Phase 8's own suggested VertexCapability union. Kept as a flat
// list (not a TypeScript type — this codebase is plain JS/CommonJS
// throughout) so hasCapability() can validate a caller's capability
// argument against a real, closed set instead of silently returning
// false for a typo'd key.
const VERTEX_CAPABILITIES = [
  'multimodal_text',
  'multimodal_pdf',
  'multimodal_image',
  'multimodal_audio',
  'multimodal_video',
  'gcs_file_uri',
  'thinking_level',
  'thinking_budget',
  'thought_summaries',
  'spatial_grounding',
  'video_timestamps',
  'structured_output',
  'system_instruction',
  'stop_sequences',
  'safety_settings',
  'logprobs',
  'count_tokens',
  'context_caching_implicit',
  'context_caching_explicit',
  'function_calling_single',
  'function_calling_parallel',
  'code_execution',
  'batch_prediction',
  'supervised_fine_tuning',
  'distillation',
];
const VERTEX_CAPABILITY_SET = new Set(VERTEX_CAPABILITIES);

// ---- Curated, model-keyed profiles -------------------------------------
// Each entry is intentionally PARTIAL — a capability absent from the map
// means "not verified", not "confirmed false" as a claim about the
// vendor. hasCapability() below treats absence and explicit `false`
// identically for gating purposes (both mean "do not use it yet"), but
// the comments/notes preserve the distinction for a human reading this
// table or the admin capability endpoint.
const KNOWN_MODEL_PROFILES = {
  // gemini.js's own DEFAULT_MODEL/DEFAULT_LOCATION — the only model this
  // codebase currently has a real, resolvable college_ai_config/global
  // default route to.
  'gemini-3.7-flash': {
    preview: false, // GA-named release per Google's own Flash numbering convention — not independently confirmed via a live Model Garden/IAM call (none reachable from this dev environment)
    verifiedAt: '2026-08-30',
    capabilities: {
      multimodal_text: true,
      multimodal_image: true,
      multimodal_pdf: true,
      // Live-verified 2026-08-30 — scripts/multimodal-audio-video-capability-probe.js: a real synthesized WAV sent as inline_data returned HTTP 200 with a correct content description.
      multimodal_audio: true,
      // UNMEASURED per codec — no ffmpeg was available on the host this was probed from (see bka/70-checkpoint/CURRENT-STATE.md's 2026-08-30 File Intelligence Router banner). Kept `true` to match gemini.js's own supportsAudioVideo posture: that flag gates whether video is even ATTEMPTED, not whether every codec is confirmed — a real per-call rejection still degrades honestly via AiProviderCapabilityError. Do not read this as an independent live verification.
      multimodal_video: true,
      gcs_file_uri: false, // not built — every request today sends inline_data only (Phase 8A note: GCS URI routing is unbuilt)
      thinking_level: true, // gemini.js's GENERATION_CONFIG.thinkingConfig.thinkingLevel — live-verified: LOW accepted, THINKING_LEVEL_MINIMAL rejected with a 400. ADL-067 (2026-08-30): now caller-overridable per turn (generationConfigFor) via ThinkingLevelToggle.jsx/routes/ai.js — MEDIUM/HIGH are Google's documented enum values, not independently re-probed against the live endpoint
      thinking_budget: false, // this model/API surface exposes thinkingLevel, not thinkingBudget — Phase 8B: never assume both apply to the same model
      thought_summaries: true, // ADL-067 (2026-08-30) — gemini.js's generationConfigFor/splitThoughtParts request+parse thought parts when a caller opts in; gated per-college (isThinkingTraceEnabled, 'thinking_trace_visibility' config category, off by default) and never returned to any API response — RS-AIG-027 still bars user-facing exposure
      spatial_grounding: true, // ADL-067 (2026-08-30) — documentExtractionService.extractFieldsWithSpatialGrounding requests a boundingBox per field via structured output (0-1000 normalized coords); backend-only, no route/UI wired yet — the bounding-box overlay is its own product-reasoning item
      video_timestamps: false, // not built (Phase 8C)
      structured_output: true, // ADL-067 (2026-08-30) — completeWithMeta's generationConfigFor sets responseMimeType/responseSchema when a caller (documentExtractionService.js) attaches one; optional, not sent on every call
      system_instruction: true, // systemInstruction sent on every call (completeWithMeta/completeWithTools/attemptStream)
      stop_sequences: false, // not sent by this adapter today
      safety_settings: false, // not sent by this adapter today
      logprobs: true, // ADL-067 (2026-08-30) — gemini.js's generationConfigFor(responseLogprobs/logprobs)/completeWithMeta capture it when a caller sets logprobsTopK; adapter-level only, no internal eval tooling consumes it yet — never a trust signal (CEO audit #39)
      count_tokens: true, // ADL-067 (2026-08-30) — gemini.js's own countTokens() now calls the real :countTokens endpoint; aiService.js's attachment preflight guard is the first caller
      context_caching_implicit: true, // cachedContentTokenCount observed on real responses (ADR-030 P3)
      context_caching_explicit: false, // not built (Phase 8E)
      function_calling_single: true, // completeWithTools — in production use
      // RS-AIG-018/ADR-030 P2(c) cap a turn at ONE tool call at a time by
      // deliberate ARCNAVE product policy (a bounded sequential plan,
      // never simultaneous calls) — this stays false because it has
      // never been probed as a genuine Vertex API ceiling, not because
      // the vendor is known to lack it.
      function_calling_parallel: false,
      code_execution: false, // not built (Phase 8G) — ARCNAVE's own credential-less sandbox (ADL-059) is a structurally different execution path, not this
      batch_prediction: false, // ADL-067 (2026-08-30) — gemini.js's submitBatchPredictionJob/getBatchPredictionJob now exist (real Vertex REST shape, not live-verified), but stay false here on purpose: Vertex Batch Prediction requires a GCS input/output URI and this codebase has no GCS file routing (gcs_file_uri below) — "adapter code exists" is not the same claim as "this capability is usable", which is what this table asserts
      supervised_fine_tuning: false, // not built (Phase 8I)
      distillation: false, // not built (Phase 8I)
    },
    inputLimits: {
      maxContextTokens: undefined, // not independently confirmed against a live Model Garden entry — left unasserted rather than guessed
      maxOutputTokens: 65536, // gemini.js's own MAX_OUTPUT_TOKENS — live-verified as this model's real ceiling (a higher value 400s)
    },
    // Only the one MIME type actually live-verified end to end. Every
    // other type this adapter attempts (image/*, application/pdf,
    // video/*) is real production traffic but not independently
    // confirmed per-MIME-type here — listing them would overstate what
    // was actually checked.
    supportedMimeTypes: ['audio/wav'],
    notes: [
      'multimodal_video is attempted (matches gemini.js supportsAudioVideo) but not independently live-verified per codec — see CURRENT-STATE.md 2026-08-30 banner.',
      'thinking_budget is not exposed by this model/API surface; only thinking_level is real here — do not configure both for this model.',
    ],
  },
};

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes — long enough that a request/turn never rebuilds this object more than once, short enough that a registry-table edit ships within one deploy cycle without depending on a process restart

const cache = new Map();

function cacheKey({
  projectId, location, modelId, modelVersion,
}) {
  return [projectId || '', location || '', modelId || '', modelVersion || ''].join('::');
}

// Conservative fallback for a model with no curated entry — nothing is
// asserted true. A caller (aiService.js's honest-degradation checks, the
// admin capability endpoint) sees every capability as unsupported until
// this table is updated with real, cited data — never a guessed `true`
// for an unrecognized model id.
function unknownModelProfile(modelId) {
  return {
    preview: undefined,
    verifiedAt: null,
    capabilities: {},
    inputLimits: {},
    supportedMimeTypes: [],
    notes: [`No curated capability profile exists for model ${JSON.stringify(modelId)} — every capability check against it returns unsupported until this registry is updated with verified data.`],
  };
}

// Returns a VertexModelCapabilityProfile-shaped object (Phase 8's own
// suggested interface) for the given, server-resolved model identity.
// Cached (ttlMs) so repeated lookups within one request/turn don't
// rebuild the object — the cache holds only this static, non-sensitive
// metadata, never a request's own data (no PII, no credentials).
function getCapabilityProfile({
  projectId, location, modelId, modelVersion, ttlMs = DEFAULT_CACHE_TTL_MS,
} = {}) {
  if (!modelId) {
    throw new TypeError('vertexCapabilityRegistry.getCapabilityProfile requires modelId');
  }
  const key = cacheKey({
    projectId, location, modelId, modelVersion,
  });
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.profile;
  }

  const known = KNOWN_MODEL_PROFILES[modelId];
  if (!known) {
    logger.logWarn('vertex_capability_registry_unknown_model', { modelId, projectId, location });
  }
  const base = known || unknownModelProfile(modelId);
  const profile = {
    provider: 'vertex_ai',
    projectId: projectId || null,
    location: location || null,
    modelId,
    modelVersion: modelVersion || null,
    verifiedAt: base.verifiedAt,
    preview: base.preview,
    capabilities: { ...base.capabilities },
    inputLimits: { ...base.inputLimits },
    supportedMimeTypes: [...(base.supportedMimeTypes || [])],
    notes: [...(base.notes || [])],
  };

  cache.set(key, { profile, expiresAt: Date.now() + ttlMs });
  return profile;
}

// Convenience form for the common case — cfg is exactly what
// configurationService.getAiConfig() already returns as `config`
// (model/location/projectId), so a call site never has to re-map field
// names to this registry's projectId/location/modelId/modelVersion shape.
function getCapabilityProfileForConfig(cfg = {}) {
  return getCapabilityProfile({
    projectId: cfg.projectId,
    location: cfg.location,
    modelId: cfg.model,
    modelVersion: cfg.modelVersion,
  });
}

function hasCapability(cfg, capability) {
  if (!VERTEX_CAPABILITY_SET.has(capability)) {
    throw new TypeError(`vertexCapabilityRegistry.hasCapability: unknown capability ${JSON.stringify(capability)}`);
  }
  return Boolean(getCapabilityProfileForConfig(cfg).capabilities[capability]);
}

// Safe, product-relevant projection for an admin-facing endpoint (Phase
// 8's own "expose only safe capability information" requirement).
// projectId is deliberately omitted, matching routes/aiConfig.js's own
// existing GET response (which already never returns projectId — that's
// server-level ADC config, not a per-college value) — nothing here is a
// secret either way (no credentials, no raw GCS path, no per-request
// user data ever enters this registry), this is just consistency with
// the existing surface.
function toSafeSummary(profile) {
  return {
    provider: profile.provider,
    location: profile.location,
    modelId: profile.modelId,
    modelVersion: profile.modelVersion,
    preview: profile.preview,
    verifiedAt: profile.verifiedAt,
    capabilities: profile.capabilities,
    inputLimits: profile.inputLimits,
    supportedMimeTypes: profile.supportedMimeTypes,
    notes: profile.notes,
  };
}

// Test-only reset — same precedent this codebase already has for other
// module-level caches (e.g. aiService.js's per-role tool-catalogue
// cache) so one test's cached entry can never leak into another.
function _resetCacheForTests() {
  cache.clear();
}

module.exports = {
  VERTEX_CAPABILITIES,
  getCapabilityProfile,
  getCapabilityProfileForConfig,
  hasCapability,
  toSafeSummary,
  _resetCacheForTests,
};
