'use strict';

// The one registry of known AI provider adapters. Every adapter here
// implements the same interface — isConfigured(cfg), complete(cfg,
// {systemPrompt, userPrompt}), completeWithTools(cfg, {systemPrompt,
// userPrompt, tools}), embed(cfg, texts, {inputType}) — so
// ConfigurationService/aiService/documentSearchService never need to
// branch on which vendor a college picked; they call whatever
// getAdapter(provider) returns. No vendor-specific request/response
// shape lives outside this folder (CLAUDE.md-style single-owner
// convention, same as fileStorage.js owning file storage).

const gemini = require('./gemini');
const claude = require('./claude');
const selfHosted = require('./selfHosted');
const openai = require('./openai');
const vertexMaas = require('./vertexMaas');
const errors = require('./errors');

const ADAPTERS = {
  gemini,
  claude,
  self_hosted: selfHosted,
  openai,
  vertex_maas: vertexMaas,
};

function getAdapter(provider) {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new errors.AiProviderUnknownError(`unknown AI provider ${JSON.stringify(provider)}`);
  }
  return adapter;
}

module.exports = {
  ADAPTERS,
  KNOWN_PROVIDERS: Object.keys(ADAPTERS),
  getAdapter,
  ...errors,
};
