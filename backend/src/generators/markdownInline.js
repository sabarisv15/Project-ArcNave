'use strict';

// Shared inline-markdown handling for markdownPdfGenerator.js and
// markdownDocxGenerator.js. Both generators used to do their own
// (identical, and identically incomplete) line-by-line parsing —
// H1-H3-only headings, no bold/italic, no horizontal rule, no stray-HTML
// handling — so a live-caught document (an AI-generated PDF with a
// #### sub-heading, **bold** labels, a --- divider, and a stray <br>)
// printed every one of those markers as literal characters instead of
// being rendered. Kept in one place so the two generators' behavior here
// can never drift apart again.

// A handful of raw HTML tags AI-authored markdown sometimes leaves in
// (most commonly <br>/<br/> as a spacing hint) — stripped rather than
// printed literally. Not a general HTML sanitizer: only the line-break
// self-closing tag, never anything with attributes or content.
const STRAY_HTML_BREAK = /<br\s*\/?>/gi;

function stripStrayHtml(line) {
  return line.replace(STRAY_HTML_BREAK, '');
}

// '---', '***', '___' (3+ of the same character, optionally spaced) on
// its own line — GFM horizontal rule. Checked by the caller BEFORE the
// generic non-blank-line branch so it never falls through and prints as
// literal dashes.
const HR_LINE = /^([-*_])( *\1){2,}$/;

function isHorizontalRule(line) {
  return HR_LINE.test(line.trim());
}

// H1-H6 (CommonMark's own range) — the old H1-H3-only regex silently
// dropped heading treatment for a level-4+ heading (this codebase's own
// AI output uses #### for sub-section titles), printing the hash
// characters literally instead of failing loud. Capped visually at
// whichever 3 sizes the caller already defines for levels 1-3; 4-6 render
// at the smallest (level 3) size — still a real heading, never literal
// hash characters.
const HEADING_LINE = /^(#{1,6})\s+(.*)$/;

function matchHeading(line) {
  const m = line.match(HEADING_LINE);
  if (!m) return null;
  return { level: Math.min(m[1].length, 3), text: m[2] };
}

// Inline **bold**, *italic*, and ***bold italic*** (checked longest-marker
// -first so *** isn't mis-split into a bold run followed by a stray
// leftover marker). Underscore emphasis (_italic_) is deliberately NOT
// supported — unlike *, a bare underscore inside an ordinary word
// (file_name, 12_34) is common in this app's real content and would
// falsely italicize mid-word; asterisk emphasis has no such collision.
// An opening `*` must not be followed by whitespace and a closing `*`
// must not be preceded by whitespace (CommonMark's own flanking rule,
// simplified) — this is what keeps a markdown bullet's leading "* " from
// being misread as the start of an italic run.
const INLINE_TOKEN = /(\*\*\*)(\S(?:.*?\S)?)\1|(\*\*)(\S(?:.*?\S)?)\3|(\*)(\S(?:.*?\S)?)\5/g;

function parseInlineSegments(text) {
  const segments = [];
  let lastIndex = 0;
  INLINE_TOKEN.lastIndex = 0;
  let match = INLINE_TOKEN.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), bold: false, italic: false });
    }
    if (match[1]) {
      segments.push({ text: match[2], bold: true, italic: true });
    } else if (match[3]) {
      segments.push({ text: match[4], bold: true, italic: false });
    } else {
      segments.push({ text: match[6], bold: false, italic: true });
    }
    lastIndex = INLINE_TOKEN.lastIndex;
    match = INLINE_TOKEN.exec(text);
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), bold: false, italic: false });
  }
  return segments.length ? segments : [{ text, bold: false, italic: false }];
}

// Headings are already rendered bold/large by the caller — this just
// removes the emphasis markers from a heading's own text (e.g. a source
// line of "#### **Senior Executive**") without needing per-run styling.
function stripInlineMarkers(text) {
  return parseInlineSegments(text)
    .map((s) => s.text)
    .join('');
}

// A GFM bullet-list item: "-"/"*"/"+" then whitespace then the item text.
// Checked AFTER isHorizontalRule by the caller (a bare "- - - -" line
// matches this shape too) — this module doesn't own that ordering itself
// since the caller already runs the heading/hr checks first. Live-caught
// gap: a resume's skill/experience bullets used a literal leading "* ",
// which used to print as a literal asterisk character instead of a bullet
// — the same live document that had the bold/heading/hr/br bugs above.
const BULLET_LINE = /^ {0,3}[-*+]\s+(.*)$/;

function matchBullet(line) {
  const m = line.match(BULLET_LINE);
  return m ? { text: m[1] } : null;
}

module.exports = {
  stripStrayHtml,
  isHorizontalRule,
  matchHeading,
  matchBullet,
  parseInlineSegments,
  stripInlineMarkers,
};
