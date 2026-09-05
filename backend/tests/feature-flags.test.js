'use strict';

// ARCNAVE modernization P2 (PDF 1.14) — the experiment-switch registry.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FLAG_DEFINITIONS,
  resolveFlags,
  describeFeatureFlags,
  parseStrictBoolean,
  resolveRolloutBucket,
} = require('../src/featureFlags');

test('FLAG_DEFINITIONS: the six EXPERIMENTAL_* AI behaviour trials, all hot-path, all inert by default', () => {
  const keys = FLAG_DEFINITIONS.map((d) => d.key).sort();
  assert.deepEqual(keys, [
    'experimentalAttachmentDiscipline',
    'experimentalCatalogueVariant',
    'experimentalFullInstructionsDocument',
    'experimentalReasoningModel',
    'experimentalThinkingTraceVisibility',
    'experimentalZeroToolFastPath',
  ]);
  for (const def of FLAG_DEFINITIONS) {
    assert.equal(def.hotPath, true, `${def.key} is read on the request hot path`);
    assert.ok(def.env.startsWith('EXPERIMENTAL_'), `${def.key} env var is namespaced`);
    assert.ok(def.owner && def.description, `${def.key} carries owner + description`);
  }
});

test('resolveFlags: empty env resolves every flag to its shipped-inert default', () => {
  const resolved = resolveFlags({});
  assert.deepEqual(resolved, {
    experimentalCatalogueVariant: null,
    experimentalReasoningModel: null,
    experimentalAttachmentDiscipline: false,
    experimentalFullInstructionsDocument: false,
    experimentalThinkingTraceVisibility: false,
    experimentalZeroToolFastPath: false,
  });
});

test('resolveFlags: boolean trials only flip on the exact literal "true"', () => {
  for (const raw of ['false', '0', '1', 'yes', 'TRUE', '', ' true ']) {
    assert.equal(resolveFlags({ EXPERIMENTAL_ZERO_TOOL_FAST_PATH: raw }).experimentalZeroToolFastPath, false, raw);
  }
  assert.equal(resolveFlags({ EXPERIMENTAL_ZERO_TOOL_FAST_PATH: 'true' }).experimentalZeroToolFastPath, true);
});

test('resolveFlags: catalogue variant accepts keywords/hybrid, rejects anything else loudly', () => {
  assert.equal(resolveFlags({ EXPERIMENTAL_CATALOGUE_VARIANT: 'hybrid' }).experimentalCatalogueVariant, 'hybrid');
  assert.equal(resolveFlags({ EXPERIMENTAL_CATALOGUE_VARIANT: 'keywords' }).experimentalCatalogueVariant, 'keywords');
  assert.equal(resolveFlags({ EXPERIMENTAL_CATALOGUE_VARIANT: '' }).experimentalCatalogueVariant, null);
  assert.throws(
    () => resolveFlags({ EXPERIMENTAL_CATALOGUE_VARIANT: 'full' }),
    /EXPERIMENTAL_CATALOGUE_VARIANT must be one of keywords, hybrid/,
  );
});

test('resolveFlags: reasoning model is a free-form MaaS id, empty string normalises to null', () => {
  assert.equal(
    resolveFlags({ EXPERIMENTAL_REASONING_MODEL: 'zai-org/glm-5.2-maas' }).experimentalReasoningModel,
    'zai-org/glm-5.2-maas',
  );
  assert.equal(resolveFlags({ EXPERIMENTAL_REASONING_MODEL: '' }).experimentalReasoningModel, null);
});

test('describeFeatureFlags: reports current value + overridden marker against the live config object', () => {
  const fakeConfig = {
    experimentalCatalogueVariant: 'hybrid',
    experimentalReasoningModel: null,
    experimentalAttachmentDiscipline: false,
    experimentalFullInstructionsDocument: false,
    experimentalThinkingTraceVisibility: false,
    experimentalZeroToolFastPath: false,
  };
  const rows = describeFeatureFlags(fakeConfig);
  const variantRow = rows.find((r) => r.key === 'experimentalCatalogueVariant');
  assert.equal(variantRow.current, 'hybrid');
  assert.equal(variantRow.overridden, true);
  assert.deepEqual(variantRow.values, ['keywords', 'hybrid']);
  const zeroToolRow = rows.find((r) => r.key === 'experimentalZeroToolFastPath');
  assert.equal(zeroToolRow.current, false);
  assert.equal(zeroToolRow.overridden, false);
  // The view carries only metadata + a non-sensitive current toggle value.
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), [
      'current',
      'default',
      'description',
      'env',
      'hotPath',
      'key',
      'overridden',
      'owner',
      'type',
      'values',
    ]);
  }
});

