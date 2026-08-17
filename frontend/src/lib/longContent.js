/**
 * Long pasted/sent content — progressive disclosure, never truncation.
 *
 * A 271-line paste is a legitimate thing to send ArcNave; rendering all 271
 * lines the instant it lands is what makes the page unusable. Everything here
 * is **display only**: the full text is what the composer holds, what is sent,
 * and what reaches the model. Nothing in this module ever shortens the value
 * that leaves the composer.
 */

/** Either threshold trips compact mode — a wall of short lines and one huge
 *  paragraph are both "too much to show at once". */
export const LONG_LINE_COUNT = 24;
export const LONG_CHAR_COUNT = 2500;

/** How much of a long block a settled message shows before "Show more". */
export const MESSAGE_PREVIEW_LINES = 10;

export function countLines(text) {
  if (!text) return 0;
  return text.split('\n').length;
}

export function isLongContent(text) {
  if (!text) return false;
  return countLines(text) > LONG_LINE_COUNT || text.length > LONG_CHAR_COUNT;
}

/**
 * The first `lines` lines, with an unbalanced code fence closed so a preview
 * that lands mid-code-block still renders as code instead of swallowing the
 * rest of the message.
 */
export function previewLines(text, lines = MESSAGE_PREVIEW_LINES) {
  const all = (text ?? '').split('\n');
  const shown = all.slice(0, lines);
  const fences = shown.filter((line) => /^\s*```/.test(line)).length;
  if (fences % 2 === 1) shown.push('```');
  return {
    preview: shown.join('\n'),
    total: all.length,
    remaining: Math.max(all.length - lines, 0),
  };
}

/** "271 lines" / "1 line" — the count a collapsed block states about itself. */
export function lineCountLabel(count) {
  return `${count} ${count === 1 ? 'line' : 'lines'}`;
}

/** "Show 259 more lines" — always the real remainder, never a rounded one. */
export function showMoreLabel(remaining) {
  return `Show ${remaining} more ${remaining === 1 ? 'line' : 'lines'}`;
}
