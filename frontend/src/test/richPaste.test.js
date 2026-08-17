import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, isSafeHref, markdownFromClipboard } from '../lib/richPaste';

/**
 * Two things are being locked here, and they pull against each other: pasted
 * structure has to survive, and pasted *markup* must not. Every case below is
 * one or the other.
 */

const clipboard = (html, text = '') => ({
  getData: (kind) => (kind === 'text/html' ? html : kind === 'text/plain' ? text : ''),
});

describe('clipboard HTML → Markdown', () => {
  it('keeps bulleted lists as real bullets', () => {
    expect(htmlToMarkdown('<ul><li>First</li><li>Second</li></ul>')).toBe('- First\n- Second');
  });

  it('keeps numbered lists numbered', () => {
    expect(htmlToMarkdown('<ol><li>One</li><li>Two</li></ol>')).toBe('1. One\n2. Two');
  });

  it('indents a nested list', () => {
    const md = htmlToMarkdown('<ul><li>Top<ul><li>Inner</li></ul></li></ul>');
    expect(md).toBe('- Top\n  - Inner');
  });

  it('keeps headings, bold and italic', () => {
    expect(htmlToMarkdown('<h2>Title</h2>')).toBe('## Title');
    expect(htmlToMarkdown('<p><b>bold</b> and <i>italic</i></p>')).toBe('**bold** and *italic*');
  });

  it('keeps inline code and code blocks', () => {
    expect(htmlToMarkdown('<p>run <code>npm test</code></p>')).toBe('run `npm test`');
    expect(htmlToMarkdown('<pre><code>const a = 1;\nconst b = 2;</code></pre>')).toBe(
      '```\nconst a = 1;\nconst b = 2;\n```'
    );
  });

  it('keeps block quotes', () => {
    expect(htmlToMarkdown('<blockquote><p>Quoted line</p></blockquote>')).toBe('> Quoted line');
  });

  it('keeps paragraphs separated and line breaks intact', () => {
    expect(htmlToMarkdown('<p>One</p><p>Two</p>')).toBe('One\n\nTwo');
    expect(htmlToMarkdown('<p>One<br>Two</p>')).toBe('One\nTwo');
  });

  it('keeps a safe link and drops an unsafe one to plain text', () => {
    expect(htmlToMarkdown('<a href="https://example.org">Docs</a>')).toBe('[Docs](https://example.org)');
    expect(htmlToMarkdown('<a href="javascript:alert(1)">Docs</a>')).toBe('Docs');
    expect(isSafeHref('data:text/html,<script>')).toBe(false);
  });

  it('drops scripts, iframes, styles and every attribute', () => {
    const md = htmlToMarkdown(
      '<div style="color:red" onclick="steal()"><script>steal()</script>' +
        '<iframe src="https://evil.test"></iframe><p class="x">Safe text</p></div>'
    );
    expect(md).toBe('Safe text');
    expect(md).not.toMatch(/script|iframe|onclick|style/i);
  });

  it('drops pasted images — they belong to the attachment pipeline', () => {
    expect(htmlToMarkdown('<p>Look <img src="https://evil.test/pixel.gif"></p>')).toBe('Look');
  });

  it('converts a table to a GFM table', () => {
    const md = htmlToMarkdown('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>');
    expect(md).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
  });
});

describe('what a composer should insert', () => {
  it('returns null when the clipboard carries no HTML', () => {
    expect(markdownFromClipboard(clipboard('', 'just text'))).toBeNull();
  });

  it('returns null when the HTML adds nothing over the plain text', () => {
    expect(markdownFromClipboard(clipboard('<p>just text</p>', 'just text'))).toBeNull();
  });

  it('returns Markdown when the HTML carried real structure', () => {
    const md = markdownFromClipboard(clipboard('<ul><li>a</li><li>b</li></ul>', 'a\nb'));
    expect(md).toBe('- a\n- b');
  });
});
