'use strict';

// Shared, provider-agnostic error classes every adapter in this folder
// throws — a caller (aiService.js, routes/ai.js) maps these once,
// regardless of which vendor is actually configured for a given
// college. Kept as their original llmProvider.js names
// (LlmNotConfiguredError/LlmRequestError) rather than renamed: every
// existing caller/test already keys off these two class identities,
// and the meaning hasn't changed — only where the check happens has.

// No provider key configured for this college (or the global default,
// when no per-college row exists) — the AI "ask"/embed path is
// unavailable.
class LlmNotConfiguredError extends Error {}

// A configured provider was reached but the call itself failed —
// non-2xx response, a network error, or a response shape this adapter
// doesn't recognize.
class LlmRequestError extends Error {}

// An adapter was asked for a capability it structurally doesn't have
// for this vendor (e.g. Claude has no first-party embeddings
// endpoint) — a real, honest limitation flagged loudly, never a
// silent no-op or a faked response.
class AiProviderCapabilityError extends Error {}

// ConfigurationService/aiProviders.getAdapter was given a provider
// name with no matching adapter file.
class AiProviderUnknownError extends Error {}

module.exports = {
  LlmNotConfiguredError,
  LlmRequestError,
  AiProviderCapabilityError,
  AiProviderUnknownError,
};
