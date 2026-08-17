'use strict';

// Business logic for the generic JSONB configuration store
// (`configurations` table) — the mechanism only, not any category's
// shape. Architecture.md eventually hangs attendance rules, fee
// structure, SMTP/SMS, AI provider config, approval policies,
// branding, and templates off this table, but those categories belong
// to whichever module owns them (Attendance, Finance, Notifications,
// AI, ...), none of which exist yet. This service never validates a
// category's internal JSON shape or maintains a list of known
// category names — same restraint as deferring the AI Tool Registry's
// shape to Module 9 rather than guessing it now.
//
// Checked the deleted Python version (git history) before writing any
// of this, rather than inventing semantics: an unset category is a
// clean 404 at the route layer, never a default empty object or
// category-specific default; the version column implements genuine
// optimistic concurrency (the caller must pass the version they last
// read, 409 on any mismatch), never a blind increment-on-every-write;
// writes are gated to `principal` only, a conservative default the
// Python version's own comment already flagged as not a settled
// decision (see routes/configurations.js).

const configurationRepository = require('../repositories/configurationRepository');
const aiConfigRepository = require('../repositories/aiConfigRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const aiProviders = require('./aiProviders');
const cryptoUtil = require('../cryptoUtil');
const globalConfig = require('../config');

// Optimistic-concurrency conflict — never a silent overwrite. Covers
// three cases the caller doesn't need to distinguish: writing with a
// stale expectedVersion, writing with a non-null/non-zero
// expectedVersion against a category that doesn't exist yet, and the
// genuine race where two callers both see "doesn't exist" and both
// try to create it.
class ConfigurationVersionConflictError extends Error {}

// A category-specific shape check failed (currently only 'storage',
// see routes/configurations.js's own assertValidStorageConfiguration) —
// raised by the route, not this generic service (this file never
// validates a category's internal shape, per its own header comment),
// but declared here so every configuration-related error a route can
// throw lives in one place.
class ConfigurationCategoryValidationError extends Error {}

// null means the category has simply never been configured for this
// tenant — not an error. The route turns that into 404.
async function getConfiguration(client, { collegeId, category }) {
  return configurationRepository.getConfiguration(client, { collegeId, category });
}

async function setConfiguration(client, { collegeId, category, configuration, expectedVersion, userId }) {
  // A pre-read, same as the Python version's — not what actually
  // enforces the concurrency (upsertConfiguration's own WHERE clause
  // does that atomically regardless of what happens here), but needed
  // for two things: rejecting a nonsensical expectedVersion against a
  // category that doesn't exist yet with a clear, specific error
  // (rather than silently creating it and ignoring what the caller
  // claimed to expect), and giving the audit log a real oldVersion.
  const existing = await configurationRepository.getConfiguration(client, { collegeId, category });

  if (existing === null && expectedVersion !== null && expectedVersion !== 0) {
    throw new ConfigurationVersionConflictError(
      `category ${JSON.stringify(category)} does not exist yet; expectedVersion must be null or 0`,
    );
  }

  const row = await configurationRepository.upsertConfiguration(client, {
    collegeId,
    category,
    configuration,
    expectedVersion: existing === null ? null : expectedVersion,
  });

  if (row === null) {
    throw new ConfigurationVersionConflictError(
      existing === null
        ? `category ${JSON.stringify(category)} was created concurrently`
        : `category ${JSON.stringify(category)} is at version ${existing.version}, not ${expectedVersion}`,
    );
  }

  const oldVersion = existing === null ? null : existing.version;

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId,
    action: 'configuration_updated',
    entity: 'configurations',
    entityId: category,
    metadata: { old_version: oldVersion, new_version: row.version },
  });

  return row;
}

// setAiConfig given no provider, or a provider name aiProviders doesn't
// recognize — raised before any DB write, same "guard before any work"
// convention every other *ValidationError in this codebase follows.
class AiConfigValidationError extends Error {}

// No per-college row is not an error — it means this college hasn't
// opted into its own provider yet, and still gets the same global NIM
// config every college used before college_ai_config existed. This
// default is deliberately the literal 'nim' + config.nim.* (this
// codebase's own pre-existing global behavior), never silently
// changed, so a college with no row sees zero behavior change from
// before this table existed.
const DEFAULT_AI_PROVIDER = 'nim';

function globalNimConfig() {
  return {
    apiKey: globalConfig.nim.apiKey,
    baseUrl: globalConfig.nim.baseUrl,
    model: globalConfig.nim.model,
    embeddingModel: globalConfig.nim.embeddingModel,
  };
}

// Returns { provider, config, adapter } — config is plain, decrypted
// (apiKey already usable), never a caller's concern to decrypt itself.
// adapter is the real module from aiProviders/ (nim.js/gemini.js/
// claude.js/selfHosted.js), already resolved so callers never branch
// on provider name themselves.
async function getAiConfig(client, collegeId) {
  const row = await aiConfigRepository.findByCollegeId(client, collegeId);

  if (row === null) {
    return { provider: DEFAULT_AI_PROVIDER, config: globalNimConfig(), adapter: aiProviders.getAdapter(DEFAULT_AI_PROVIDER) };
  }

  const config = {
    apiKey: row.api_key ? cryptoUtil.decryptSecret(row.api_key) : null,
    baseUrl: row.base_url,
    model: row.model,
    embeddingModel: row.embedding_model,
  };
  return { provider: row.provider, config, adapter: aiProviders.getAdapter(row.provider) };
}

// api_key is encrypted here, immediately, before ever reaching the
// repository/DB (cryptoUtil.encryptSecret) — the only place in this
// service that ever sees the plaintext key is this function's own
// argument. The return value never includes api_key or its ciphertext
// in any form, only hasApiKey (a boolean) — a caller (the route) has
// no raw key to accidentally leak in a response or a log line.
async function setAiConfig(client, collegeId, {
  provider, apiKey, model, embeddingModel, baseUrl,
}, { userId } = {}) {
  if (!provider) {
    throw new AiConfigValidationError('provider is required');
  }
  // Validates the provider name up front (throws AiProviderUnknownError
  // otherwise) — a typo'd provider must never be silently persisted
  // only to fail later, at the next actual AI call.
  aiProviders.getAdapter(provider);

  const row = await aiConfigRepository.upsert(client, {
    collegeId,
    provider,
    apiKey: apiKey ? cryptoUtil.encryptSecret(apiKey) : null,
    model: model || null,
    embeddingModel: embeddingModel || null,
    baseUrl: baseUrl || null,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId,
    action: 'ai_config_updated',
    entity: 'college_ai_config',
    entityId: row.id,
    // Never api_key/ciphertext in metadata — only which provider/model
    // changed, same "record the fact, not the secret" restraint
    // security.js's own password/token handling already follows.
    metadata: { provider: row.provider, model: row.model, embeddingModel: row.embedding_model },
  });

  return {
    id: row.id,
    collegeId: row.college_id,
    provider: row.provider,
    model: row.model,
    embeddingModel: row.embedding_model,
    baseUrl: row.base_url,
    hasApiKey: Boolean(row.api_key),
    updatedAt: row.updated_at,
  };
}

module.exports = {
  ConfigurationVersionConflictError,
  ConfigurationCategoryValidationError,
  AiConfigValidationError,
  getConfiguration,
  setConfiguration,
  getAiConfig,
  setAiConfig,
};
