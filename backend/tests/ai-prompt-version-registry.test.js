'use strict';

// ARCNAVE modernization P5 ("prompt and model version registry").

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CHAT_MODULE_VERSIONS,
  computePromptVersionTag,
  describePromptVersions,
} = require('../src/services/aiPromptVersionRegistry');
const documentExtractionService = require('../src/services/documentExtractionService');

test('CHAT_MODULE_VERSIONS: the six ADR-030 module names, each with a version', () => {
  assert.deepEqual(Object.keys(CHAT_MODULE_VERSIONS).sort(), [
    'ARTIFACT',
    'CONTINUITY',
    'CORE',
    'FILE',
    'PLAN',
    'TOOL_SELECTION',
  ]);
  for (const [name, version] of Object.entries(CHAT_MODULE_VERSIONS)) {
    assert.match(version, /^v\d+$/, `${name}'s version must look like "v1"`);
  }
});

test('computePromptVersionTag: CORE-only turn', () => {
  assert.equal(computePromptVersionTag(['CORE']), 'CORE@v1');
});

test('computePromptVersionTag: joins multiple active modules with "+", in the order given', () => {
  assert.equal(
    computePromptVersionTag(['CORE', 'CONTINUITY', 'TOOL_SELECTION']),
    'CORE@v1+CONTINUITY@v1+TOOL_SELECTION@v1',
  );
});

test('computePromptVersionTag: an empty list tags as an empty string, never throws', () => {
  assert.equal(computePromptVersionTag([]), '');
});

test('computePromptVersionTag: an unrecognised module name tags "unversioned" rather than throwing', () => {
  assert.equal(computePromptVersionTag(['NOT_A_REAL_MODULE']), 'NOT_A_REAL_MODULE@unversioned');
});

test('describePromptVersions: chatModules lists all six with their real version and a valid assembly-order index', () => {
  const described = describePromptVersions();
  const names = described.chatModules.map((m) => m.name).sort();
  assert.deepEqual(names, ['ARTIFACT', 'CONTINUITY', 'CORE', 'FILE', 'PLAN', 'TOOL_SELECTION']);
  for (const m of described.chatModules) {
    assert.equal(m.version, CHAT_MODULE_VERSIONS[m.name]);
    assert.ok(m.assemblyOrder >= 0, `${m.name} must resolve to a real position in the full-assembly ordering`);
  }
  const core = described.chatModules.find((m) => m.name === 'CORE');
  assert.equal(core.assemblyOrder, 0, 'CORE is always first');
});

test('describePromptVersions: documentExtraction reads the real, live values from documentExtractionService — never a second, driftable copy', () => {
  const described = describePromptVersions();
  assert.equal(
    described.documentExtraction.visionTranscription,
    documentExtractionService.VISION_TRANSCRIPTION_PROMPT_VERSION,
  );
  assert.equal(
    described.documentExtraction.documentClassification,
    documentExtractionService.DOCUMENT_CLASSIFICATION_PROMPT_VERSION,
  );
  assert.equal(described.documentExtraction.fieldExtraction, documentExtractionService.FIELD_EXTRACTION_PROMPT_VERSION);
  assert.equal(
    described.documentExtraction.spatialFieldExtraction,
    documentExtractionService.SPATIAL_FIELD_EXTRACTION_PROMPT_VERSION,
  );
});
