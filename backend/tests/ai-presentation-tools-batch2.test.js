'use strict';

// Consumer-tool adaptation, second batch: the nine presentation tools
// left unbuilt after present_options/quiz/translation/steps shipped —
// featured_card, comparison_card, product_carousel, link_preview,
// places_list, places_map, recipe, and the visualize:* pair.
//
// These assert the SAFETY PROPERTIES, not the formatting: that a
// featured card cannot express a preference, that a comparison cannot
// hide an asymmetry, that a link cannot carry a javascript: URL, and
// that a diagram cannot carry a script. Formatting is covered by
// ai-experience-layer.test.js.

const test = require('node:test');
const assert = require('node:assert');

const aiInteractionService = require('../src/services/aiInteractionService');
const aiDiagramService = require('../src/services/aiDiagramService');
const aiToolRegistry = require('../src/services/aiToolRegistry');
const { buildSections } = require('../src/services/aiExperience/sectionBuilder');
const { validate } = require('../src/services/aiExperience/qualityGuard');
const { renderMarkdown } = require('../src/services/aiExperience/markdown');

const { AiInteractionValidationError } = aiInteractionService;
const { AiDiagramValidationError } = aiDiagramService;

function render(toolName, data) {
  return renderMarkdown(validate(buildSections({ toolName, data, answer: null })));
}

test.describe('present_featured (consumer-tool-adaptation: featured_card_display_v0)', () => {
  const fields = [{ label: 'Attendance', value: '61%' }];

  test('requires an objective basis — the card cannot exist without one', () => {
    assert.throws(() => aiInteractionService.buildFeaturedCard('III-ECE-A', '', fields), AiInteractionValidationError);
  });

  test('has no rank, score or recommended field to fill (RS-AIG-013 is structural here)', () => {
    const card = aiInteractionService.buildFeaturedCard('III-ECE-A', 'lowest attendance this term', fields);
    assert.deepStrictEqual(Object.keys(card).sort(), ['basis', 'fields', 'title']);
  });

  test('renders the basis, so a match never reads as a recommendation', () => {
    const card = aiInteractionService.buildFeaturedCard('III-ECE-A', 'lowest attendance this term', fields);
    const markdown = render('present_featured', card);
    assert.match(markdown, /Matched on: lowest attendance this term/);
  });

  test('rejects more than 8 fields', () => {
    const tooMany = Array.from({ length: 9 }, (_, i) => ({ label: `L${i}`, value: `V${i}` }));
    assert.throws(() => aiInteractionService.buildFeaturedCard('X', 'basis', tooMany), AiInteractionValidationError);
  });
});

test.describe('present_comparison (consumer-tool-adaptation: comparison_card_display_v0)', () => {
  const attributes = ['Attendance', 'Arrears'];

  test('rejects an item that does not answer every declared attribute', () => {
    assert.throws(
      () =>
        aiInteractionService.buildComparisonCard(null, attributes, [
          { name: 'III-ECE-A', values: ['61%', '12'] },
          { name: 'III-ECE-B', values: ['77%'] },
        ]),
      AiInteractionValidationError,
    );
  });

  test('has no verdict or winner field', () => {
    const card = aiInteractionService.buildComparisonCard(null, attributes, [
      { name: 'III-ECE-A', values: ['61%', '12'] },
      { name: 'III-ECE-B', values: ['77%', '4'] },
    ]);
    assert.deepStrictEqual(Object.keys(card).sort(), ['attributes', 'items', 'title']);
  });

  test('renders attributes as rows and items as columns', () => {
    const card = aiInteractionService.buildComparisonCard(null, attributes, [
      { name: 'III-ECE-A', values: ['61%', '12'] },
      { name: 'III-ECE-B', values: ['77%', '4'] },
    ]);
    const markdown = render('present_comparison', card);
    assert.match(markdown, /\| \*\*Attendance\*\* \| 61% \| 77% \|/);
  });

  test('rejects fewer than 2 or more than 4 items', () => {
    assert.throws(
      () => aiInteractionService.buildComparisonCard(null, attributes, [{ name: 'A', values: ['1', '2'] }]),
      AiInteractionValidationError,
    );
  });
});

test.describe('present_carousel (consumer-tool-adaptation: product_carousel_display_v0)', () => {
  test('renders unnumbered, so presentation order carries no ranking claim', () => {
    const card = aiInteractionService.buildCarousel('Electives', [
      { name: 'Machine Learning' },
      { name: 'VLSI Design', subtitle: '3 credits' },
    ]);
    const markdown = render('present_carousel', card);
    assert.doesNotMatch(markdown, /^1\. /m);
    assert.match(markdown, /- \*\*Machine Learning\*\*/);
  });

  test('rejects more than 12 entries', () => {
    const items = Array.from({ length: 13 }, (_, i) => ({ name: `Item ${i}` }));
    assert.throws(() => aiInteractionService.buildCarousel(null, items), AiInteractionValidationError);
  });
});

