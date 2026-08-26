'use strict';

// Consumer-tool adaptation, third batch: the catalog family
// (search_plugins / search_skills / suggest_* / recommend_claude_apps),
// the output-format decision framework, and the memory-edit gap.
//
// Assert the DECISIONS, not the wording: that the catalogue never
// enables anything, that "unavailable" is never one undifferentiated
// answer, that the format policy defaults to the lightest option, and
// that a memory revision is checked as strictly as a new memory.

const test = require('node:test');
const assert = require('node:assert');

const aiCapabilityCatalogService = require('../src/services/aiCapabilityCatalogService');
const aiOutputFormatService = require('../src/services/aiOutputFormatService');
const aiToolRegistry = require('../src/services/aiToolRegistry');

const { AiCapabilityCatalogValidationError } = aiCapabilityCatalogService;
const { AiOutputFormatValidationError, DESTINATIONS } = aiOutputFormatService;

// A configurationService stub — capabilityExplain's only data access.
function configStub(enabledCategories) {
  return {
    getConfiguration: async (client, { category }) => (enabledCategories.includes(category)
      ? { configuration: { enabled: true } }
      : null),
  };
}

test.describe('capability_search (consumer-tool-adaptation: search_plugins / search_skills)', () => {
  test('rejects a query with no searchable words', () => {
    assert.throws(() => aiCapabilityCatalogService.capabilitySearch('principal', 'what can you do'), AiCapabilityCatalogValidationError);
  });

  test('rejects a query below the minimum length', () => {
    assert.throws(() => aiCapabilityCatalogService.capabilitySearch('principal', 'a'), AiCapabilityCatalogValidationError);
  });

  test('returns only capabilities the acting role actually permits', () => {
    const forStaff = aiCapabilityCatalogService.capabilitySearch('staff', 'attendance');
    const staffToolNames = new Set(
      aiToolRegistry.listTools({ role: 'staff', excludeHumanOnly: true }).map((t) => t.name),
    );
    forStaff.forEach((match) => assert.ok(staffToolNames.has(match.capability), `${match.capability} leaked into staff results`));
  });

  test('never lists a human-only capability — the AI cannot do those at all', () => {
    const humanOnlyNames = new Set(
      aiToolRegistry.listTools({ role: 'principal' })
        .filter((t) => !aiToolRegistry.listTools({ role: 'principal', excludeHumanOnly: true }).some((v) => v.name === t.name))
        .map((t) => t.name),
    );
    const matches = aiCapabilityCatalogService.capabilitySearch('principal', 'student records timetable finance');
    matches.forEach((m) => assert.ok(!humanOnlyNames.has(m.capability)));
  });

  test('flags which matches are gated behind a per-college opt-in', () => {
    const matches = aiCapabilityCatalogService.capabilitySearch('principal', 'weather forecast');
    const weather = matches.find((m) => m.capability === 'weather_fetch');
    assert.ok(weather, 'weather_fetch should match a weather query');
    assert.strictEqual(weather.requiresOptIn, true);
  });

  test('caps the result set rather than returning the whole registry', () => {
    const matches = aiCapabilityCatalogService.capabilitySearch('principal', 'student staff document report attendance finance');
    assert.ok(matches.length <= aiCapabilityCatalogService.MAX_MATCHES);
  });
});

