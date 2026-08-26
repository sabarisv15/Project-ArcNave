'use strict';

// AI Diagram Service — the ARCNAVE-safe form of the consumer platform's
// `visualize:show_widget`.
//
// That tool renders model-authored SVG **or HTML, with <script> allowed**,
// inline in the chat surface. Ported as-is that is a stored-XSS primitive
// in a multi-tenant product: the SVG is authored by an LLM whose input
// includes untrusted uploaded-document text and untrusted web-search
// results (CLAUDE.md rule 9), and it would render inside an authenticated
// session belonging to a principal or HOD.
//
// So the adaptation keeps the capability and drops the execution surface:
//
//   - SVG only. No HTML mode at all.
//   - An element allowlist, not a blocklist. Anything not named is
//     removed. `<script>`, `<foreignObject>`, `<use>`, `<image>`,
//     `<animate>`, `<set>`, `<a>` are all simply not on it.
//   - An attribute allowlist per the same principle, so no `on*` handler
//     can exist regardless of casing or spelling.
//   - No external references of any kind: no `href`/`xlink:href`,
//     no `url(...)`, no `@import`, no external entity declarations.
//
// The result is a static picture. It cannot fetch, cannot execute, and
// cannot phone home — the three things a rendered-in-chat artifact must
// not do when its author is a language model reading untrusted input.
//
// Presentation-only, like aiInteractionService.js: no repository, no
// tenant dimension, nothing to look up. It is a Business Service so tool
// registration still satisfies CLAUDE.md rule 1.

class AiDiagramValidationError extends Error {}

const MAX_SVG_CHARS = 20000;
const MAX_TITLE_CHARS = 120;

// Structural/shape elements and text. Deliberately excludes every
// element that can load, execute, or reference anything.
const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc',
  'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path',
  'text', 'tspan',
  'marker', 'linearGradient', 'radialGradient', 'stop',
]);

// Presentation attributes only. No `href`, no `xlink:*`, no `on*`, no
// `style` (which can carry `url(...)`), no `class`/`id` (nothing in a
// static picture needs to be targetable from outside it).
const ALLOWED_ATTRIBUTES = new Set([
  'viewBox', 'width', 'height', 'xmlns', 'preserveAspectRatio',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'd', 'points', 'transform',
  'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray',
  'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style',
  'text-anchor', 'dominant-baseline', 'dx', 'dy',
  'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform',
  'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits',
]);

