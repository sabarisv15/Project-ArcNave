'use strict';

// ARCNAVE modernization P2 (PDF 1.14 / Part 1) — the experiment-switch
// registry.
//
// Before this, the EXPERIMENTAL_* env flags were declared inline in
// config.js as bare `process.env.X === 'true'` / `|| null` expressions,
// each buried under a paragraph of comment, read from scattered points
// in aiService.js / gemini.js on the request hot path, with no single
// place to see what exists, what it defaults to, or what it currently
// resolves to on a running instance. This module is that single place:
// one declarative table, parsed and validated once at load, and
// introspectable via describeFeatureFlags() (surfaced read-only at
// GET /api/v1/ai-config/feature-flags).
//
// Scope discipline (PDF clashes C1 / C8): every entry here is a
// PROCESS-LEVEL BEHAVIOUR TRIAL, never tenant-facing configuration —
// none is a per-college override, all ship OFF / inert by default.
// Per-college toggles still belong in the `configurations` table via
// configurationService (web_retrieval / ai_quota precedent), never here.
//
// Runtime-mutation contract: config.js spreads resolveFlags() into its
// exported object as plain writable data properties, because existing
// tests and scripts assign `config.experimentalX = ...` directly for the
// duration of a case and restore it in a finally block. This module only
// provides the INITIAL resolved value plus the metadata; it never
// installs getters and never freezes anything.

const BOOLEAN_TRIAL_DEFAULTS = Object.freeze({ default: false, type: 'boolean' });

// One row per flag. `parse(raw)` receives the raw env string (or
// undefined) and returns the resolved value; it may throw on an
// invalid explicit value (fail loud at startup, same posture as
// config.js's `required()` and maxToolCallsPerTurn).
const FLAG_DEFINITIONS = [
  {
    key: 'experimentalCatalogueVariant',
    env: 'EXPERIMENTAL_CATALOGUE_VARIANT',
    type: 'enum',
    values: ['keywords', 'hybrid'],
    default: null,
    hotPath: true,
    owner: 'ADL-064',
    description:
      "Tool-catalogue routing variant read by aiService.buildToolCatalogueForExperiment(). Unset (null) or any unrecognised value behaves as 'keywords' — the shipped default, role-filtered. 'hybrid' is the one remaining opt-in, kept for the still-open keywords-vs-hybrid comparison.",
    parse(raw) {
      if (raw === undefined || raw === '') return null;
      if (!['keywords', 'hybrid'].includes(raw)) {
        throw new Error(
          `EXPERIMENTAL_CATALOGUE_VARIANT must be one of keywords, hybrid (got ${JSON.stringify(raw)})`,
        );
      }
      return raw;
    },
  },
  {
    key: 'experimentalReasoningModel',
    env: 'EXPERIMENTAL_REASONING_MODEL',
    type: 'string',
    default: null,
    hotPath: true,
    owner: 'ADL-067 (Priority 2 reasoning-model benchmark)',
    description:
      'When set, aiService.resolveReasoningConfig() overrides askAgent\'s {adapter, aiConfig} to the vertex_maas adapter plus this exact MaaS model string (e.g. "zai-org/glm-5.2-maas"). Unset (null) reproduces configurationService.getAiConfig()\'s normal resolution — the only value shipped.',
    parse(raw) {
      return raw || null;
    },
  },
  {
    key: 'experimentalAttachmentDiscipline',
    env: 'EXPERIMENTAL_ATTACHMENT_DISCIPLINE',
    ...BOOLEAN_TRIAL_DEFAULTS,
    hotPath: true,
    owner: 'ADR-030 (Priority 3 follow-up)',
    description:
      'Adds a condensed "confirm scope, extract via the real tool, cross-verify" system-prompt segment on turns that carry attachments. Additive prompt guidance only — changes no tool, service, or ownership rule.',
    parse: parseStrictBoolean,
  },
  {
    key: 'experimentalFullInstructionsDocument',
    env: 'EXPERIMENTAL_FULL_INSTRUCTIONS_DOCUMENT',
    ...BOOLEAN_TRIAL_DEFAULTS,
    hotPath: true,
    owner: 'ADR-030 (testing-phase live trial, Review Finding #5 2026-08-29)',
    description:
      "Replaces experimentalAttachmentDiscipline's condensed segment with the full raw AI_OPERATING_INSTRUCTIONS reference document (~13k tokens), on every turn and every LLM call in the turn. MUST only ever be set via a gitignored local override for a time-boxed trial — never a checked-in compose/manifest/.env.example.",
    parse: parseStrictBoolean,
  },
  {
    key: 'experimentalThinkingTraceVisibility',
    env: 'EXPERIMENTAL_THINKING_TRACE_VISIBILITY',
    ...BOOLEAN_TRIAL_DEFAULTS,
    hotPath: true,
    owner: 'CEO Vertex/Gemini audit #27 (2026-08-30)',
    description:
      "Requests Gemini's thought-summary parts on the Curriculum decision call and logs them (audit-only, never returned to any API response — RS-AIG-027 still bars user-facing exposure). Process-level, not a per-college DB row, on purpose: a DB read would cost every askAgent call a query just to read false.",
    parse: parseStrictBoolean,
  },
  {
    key: 'experimentalZeroToolFastPath',
    env: 'EXPERIMENTAL_ZERO_TOOL_FAST_PATH',
    ...BOOLEAN_TRIAL_DEFAULTS,
    hotPath: true,
    owner: 'ADR-030 P3 follow-up (2026-08-30)',
    description:
      'When semantic retrieval genuinely finds ZERO relevant tools for a Curriculum-mode turn, additionally drops the always-on tool catalogue (~2,176 tok) and the describe_tools recovery meta-tool from that turn, structurally. Trades the catalogue\'s "retrieval miss is non-fatal" guarantee for exactly those turns — measure SIMILARITY_DISTANCE_THRESHOLD\'s real zero-rate before enabling.',
    parse: parseStrictBoolean,
  },
];

// Strict boolean: only the exact literal 'true' enables. A stray
// non-empty string like 'false' / '0' / 'yes' / 'TRUE' must never
// accidentally flip a behaviour trial on (config.js's own established
// convention — sandboxServiceIamAuth, pdfPlumberFallbackEnabled,
// toolSearch.enabled all parse this way).
function parseStrictBoolean(raw) {
  return raw === 'true';
}

// Resolve every flag from the current process.env. Called once by
// config.js at module-load time. Throws on any invalid explicit value.
function resolveFlags(env = process.env) {
  const resolved = {};
  for (const def of FLAG_DEFINITIONS) {
    resolved[def.key] = def.parse(env[def.env]);
  }
  return resolved;
}

// Read-only introspection for GET /ai-config/feature-flags and for
// debugging a running instance. `currentConfig` is the live config
// object, so `current` reflects any runtime mutation a test/script made,
// not just the load-time value. No flag here is a secret — they are all
// non-sensitive behaviour toggles — so returning `current` is safe.
function describeFeatureFlags(currentConfig) {
  return FLAG_DEFINITIONS.map((def) => ({
    key: def.key,
    env: def.env,
    type: def.type,
    values: def.values || null,
    default: def.default,
    current: currentConfig ? currentConfig[def.key] : undefined,
    overridden: currentConfig ? currentConfig[def.key] !== def.default : undefined,
    hotPath: Boolean(def.hotPath),
    owner: def.owner,
    description: def.description,
  }));
}

module.exports = {
  FLAG_DEFINITIONS,
  resolveFlags,
  describeFeatureFlags,
  parseStrictBoolean,
};
