'use strict';

// Unit tests for markdownInline.js — the shared bold/italic/heading-level/
// horizontal-rule/stray-HTML parsing markdownPdfGenerator.js and
// markdownDocxGenerator.js both now use. Live-caught gap: an AI-generated
// resume PDF printed **bold**, a #### sub-heading, a --- divider, and a
// stray <br> as literal characters instead of rendering them.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  stripStrayHtml,
  isHorizontalRule,
  matchHeading,
  matchBullet,
  parseInlineSegments,
  stripInlineMarkers,
} = require('../src/generators/markdownInline');

test('parseInlineSegments: **bold** becomes a bold segment, not literal asterisks', () => {
  const segments = parseInlineSegments('Skills: **Customer Coordination** and more');
  const bold = segments.find((s) => s.bold && !s.italic);
  assert.ok(bold, 'expected a bold-only segment');
  assert.equal(bold.text, 'Customer Coordination');
  assert.ok(!segments.some((s) => s.text.includes('**')), 'no raw ** should survive in any segment');
});

test('parseInlineSegments: *italic* becomes an italic segment', () => {
  const segments = parseInlineSegments('This is *important* text');
  const italic = segments.find((s) => s.italic && !s.bold);
  assert.ok(italic);
  assert.equal(italic.text, 'important');
});

test('parseInlineSegments: ***bold italic*** becomes one bold+italic segment', () => {
  const segments = parseInlineSegments('***urgent***');
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0], { text: 'urgent', bold: true, italic: true });
});

test('parseInlineSegments: a leading markdown bullet "* " is not read as italic', () => {
  const segments = parseInlineSegments('* **Customer & Service Operations:** Coordination');
  // The bullet marker and its following space must survive as plain text,
  // not be swallowed into an (incorrectly opened) italic run.
  assert.equal(segments[0].text, '* ');
  assert.equal(segments[0].bold, false);
  assert.equal(segments[0].italic, false);
});

test('parseInlineSegments: plain text with no markers returns one untouched segment', () => {
  const segments = parseInlineSegments('Coimbatore, Tamil Nadu');
  assert.deepEqual(segments, [{ text: 'Coimbatore, Tamil Nadu', bold: false, italic: false }]);
});

test('stripInlineMarkers: removes ** wrapping a heading without leaving asterisks', () => {
  assert.equal(
    stripInlineMarkers('**Senior Executive — Financial Services**'),
    'Senior Executive — Financial Services',
  );
});

test('matchHeading: recognizes H1 through H6, capped at level 3', () => {
  assert.deepEqual(matchHeading('# Title'), { level: 1, text: 'Title' });
  assert.deepEqual(matchHeading('### Sub'), { level: 3, text: 'Sub' });
  assert.deepEqual(matchHeading('#### Senior Executive'), { level: 3, text: 'Senior Executive' });
  assert.deepEqual(matchHeading('###### Deepest'), { level: 3, text: 'Deepest' });
});

test('matchHeading: a non-heading line returns null', () => {
  assert.equal(matchHeading('Not a heading, just #hashtag mid-sentence'), null);
  assert.equal(matchHeading('plain text'), null);
});

test('isHorizontalRule: recognizes ---, ***, ___ (3+, optionally spaced) on their own line', () => {
  assert.ok(isHorizontalRule('---'));
  assert.ok(isHorizontalRule('***'));
  assert.ok(isHorizontalRule('___'));
  assert.ok(isHorizontalRule('- - - -'));
});

test('isHorizontalRule: ordinary text, including a single dash, is not a rule', () => {
  assert.equal(isHorizontalRule('- bullet item'), false);
  assert.equal(isHorizontalRule('a - b'), false);
  assert.equal(isHorizontalRule(''), false);
});

test('stripStrayHtml: removes <br>/<br/>/<br /> but leaves the rest of the line untouched', () => {
  assert.equal(stripStrayHtml('signature line<br>'), 'signature line');
  assert.equal(stripStrayHtml('<br/>before'), 'before');
  assert.equal(stripStrayHtml('no tags here'), 'no tags here');
});

test('matchBullet: recognizes -/*/+ markers and returns the text after the marker', () => {
  assert.deepEqual(matchBullet('* Customer Coordination'), { text: 'Customer Coordination' });
  assert.deepEqual(matchBullet('- Root cause investigation'), { text: 'Root cause investigation' });
  assert.deepEqual(matchBullet('+ Follow-up management'), { text: 'Follow-up management' });
});

test('matchBullet: a bullet marker followed by bold text keeps the bold markers for the caller to parse', () => {
  assert.deepEqual(matchBullet('* **Customer & Service Operations:** Coordination'), {
    text: '**Customer & Service Operations:** Coordination',
  });
});

test('matchBullet: ordinary text with no marker returns null', () => {
  assert.equal(matchBullet('Not a bullet, just text'), null);
  assert.equal(matchBullet(''), null);
});
