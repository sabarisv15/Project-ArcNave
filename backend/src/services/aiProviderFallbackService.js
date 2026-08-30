'use strict';

// CEO Vertex/Gemini audit #40 (2026-08-30) — Cross-Provider Fallback,
// the "urgent, real gap" ADL-066 found with zero mitigation today:
// `aiProviders/retry.js` already retries a transient failure 3x, but
// only ever against the SAME provider — a genuine Vertex outage takes
// every college offline with no other path.
//
// Sits entirely behind configurationService.getAiConfig's own return
// value (RS-AIG-008/Part 5 "must sit behind an ArcNave abstraction
// layer") — buildResilientAdapter returns an object shaped exactly like
// any other provider adapter (aiProviders/index.js's own common
// interface), so EVERY existing caller (aiService.js's askAgent/
// askGeneralChat, documentExtractionService.js, embeddingService.js,
// ...) gets fallback protection automatically, with zero call-site
// changes — none of them know or care that the adapter they were handed
// might silently be two providers wearing one interface.
//
// Deliberately NOT wrapping supportsCapability/getCapabilityProfile —
// see buildResilientAdapter's own comment on why those two must always
// answer for the PRIMARY, never a guess about which provider will end
// up answering a call that hasn't been attempted yet.

const { LlmNotConfiguredError, LlmRequestError } = require('./aiProviders/errors');

// Transient = worth falling back for.
// - LlmRequestError: retry.js's own MAX_ATTEMPTS is already exhausted by
//   the time any caller ever sees one — a real outage/network failure/
//   malformed-response case, exactly what #40 exists to protect against.
// - LlmNotConfiguredError: ALSO transient from a fallback's point of
//   view — a primary provider with missing/invalid/expired credentials
//   should fail over to a working fallback rather than surface a config
//   error to the end user; the fallback's OWN isConfigured() still gates
//   whether it can actually run.
// AiProviderCapabilityError is deliberately NOT here — a model rejecting
// a specific modality (e.g. audio) is a capability mismatch, not an
// outage, and the fallback provider may have the exact same limitation;
// RS-AIG-008 governs provider swaps for reliability, not to paper over a
// genuine capability gap the caller already checked for honestly.
function isFallbackEligible(err) {
  return err instanceof LlmRequestError || err instanceof LlmNotConfiguredError;
}

// Every method aiProviders/index.js's own REQUIRED_METHODS (plus the
// optional countTokens/completeStream) might be called through — a
// method the primary adapter doesn't export (e.g. claude.js has no
// countTokens) is simply never wrapped, so calling it still throws
// exactly the same "not a function" a caller would see without this
// wrapper at all.
const WRAPPABLE_METHODS = [
  'complete', 'completeWithMeta', 'completeStream', 'completeWithTools', 'embed', 'generateImage', 'countTokens',
];

// cfg (the first argument every wrapped method takes) is passed through
// UNCHANGED to the primary call — it's exactly the config object
// configurationService already resolved and handed to the caller, not
// this function's concern. Only on fallback is it swapped for
// fallbackConfig, since the caller never had a config for the fallback
// provider to pass.
function wrapMethod(methodName, primaryAdapter, fallbackAdapter, fallbackConfig, onFallback) {
  const primaryFn = primaryAdapter[methodName];
  if (typeof primaryFn !== 'function') return undefined;
  const fallbackFn = fallbackAdapter[methodName];

  return async (...args) => {
    try {
      return await primaryFn.apply(primaryAdapter, args);
    } catch (err) {
      if (!isFallbackEligible(err) || typeof fallbackFn !== 'function' || !fallbackAdapter.isConfigured(fallbackConfig)) {
        throw err;
      }
      onFallback(methodName, err);
      return fallbackFn.call(fallbackAdapter, fallbackConfig, ...args.slice(1));
    }
  };
}

// onFallback(methodName, err) — called synchronously, exactly once per
// method invocation that actually falls back, BEFORE the fallback call
// is made. Callers (aiService.js) use this to record
// providerFallbackTriggered on the audit row for that turn — see
// buildFallbackTracker below for the exact shape used there.
function buildResilientAdapter(primaryAdapter, fallbackAdapter, fallbackConfig, { onFallback = () => {} } = {}) {
  const wrapped = {
    name: primaryAdapter.name,
    supportsVision: primaryAdapter.supportsVision,
    supportsAudioVideo: primaryAdapter.supportsAudioVideo,
    isConfigured: (cfg) => primaryAdapter.isConfigured(cfg) || fallbackAdapter.isConfigured(fallbackConfig),
  };

  for (const methodName of WRAPPABLE_METHODS) {
    const fn = wrapMethod(methodName, primaryAdapter, fallbackAdapter, fallbackConfig, onFallback);
    if (fn) wrapped[methodName] = fn;
  }

  // supportsCapability/getCapabilityProfile answer for the PRIMARY only,
  // never wrapped: aiService.js's resolveMediaSupport calls these BEFORE
  // any call is attempted, to decide whether to even include an
  // image/media part in the request. Answering for "whichever provider
  // ends up handling this" is not just impossible before the fact, it
  // would be dishonest — the fallback might not support the same
  // modality, and pretending otherwise contradicts every other honest-
  // degradation check this codebase already makes (RS-AIG's own
  // "never guess a capability" rule, restated in RS-AIG-027).
  if (typeof primaryAdapter.supportsCapability === 'function') {
    wrapped.supportsCapability = (cfg, capability) => primaryAdapter.supportsCapability(cfg, capability);
    wrapped.getCapabilityProfile = (cfg) => primaryAdapter.getCapabilityProfile(cfg);
  }

  return wrapped;
}

// A small, mutable object a caller creates once per resolved config and
// reads after the fact — the wrapped adapter's own onFallback closes
// over it. Not a class: this is plain shared state between
// configurationService (which creates it) and aiService.js's
// logLlmCall (which reads it), same "closure-captured mutable record"
// shape aiService.js's own decisionStartedAt/latencyMs pattern already
// uses for per-call bookkeeping.
function buildFallbackTracker() {
  const state = { triggered: false, reason: null, fallbackProvider: null };
  return {
    state,
    onFallback: (methodName, err) => {
      state.triggered = true;
      state.reason = `${methodName}: ${err.message}`;
    },
  };
}

module.exports = { buildResilientAdapter, buildFallbackTracker, isFallbackEligible };