test('config.js exposes the six flags as plain writable data properties (runtime-mutation contract)', () => {
  // config.js fails loud on missing connection strings/secrets; this
  // case only cares about property shape, so stub the required vars when
  // running outside the Docker suite that normally provides them.
  for (const [k, v] of Object.entries({
    DATABASE_URL: 'postgres://x',
    MIGRATION_DATABASE_URL: 'postgres://x',
    PLATFORM_DATABASE_URL: 'postgres://x',
    JWT_SECRET_KEY: 'x',
    PLATFORM_JWT_SECRET_KEY: 'x',
    DOCUMENT_STORAGE_ENCRYPTION_KEY: 'x',
  })) {
    if (!process.env[k]) process.env[k] = v;
  }
  delete require.cache[require.resolve('../src/config')];
  const config = require('../src/config');
  for (const def of FLAG_DEFINITIONS) {
    assert.ok(Object.prototype.hasOwnProperty.call(config, def.key), `${def.key} present on config`);
    const original = config[def.key];
    config[def.key] = 'mutated-for-test';
    assert.equal(config[def.key], 'mutated-for-test');
    config[def.key] = original;
  }
  delete require.cache[require.resolve('../src/config')];
});

test('parseStrictBoolean is the shared strict parser', () => {
  assert.equal(parseStrictBoolean('true'), true);
  assert.equal(parseStrictBoolean('1'), false);
  assert.equal(parseStrictBoolean(undefined), false);
});

// ARCNAVE modernization P5 ("gradual rollout for prompt and model
// changes") — the deterministic percentage-bucketing primitive.
test('resolveRolloutBucket: 0 percent never enrolls, 100 percent always enrolls', () => {
  for (const seed of ['college-a', 'college-b', '', 'conversation-123']) {
    assert.equal(resolveRolloutBucket(seed, 0), false, seed);
    assert.equal(resolveRolloutBucket(seed, 100), true, seed);
  }
});

test('resolveRolloutBucket: a non-positive or non-numeric percent is always false, never throws', () => {
  assert.equal(resolveRolloutBucket('x', -5), false);
  assert.equal(resolveRolloutBucket('x', undefined), false);
  assert.equal(resolveRolloutBucket('x', NaN), false);
  assert.equal(resolveRolloutBucket('x', null), false);
});

test('resolveRolloutBucket: deterministic — same seed, same percent, same result every call', () => {
  for (let i = 0; i < 20; i += 1) {
    assert.equal(resolveRolloutBucket('college-demo', 37), resolveRolloutBucket('college-demo', 37));
  }
});

test('resolveRolloutBucket: real ~N% of a large seed population enrolls, not 0% or 100%', () => {
  const percent = 20;
  let enrolled = 0;
  const total = 5000;
  for (let i = 0; i < total; i += 1) {
    if (resolveRolloutBucket(`seed-${i}`, percent)) enrolled += 1;
  }
  const rate = (enrolled / total) * 100;
  // Loose bound (hash-based bucketing, not a statistical RNG test) —
  // catches a real "always 0" or "always 100" bug, not meant to assert
  // hash-quality precision.
  assert.ok(rate > 10 && rate < 30, `enrollment rate ${rate}% should be roughly near ${percent}%`);
});

test('resolveRolloutBucket: different seeds at the same percent are not all identical (real bucketing, not a constant)', () => {
  const results = new Set();
  for (let i = 0; i < 50; i += 1) {
    results.add(resolveRolloutBucket(`distinct-${i}`, 50));
  }
  assert.deepEqual(results, new Set([true, false]));
});