test.describe('capability_explain (consumer-tool-adaptation: suggest_plugin_install)', () => {
  const original = require('../src/services/configurationService');
  const originalGet = original.getConfiguration;

  test.afterEach(() => { original.getConfiguration = originalGet; });

  test('distinguishes "no such capability" from every other reason', async () => {
    const result = await aiCapabilityCatalogService.capabilityExplain({}, 'demo', 'principal', 'teleport_student');
    assert.strictEqual(result.reason, 'not_a_capability');
    assert.strictEqual(result.available, false);
  });

  test('distinguishes a role block from a college opt-in block', async () => {
    original.getConfiguration = configStub([]).getConfiguration;
    const roleBlocked = await aiCapabilityCatalogService.capabilityExplain({}, 'demo', 'staff', 'departments_create');
    const optInBlocked = await aiCapabilityCatalogService.capabilityExplain({}, 'demo', 'principal', 'weather_fetch');
    assert.notStrictEqual(roleBlocked.reason, optInBlocked.reason);
    assert.strictEqual(optInBlocked.reason, 'not_enabled_for_college');
  });

  test('reports available once the college has opted in', async () => {
    original.getConfiguration = configStub(['weather']).getConfiguration;
    const result = await aiCapabilityCatalogService.capabilityExplain({}, 'demo', 'principal', 'weather_fetch');
    assert.strictEqual(result.available, true);
    assert.strictEqual(result.reason, 'available');
  });

  test('names the settings category so the answer is actionable, not just a refusal', async () => {
    original.getConfiguration = configStub([]).getConfiguration;
    const result = await aiCapabilityCatalogService.capabilityExplain({}, 'demo', 'principal', 'web_search');
    assert.match(result.explanation, /web_search/);
    assert.match(result.explanation, /cannot turn it on/);
  });

  test('rejects an empty capability name', async () => {
    await assert.rejects(
      () => aiCapabilityCatalogService.capabilityExplain({}, 'demo', 'principal', ''),
      AiCapabilityCatalogValidationError,
    );
  });
});

test.describe('the catalogue cannot enable anything (its whole safety property)', () => {
  test('neither catalogue tool is registered above L1 or as a write', () => {
    ['capability_search', 'capability_explain'].forEach((name) => {
      const tool = aiToolRegistry.getTool(name);
      assert.ok(tool, `${name} should be registered`);
      assert.strictEqual(tool.level, 'L1');
    });
  });

  test('no tool exists that turns a capability on — that stays a configuration change', () => {
    const enablers = aiToolRegistry.listTools()
      .filter((t) => /capability.*(enable|install|activate)|enable.*capability/i.test(t.name));
    assert.deepStrictEqual(enablers, []);
  });
});

test.describe('decide_output_format (consumer-tool-adaptation: the output-format framework)', () => {
  test('defaults to prose — the lightest format wins when nothing is asked for', () => {
    const decision = aiOutputFormatService.decideOutputFormat('how many students are in III-ECE-A');
    assert.strictEqual(decision.destination, DESTINATIONS.PROSE);
    assert.strictEqual(decision.shape, 'direct_answer');
  });

  test('routes an institutional record to a document, not a chat reply', () => {
    const decision = aiOutputFormatService.decideOutputFormat('draft a circular about the exam schedule');
    assert.strictEqual(decision.destination, DESTINATIONS.DOCUMENT);
  });

  test('routes a reusable draft to an artifact', () => {
    const decision = aiOutputFormatService.decideOutputFormat('prepare a proposal for the new lab');
    assert.strictEqual(decision.destination, DESTINATIONS.ARTIFACT);
  });

  test('routes an explanation to prose even though it is a long answer', () => {
    const decision = aiOutputFormatService.decideOutputFormat('explain why attendance dropped this term');
    assert.strictEqual(decision.destination, DESTINATIONS.PROSE);
  });

  test('routes a comparison to a section and names the tool', () => {
    const decision = aiOutputFormatService.decideOutputFormat('compare III-ECE-A and III-ECE-B attendance');
    assert.strictEqual(decision.destination, DESTINATIONS.SECTION);
    assert.match(decision.reason, /present_comparison/);
  });

  test('always carries the restraint rule, whatever it decides', () => {
    ['how many students', 'draft a circular', 'compare A and B'].forEach((request) => {
      assert.match(aiOutputFormatService.decideOutputFormat(request).restraint, /At most one visual/);
    });
  });

  test('rejects an empty request', () => {
    assert.throws(() => aiOutputFormatService.decideOutputFormat(''), AiOutputFormatValidationError);
  });
});

