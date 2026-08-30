'use strict';

// ADR-030 P2(a) — the ARCNAVE Context representation: an ordered list of
// segments, each carrying a stability annotation (static /
// conversation-scoped / turn-scoped / volatile), plus a fingerprint (hash)
// of the static + conversation-scoped segments. This file owns what a
// segment/context IS, how it flattens back to a provider's request shape,
// and how it fingerprints — it does NOT decide which segments any
// particular call needs (that stays aiService.js's own orchestration job,
// same as it already owned today's flat-string concatenation order).
//
// P2(a) scope only: every adapter accepts a Context via flattenToPrompts,
// which reproduces today's exact {systemPrompt, userPrompt, tools, images}
// strings byte-for-byte — zero behavior change. Nothing reads
// context.fingerprint yet; it's plumbing for P2(b) (native per-adapter
// buildRequest, Gemini first) and P3 (provider-specific caching). See
// bka/30-decisions/adr-register.md#adr-030.

const crypto = require('crypto');

const STABILITY = {
  STATIC: 'static',
  CONVERSATION: 'conversation-scoped',
  TURN: 'turn-scoped',
  VOLATILE: 'volatile',
};

const STABILITY_VALUES = new Set(Object.values(STABILITY));
const TARGET_VALUES = new Set(['system', 'user']);

// A programmer-error guard (bad segment shape from THIS codebase's own
// call sites), not caller-input validation — same "fail loudly on a
// coding mistake" posture used elsewhere (e.g. aiToolRegistry's
// registerTool). Never reachable from untrusted input.
function segment({
  source, stability, target, content,
}) {
  if (!source || typeof source !== 'string') throw new Error('segment() requires a string source');
  if (!STABILITY_VALUES.has(stability)) throw new Error(`segment() got an unknown stability: ${stability}`);
  if (!TARGET_VALUES.has(target)) throw new Error(`segment() target must be 'system' or 'user', got: ${target}`);
  if (!content || typeof content !== 'string') throw new Error(`segment() requires non-empty string content (source: ${source})`);
  return {
    source, stability, target, content,
  };
}

// Hashes only STATIC + CONVERSATION segments, in list order — per the
// ADR's own text ("a fingerprint (hash) of the static +
// conversation-scoped segments"). TURN/VOLATILE segments (the question
// itself, tool results, timestamps) are deliberately excluded so the
// fingerprint reflects only the part of the prompt that's actually
// eligible to be a stable, cacheable prefix.
function computeFingerprint(segments) {
  const qualifying = segments
    .filter((s) => s.stability === STABILITY.STATIC || s.stability === STABILITY.CONVERSATION)
    .map((s) => ({ source: s.source, content: s.content }));
  return crypto.createHash('sha256').update(JSON.stringify(qualifying)).digest('hex');
}

