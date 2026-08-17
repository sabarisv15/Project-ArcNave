import { describe, expect, it } from 'vitest';
import {
  LONG_CHAR_COUNT,
  LONG_LINE_COUNT,
  countLines,
  isLongContent,
  lineCountLabel,
  previewLines,
  showMoreLabel,
} from '../lib/longContent';

const lines = (n, text = 'line') => Array.from({ length: n }, (_, i) => `${text} ${i + 1}`).join('\n');

describe('long content', () => {
  it('treats a short block as ordinary', () => {
    expect(isLongContent(lines(10))).toBe(false);
    expect(isLongContent('')).toBe(false);
  });

  it('trips on line count', () => {
    expect(isLongContent(lines(LONG_LINE_COUNT))).toBe(false);
    expect(isLongContent(lines(LONG_LINE_COUNT + 1))).toBe(true);
  });

  it('trips on character count even in few lines', () => {
    expect(isLongContent('x'.repeat(LONG_CHAR_COUNT + 1))).toBe(true);
  });

  it('states the real line count and the real remainder', () => {
    const text = lines(271);
    expect(countLines(text)).toBe(271);

    const { total, remaining, preview } = previewLines(text, 12);
    expect(total).toBe(271);
    expect(remaining).toBe(259);
    expect(showMoreLabel(remaining)).toBe('Show 259 more lines');
    expect(lineCountLabel(total)).toBe('271 lines');
    // Disclosure, not truncation: the preview is a prefix of the original and
    // the original is untouched.
    expect(text.startsWith(preview)).toBe(true);
  });

  it('closes a code fence left open by the cut', () => {
    const text = ['```js', 'const a = 1;', 'const b = 2;', 'const c = 3;', '```', 'after'].join('\n');
    const { preview } = previewLines(text, 3);
    expect(preview.endsWith('```')).toBe(true);
  });

  it('singularises one line', () => {
    expect(lineCountLabel(1)).toBe('1 line');
    expect(showMoreLabel(1)).toBe('Show 1 more line');
  });
});