// Checked against the whole document before parsing, so a payload hidden
// in a comment, a CDATA block, or an entity declaration is caught even
// though the element walk below would never reach it.
const FORBIDDEN_PATTERNS = [
  [/<!ENTITY/i, 'entity declarations are not allowed'],
  [/<!DOCTYPE/i, 'DOCTYPE declarations are not allowed'],
  [/<\?/, 'processing instructions are not allowed'],
  [/<!\[CDATA\[/i, 'CDATA sections are not allowed'],
  [/javascript:/i, 'javascript: URLs are not allowed'],
  [/data:/i, 'data: URLs are not allowed'],
  [/@import/i, '@import is not allowed'],
  [/url\s*\(/i, 'url(...) references are not allowed'],
];

function assertNoForbiddenPatterns(svg) {
  FORBIDDEN_PATTERNS.forEach(([pattern, message]) => {
    if (pattern.test(svg)) throw new AiDiagramValidationError(`diagram rejected: ${message}`);
  });
}

// A deliberately small, strict tokenizer rather than a real XML parser:
// the accepted language here is a static picture, so anything the
// tokenizer cannot make sense of is a rejection, not a parse recovery.
// Comments are stripped first (they cannot carry markup that matters
// once FORBIDDEN_PATTERNS has already run over the raw text).
//
// Both patterns are built fresh per call rather than held at module
// scope. A `/g` regex carries mutable `lastIndex`, and every rejection
// here is a throw out of the middle of an `exec` loop — a shared
// instance would be left mid-string, so the NEXT diagram would be
// scanned from an arbitrary offset and its opening tags never
// inspected. That is a validator that silently stops validating after
// its first rejection; caught by the mixed-case/foreignObject tests.
const TAG_SOURCE = '<\\/?([A-Za-z][A-Za-z0-9:-]*)((?:[^<>"\']|"[^"]*"|\'[^\']*\')*)\\/?>';
const ATTRIBUTE_SOURCE = '([A-Za-z_:][A-Za-z0-9_:.-]*)\\s*=\\s*("[^"]*"|\'[^\']*\')';

function assertAttributesAllowed(rawAttributes, tagName) {
  const attributePattern = new RegExp(ATTRIBUTE_SOURCE, 'g');
  let attributeMatch = attributePattern.exec(rawAttributes || '');
  while (attributeMatch !== null) {
    const [, attributeName] = attributeMatch;
    if (!ALLOWED_ATTRIBUTES.has(attributeName)) {
      throw new AiDiagramValidationError(`diagram rejected: attribute ${JSON.stringify(attributeName)} is not allowed on <${tagName}>`);
    }
    attributeMatch = attributePattern.exec(rawAttributes || '');
  }
}

function assertElementsAndAttributes(svg) {
  const withoutComments = svg.replace(/<!--[\s\S]*?-->/g, '');
  const tagPattern = new RegExp(TAG_SOURCE, 'g');
  let sawSvgRoot = false;
  let match = tagPattern.exec(withoutComments);
  while (match !== null) {
    const [, tagName, rawAttributes] = match;
    if (!ALLOWED_ELEMENTS.has(tagName)) {
      throw new AiDiagramValidationError(`diagram rejected: <${tagName}> is not an allowed element`);
    }
    if (tagName === 'svg') sawSvgRoot = true;
    assertAttributesAllowed(rawAttributes, tagName);
    match = tagPattern.exec(withoutComments);
  }
  if (!sawSvgRoot) throw new AiDiagramValidationError('diagram rejected: no <svg> root element found');
}

function buildDiagram(title, svg) {
  const cleanTitle = title && typeof title === 'string' && title.trim()
    ? title.trim().slice(0, MAX_TITLE_CHARS)
    : null;
  if (typeof svg !== 'string' || !svg.trim()) {
    throw new AiDiagramValidationError('svg is required and must be a non-empty string');
  }
  if (svg.length > MAX_SVG_CHARS) {
    throw new AiDiagramValidationError(`svg must be at most ${MAX_SVG_CHARS} characters`);
  }
  const trimmed = svg.trim();
  assertNoForbiddenPatterns(trimmed);
  assertElementsAndAttributes(trimmed);
  return { title: cleanTitle, svg: trimmed, sanitized: true };
}

// describe_diagram_constraints — `visualize:read_me`'s ARCNAVE form.
// The consumer tool loads design constraints before a widget is built;
// here the constraints that matter are the security ones, because a
// model that does not know the allowlist wastes a whole turn producing
// an SVG that gets rejected. Returning them as data (rather than
// burying them in the tool description) is the same move the tool
// catalogue made for schemas: the model asks, instead of guessing.
function describeConstraints() {
  return {
    format: 'svg',
    maxChars: MAX_SVG_CHARS,
    allowedElements: Array.from(ALLOWED_ELEMENTS).sort(),
    allowedAttributes: Array.from(ALLOWED_ATTRIBUTES).sort(),
    forbidden: [
      'script, foreignObject, use, image, animate, set, a — and every other element not listed above',
      'every on* event handler attribute',
      'style attributes, class and id',
      'href and xlink:href — no external or internal references',
      'url(...), @import, data: URLs, javascript: URLs',
      'DOCTYPE, ENTITY, CDATA, processing instructions',
    ],
    guidance: 'Draw a static picture only: shapes, paths and text. Inline every colour as a fill or '
      + 'stroke attribute. Give the root <svg> a viewBox so it scales. If a diagram needs an icon, draw '
      + 'it as paths — no image can be referenced or embedded.',
  };
}

module.exports = {
  AiDiagramValidationError,
  MAX_SVG_CHARS,
  ALLOWED_ELEMENTS,
  ALLOWED_ATTRIBUTES,
  buildDiagram,
  describeConstraints,
};