test.describe('present_links (consumer-tool-adaptation: link_preview_display_v0)', () => {
  test('rejects a javascript: URL', () => {
    assert.throws(
      () => aiInteractionService.buildLinkPreviews([{ url: 'javascript:alert(1)', title: 'x' }]),
      AiInteractionValidationError,
    );
  });

  test('rejects a data: URL', () => {
    assert.throws(
      () => aiInteractionService.buildLinkPreviews([{ url: 'data:text/html,<script>x</script>', title: 'x' }]),
      AiInteractionValidationError,
    );
  });

  test('rejects a relative URL', () => {
    assert.throws(
      () => aiInteractionService.buildLinkPreviews([{ url: '/admin/delete', title: 'x' }]),
      AiInteractionValidationError,
    );
  });

  test('surfaces the real host separately, so lookalike link text cannot hide it', () => {
    const card = aiInteractionService.buildLinkPreviews([
      { url: 'https://evil.example.com/aicte', title: 'AICTE Official Circular' },
    ]);
    assert.strictEqual(card.links[0].host, 'evil.example.com');
    const markdown = render('present_links', card);
    assert.match(markdown, /\(evil\.example\.com\)/);
  });

  test('always marks the set untrusted, in the data and in the markdown', () => {
    const card = aiInteractionService.buildLinkPreviews([{ url: 'https://example.com', title: 'x' }]);
    assert.strictEqual(card.untrusted, true);
    assert.match(render('present_links', card), /ARCNAVE has not verified these/);
  });
});

test.describe('present_places / present_map (consumer-tool-adaptation: places_*_display_v0)', () => {
  test('a list tolerates a place with no coordinates', () => {
    const card = aiInteractionService.buildPlacesList(null, [{ name: 'Block A' }]);
    assert.strictEqual(card.places[0].latitude, null);
  });

  test('a map does not — it requires coordinates', () => {
    assert.throws(() => aiInteractionService.buildPlacesMap(null, [{ name: 'Block A' }]), AiInteractionValidationError);
  });

  test('rejects out-of-range coordinates', () => {
    assert.throws(
      () => aiInteractionService.buildPlacesMap(null, [{ name: 'X', latitude: 99, longitude: 0 }]),
      AiInteractionValidationError,
    );
  });

  test('renders coordinates only on a map, not in a plain list', () => {
    const place = { name: 'Block A', latitude: 11.0, longitude: 77.0 };
    assert.doesNotMatch(render('present_places', aiInteractionService.buildPlacesList(null, [place])), /\(11, 77\)/);
    assert.match(render('present_map', aiInteractionService.buildPlacesMap(null, [place])), /\(11, 77\)/);
  });
});

test.describe('present_recipe (consumer-tool-adaptation: recipe_display_v0)', () => {
  const ingredients = [{ name: 'Rice', quantity: 5, unit: 'kg' }];

  test('rejects a free-text quantity, which would make rescaling impossible', () => {
    assert.throws(
      () =>
        aiInteractionService.buildRecipe('Pongal', 40, [{ name: 'Rice', quantity: 'a handful', unit: 'kg' }], ['Cook']),
      AiInteractionValidationError,
    );
  });

  test('rejects a non-positive servings count', () => {
    assert.throws(
      () => aiInteractionService.buildRecipe('Pongal', 0, ingredients, ['Cook']),
      AiInteractionValidationError,
    );
  });

  test('keeps quantities numeric so a frontend can rescale them', () => {
    const recipe = aiInteractionService.buildRecipe('Pongal', 40, ingredients, ['Cook']);
    assert.strictEqual(typeof recipe.ingredients[0].quantity, 'number');
    assert.match(render('present_recipe', recipe), /serves 40/);
  });
});