// `tools`/`images`/`media` are carried as separate top-level fields,
// never turned into segments — they're structured arrays passed
// straight to adapter.completeWithTools today, never stringified into
// prompt text at any call site in aiService.js. `media` is new
// (ai-chat-file-intelligence-router-approved-spec.md's audio/video
// feature) — deliberately a SEPARATE field from `images`, not images
// generalized to cover every modality, so every existing `images`
// caller/test keeps its exact original shape untouched; only aiService's
// new audio/video path populates `media`.
//
// `responseSchema` (CEO Vertex/Gemini audit #12/C3, 2026-08-30) — an
// optional plain JSON-Schema object a caller can attach when it needs
// the model's reply forced into a specific shape, e.g.
// documentExtractionService.js's classify/extract calls (today: prompt
// text asking for "strict JSON", nothing enforcing it). Deliberately a
// passthrough field, not consumed here: only gemini.js/openai.js map it
// to their own native structured-output mechanism today (see those
// files); an adapter that doesn't destructure it (claude.js,
// vertexMaas.js, selfHosted.js) is completely unaffected — additive,
// zero behavior change for every caller that never sets it. Every
// caller that DOES set it must still validate the parsed result itself
// (RS-AIG-012/C3 "post-generation validation mandatory") — native
// enforcement narrows how a model can fail, it does not replace the
// check, and providers with no native support have no enforcement at
// all beyond that check.
// `thinkingLevel` (CEO Vertex/Gemini audit #26, 2026-08-30) — an
// optional 'LOW'/'MEDIUM'/'HIGH' override for gemini.js's own
// GENERATION_CONFIG.thinkingConfig.thinkingLevel default. Same
// passthrough-only posture as responseSchema above: only gemini.js
// reads it (Vertex's own real parameter); every other adapter ignores
// it harmlessly. routes/ai.js's THINKING_LEVEL_BY_LABEL is the only
// place a frontend-facing label ('fast'/'balanced'/'deep') is ever
// translated to this value — nothing below this layer ever sees the
// label.
// `includeThoughts` (CEO Vertex/Gemini audit #27, 2026-08-30) — "enable
// it, test in real time, then decide" (overriding the audit's own
// default "never expose as evidence" for THIS narrow, opt-in,
// internal-only rollout). Requests Gemini's thought-summary parts
// alongside the answer; gemini.js splits them out of the visible text
// unconditionally regardless of this flag (a real latent bug this ADL
// found and fixed while wiring it: thought parts also carry `.text` and
// would otherwise silently ride inside the answer the moment thoughts
// were ever requested). Never forwarded to a frontend response —
// aiService.js's own call site logs it (audit-only) when a college has
// opted in, same `configuration` category gate `audio_video_attachments`
// already established. RS-AIG-027 ("never user-facing as evidence")
// still governs the SUMMARY's use — this field only controls whether
// Gemini is ASKED for one.
// `logprobsTopK` (CEO Vertex/Gemini audit #39, 2026-08-30) — an optional
// integer requesting Gemini's per-token log-probabilities, "internal
// diagnostics mattum" per the audit's own decision — explicitly never a
// trust signal (RS-AIG-019's deterministic re-verification already fills
// that role). Adapter-level capability only; no caller in this codebase
// sets it yet (no internal eval tooling consumes it today), same
// "built ahead of a consumer" precedent vertexCapabilityRegistry.js
// itself already set.
function buildContext(segments, {
  tools, images, media, responseSchema, thinkingLevel, includeThoughts, logprobsTopK,
} = {}) {
  return {
    segments, tools, images, media, responseSchema, thinkingLevel, includeThoughts, logprobsTopK, fingerprint: computeFingerprint(segments),
  };
}

// The P2(a) shim every adapter calls first: reproduces today's exact
// per-call-site string assembly. systemPrompt = every 'system'-targeted
// segment's content, in list order, joined by the same '\n\n' every
// call site already uses; userPrompt likewise for 'user'-targeted
// segments. A segment that doesn't apply to a given call (e.g. no
// safety-preamble in Research mode, no image-unavailable-note when
// vision is supported) is simply omitted from the list by the caller —
// never represented as an empty-string segment — so omission here is
// just "not present to filter in," not a special case.
function flattenToPrompts(context) {
  const systemPrompt = context.segments
    .filter((s) => s.target === 'system')
    .map((s) => s.content)
    .join('\n\n');
  const userPrompt = context.segments
    .filter((s) => s.target === 'user')
    .map((s) => s.content)
    .join('\n\n');
  return {
    systemPrompt,
    userPrompt,
    tools: context.tools,
    images: context.images,
    media: context.media,
    responseSchema: context.responseSchema,
    thinkingLevel: context.thinkingLevel,
    includeThoughts: context.includeThoughts,
    logprobsTopK: context.logprobsTopK,
  };
}

// Test/back-compat helper: wraps a flat {systemPrompt, userPrompt, tools,
// images, media, responseSchema} object (today's shape, now with `media`/
// `responseSchema` additive) into a minimal two-segment Context, so
// existing test call sites and the two documentExtractionService.js call
// sites (which have no real segment structure to preserve — a single
// static instruction + a single turn-scoped OCR text blob) don't need to
// hand-build a segment list.
function contextFromFlatPrompts({
  systemPrompt, userPrompt, tools, images, media, responseSchema, thinkingLevel, includeThoughts, logprobsTopK,
} = {}) {
  const segments = [];
  if (systemPrompt) {
    segments.push(segment({
      source: 'flat-system', stability: STABILITY.STATIC, target: 'system', content: systemPrompt,
    }));
  }
  if (userPrompt) {
    segments.push(segment({
      source: 'flat-user', stability: STABILITY.TURN, target: 'user', content: userPrompt,
    }));
  }
  return buildContext(segments, {
    tools, images, media, responseSchema, thinkingLevel, includeThoughts, logprobsTopK,
  });
}

module.exports = {
  STABILITY,
  segment,
  buildContext,
  flattenToPrompts,
  contextFromFlatPrompts,
};
