'use strict';

// ARCNAVE modernization P5 ("prompt and model version registry" — the
// plan's own "How the best teams actually write it" §4: "Reproducible.
// Same input and tools give the same result. Pin prompt versions and
// model versions."). Before this, ARCNAVE had two disconnected halves:
// aiModelVersionService.js already detects MODEL version drift, but no
// equivalent existed for PROMPT versions at all — aiPolicyAssembly.js's
// six real modules (CORE/CONTINUITY/TOOL_SELECTION/PLAN/FILE/ARTIFACT,
// ADR-030) carried no version identifier, and documentExtractionService.js's
// four existing `*_PROMPT_VERSION` constants were each scattered in their
// own file with no single place to see all of them at once.
//
// This module is that single place: a read-only registry over BOTH
// version families, plus computePromptVersionTag() — the per-turn
// fingerprint of exactly which module versions were actually assembled,
// for a caller (aiService.js, an audit-log entry, a future eval harness)
// that wants to say "this answer came from CORE@v1+TOOL_SELECTION@v1",
// not just "some version of the prompt." Versions here are bumped only
// when that module's actual text changes — every entry below is seeded
// at v1/its own existing value as an honest baseline (no prior version
// history existed to recover).

const aiPolicyAssembly = require('./aiPolicyAssembly');
const documentExtractionService = require('./documentExtractionService');

// Bump the entry here (never anywhere else) the day aiPolicyAssembly.js's
// corresponding module text actually changes — this is the ONLY source
// of truth for a chat-turn module's version.
const CHAT_MODULE_VERSIONS = Object.freeze({
  CORE: 'v1',
  CONTINUITY: 'v1',
  TOOL_SELECTION: 'v1',
  PLAN: 'v1',
  FILE: 'v1',
  ARTIFACT: 'v1',
});

// Document-extraction prompt versions are owned by
// documentExtractionService.js's own `*_PROMPT_VERSION` constants
// (already bumped in place — DOCUMENT_CLASSIFICATION and FIELD_EXTRACTION
// are already at v2) — read here, never redeclared, so this registry can
// never drift out of sync with the real values those extraction calls
// actually send.
function documentExtractionVersions() {
  return {
    visionTranscription: documentExtractionService.VISION_TRANSCRIPTION_PROMPT_VERSION,
    documentClassification: documentExtractionService.DOCUMENT_CLASSIFICATION_PROMPT_VERSION,
    fieldExtraction: documentExtractionService.FIELD_EXTRACTION_PROMPT_VERSION,
    spatialFieldExtraction: documentExtractionService.SPATIAL_FIELD_EXTRACTION_PROMPT_VERSION,
  };
}

// The per-turn fingerprint. `activeModuleNames` is
// aiPolicyAssembly.getActiveModuleNames(state)'s own output — this
// function never re-derives which modules were active, only tags the
// ones it's told were. An unrecognised name (should never happen; both
// come from the same module) tags as 'unversioned' rather than throwing,
// since this is a diagnostics/reproducibility aid, never something that
// should be able to break a real chat turn.
function computePromptVersionTag(activeModuleNames) {
  return activeModuleNames.map((name) => `${name}@${CHAT_MODULE_VERSIONS[name] || 'unversioned'}`).join('+');
}

// Read-only introspection — same shape/purpose as featureFlags.js's own
// describeFeatureFlags(), surfaced at GET /ai-config/prompt-versions.
function describePromptVersions() {
  return {
    chatModules: Object.entries(CHAT_MODULE_VERSIONS).map(([name, version]) => ({
      name,
      version,
      assemblyOrder: aiPolicyAssembly
        .getActiveModuleNames({
          hasHistory: true,
          toolCount: 2,
          hasFileTool: true,
          focusEntityType: 'artifact',
        })
        .indexOf(name),
    })),
    documentExtraction: documentExtractionVersions(),
  };
}

module.exports = {
  CHAT_MODULE_VERSIONS,
  computePromptVersionTag,
  describePromptVersions,
};