test.describe('present_diagram (consumer-tool-adaptation: visualize:show_widget)', () => {
  const safeSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="#333"/></svg>';

  test('accepts a static allowlisted picture', () => {
    const diagram = aiDiagramService.buildDiagram('Flow', safeSvg);
    assert.strictEqual(diagram.sanitized, true);
    assert.match(render('present_diagram', diagram), /<rect/);
  });

  test('rejects a script element', () => {
    assert.throws(
      () => aiDiagramService.buildDiagram(null, '<svg xmlns="x" viewBox="0 0 1 1"><script>alert(1)</script></svg>'),
      AiDiagramValidationError,
    );
  });

  test('rejects an event handler attribute', () => {
    assert.throws(
      () => aiDiagramService.buildDiagram(null, '<svg xmlns="x" viewBox="0 0 1 1"><rect onload="alert(1)"/></svg>'),
      AiDiagramValidationError,
    );
  });

  test('rejects a mixed-case event handler — the allowlist is not case-tricked', () => {
    assert.throws(
      () => aiDiagramService.buildDiagram(null, '<svg xmlns="x" viewBox="0 0 1 1"><rect OnLoad="alert(1)"/></svg>'),
      AiDiagramValidationError,
    );
  });

  test('rejects foreignObject, the usual SVG-to-HTML escape hatch', () => {
    assert.throws(
      () =>
        aiDiagramService.buildDiagram(
          null,
          '<svg xmlns="x" viewBox="0 0 1 1"><foreignObject><div/></foreignObject></svg>',
        ),
      AiDiagramValidationError,
    );
  });

  test('rejects an external reference via xlink:href', () => {
    assert.throws(
      () =>
        aiDiagramService.buildDiagram(
          null,
          '<svg xmlns="x" viewBox="0 0 1 1"><image xlink:href="https://evil/x.png"/></svg>',
        ),
      AiDiagramValidationError,
    );
  });

  test('rejects url(...) even inside an allowed attribute', () => {
    assert.throws(
      () => aiDiagramService.buildDiagram(null, '<svg xmlns="x" viewBox="0 0 1 1"><rect fill="url(#x)"/></svg>'),
      AiDiagramValidationError,
    );
  });

  test('rejects an ENTITY declaration (billion-laughs / SSRF vector)', () => {
    assert.throws(
      () =>
        aiDiagramService.buildDiagram(
          null,
          '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="x" viewBox="0 0 1 1"/>',
        ),
      AiDiagramValidationError,
    );
  });

  test('rejects a payload hidden in CDATA', () => {
    assert.throws(
      () =>
        aiDiagramService.buildDiagram(
          null,
          '<svg xmlns="x" viewBox="0 0 1 1"><text><![CDATA[<script>x</script>]]></text></svg>',
        ),
      AiDiagramValidationError,
    );
  });

  test('rejects source with no svg root at all', () => {
    assert.throws(() => aiDiagramService.buildDiagram(null, '<rect/>'), AiDiagramValidationError);
  });

  test('rejects oversized source', () => {
    const huge = `<svg xmlns="x" viewBox="0 0 1 1">${'<rect/>'.repeat(5000)}</svg>`;
    assert.throws(() => aiDiagramService.buildDiagram(null, huge), AiDiagramValidationError);
  });
});

test.describe('describe_diagram_constraints (consumer-tool-adaptation: visualize:read_me)', () => {
  test('names the allowlists it actually enforces, not a prose approximation', () => {
    const constraints = aiDiagramService.describeConstraints();
    assert.deepStrictEqual(constraints.allowedElements, Array.from(aiDiagramService.ALLOWED_ELEMENTS).sort());
    assert.deepStrictEqual(constraints.allowedAttributes, Array.from(aiDiagramService.ALLOWED_ATTRIBUTES).sort());
    assert.strictEqual(constraints.maxChars, aiDiagramService.MAX_SVG_CHARS);
    assert.ok(!constraints.allowedElements.includes('script'));
    assert.ok(!constraints.allowedElements.includes('foreignObject'));
  });
});

// F14 (bka/90-appendix/consumer-adaptation-flags.md) — live-reproduced
// 2026-08-26: a real model's gradient-fill SVG failed the allowlist and
// the thrown AiDiagramValidationError ended the whole turn with no
// chance for the model to see why. Fixed by having present_diagram's
// own handler catch it and return a structured result instead — these
// tests assert THAT specifically, not aiDiagramService's own validation
// (already covered above: it must still reject the same inputs).
test.describe('present_diagram tool handler (F14: rejection must not crash the turn)', () => {
  const tool = () => aiToolRegistry.getTool('present_diagram');

  test('an invalid SVG (e.g. the live gradient-fill case) returns a structured rejection, never throws', () => {
    const rejectingSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect fill="url(#gradient1)"/></svg>';
    const result = tool().handler(null, { svg: rejectingSvg }, {});
    assert.deepStrictEqual(result, {
      rejected: true,
      reason: 'diagram rejected: url(...) references are not allowed',
    });
  });

  test('a script-carrying SVG is rejected the same structured way', () => {
    const result = tool().handler(
      null,
      { svg: '<svg xmlns="x" viewBox="0 0 1 1"><script>alert(1)</script></svg>' },
      {},
    );
    assert.strictEqual(result.rejected, true);
    assert.match(result.reason, /not an allowed element/);
  });

  test('a valid diagram still returns the normal buildDiagram shape, unaffected by the catch', () => {
    const validSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="#333"/></svg>';
    const result = tool().handler(null, { svg: validSvg }, {});
    assert.strictEqual(result.sanitized, true);
    assert.ok(!('rejected' in result));
  });

  test('a non-AiDiagramValidationError still propagates — this catch is scoped to that one class only', () => {
    const original = aiDiagramService.buildDiagram;
    aiDiagramService.buildDiagram = () => {
      throw new Error('unrelated crash');
    };
    try {
      assert.throws(() => tool().handler(null, { svg: '<svg xmlns="x" viewBox="0 0 1 1"/>' }, {}), /unrelated crash/);
    } finally {
      aiDiagramService.buildDiagram = original;
    }
  });
});