test.describe('decide_image_route — Layer 5, with the source framework corrected', () => {
  test('prefers a drawn diagram over any image for structural content', () => {
    const route = aiOutputFormatService.decideImageRoute('the approval process flow');
    assert.strictEqual(route.route, 'diagram');
    assert.strictEqual(route.tool, 'present_diagram');
  });

  test('offers generation, which the source framework wrongly says is unavailable', () => {
    const route = aiOutputFormatService.decideImageRoute('an illustration for the sports day poster');
    assert.strictEqual(route.route, 'generate');
    assert.strictEqual(route.tool, 'generate_image');
  });

  test('searches for a real existing photo rather than generating one', () => {
    const route = aiOutputFormatService.decideImageRoute('what does the new lab equipment look like');
    assert.strictEqual(route.route, 'search');
    assert.strictEqual(route.tool, 'image_search');
  });

  test('most often decides no image is warranted at all', () => {
    const route = aiOutputFormatService.decideImageRoute('the fee arrears totals for this term');
    assert.strictEqual(route.route, 'none');
    assert.strictEqual(route.tool, null);
  });
});

test.describe('fileTypeGuidance — Layer 6, per-format truth since the skills subsystem shipped (2026-08-26 second pass)', () => {
  test('xlsx now has a real skill AND a real quality gate — never claims otherwise', () => {
    const guidance = aiOutputFormatService.fileTypeGuidance('xlsx');
    assert.strictEqual(guidance.skillAvailable, true);
    assert.strictEqual(guidance.qualityGate, 'recalc');
    assert.strictEqual(guidance.warning, null);
  });

  test('docx/pptx/pdf(create) still have no gate — the sandbox has no package to back one', () => {
    ['docx', 'pptx', 'pdf'].forEach((type) => {
      const guidance = aiOutputFormatService.fileTypeGuidance(type);
      assert.strictEqual(guidance.qualityGate, null);
      assert.match(guidance.warning, /No quality gate exists/);
    });
  });

  test('still says what the missing gate would have checked, per known type', () => {
    assert.match(aiOutputFormatService.fileTypeGuidance('.pdf').note, /rasteris/i);
    assert.match(aiOutputFormatService.fileTypeGuidance('XLSX').note, /formulas/i);
  });

  test('is honest about an unknown type rather than inventing guidance', () => {
    const guidance = aiOutputFormatService.fileTypeGuidance('odt');
    assert.match(guidance.note, /no format-specific guidance/);
    assert.strictEqual(guidance.skillAvailable, false);
    assert.match(guidance.warning, /No quality gate exists/);
  });
});

test.describe('new tool registrations are wired and role-scoped', () => {
  const NEW_TOOLS = [
    'present_featured', 'present_comparison', 'present_carousel', 'present_links',
    'present_places', 'present_map', 'present_recipe', 'present_diagram',
    'describe_diagram_constraints', 'conversation_recent', 'conversation_read',
    'conversation_archive', 'ai_memory_revise', 'web_search_fast', 'image_search',
    'capability_search', 'capability_explain', 'decide_output_format', 'decide_image_route',
  ];

  test('every one is registered', () => {
    NEW_TOOLS.forEach((name) => assert.ok(aiToolRegistry.getTool(name), `${name} is not registered`));
  });

  test('every one is L1, Internal and not human-only', () => {
    NEW_TOOLS.forEach((name) => {
      const tool = aiToolRegistry.getTool(name);
      assert.strictEqual(tool.level, 'L1', `${name} level`);
      assert.strictEqual(tool.dataClassification, 'Internal', `${name} classification`);
      assert.ok(!tool.humanOnly, `${name} humanOnly`);
    });
  });

  test('every one is available to all four roles', () => {
    NEW_TOOLS.forEach((name) => {
      assert.deepStrictEqual(
        [...aiToolRegistry.getTool(name).allowedRoles].sort(),
        ['class_tutor', 'hod', 'principal', 'staff'],
        `${name} roles`,
      );
    });
  });
});
