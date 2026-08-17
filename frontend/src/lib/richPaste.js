/**
 * Rich paste — clipboard HTML → ArcNave's canonical Markdown.
 *
 * Every ArcNave composer is a Markdown textarea, so a paste that carries
 * `text/html` used to be thrown away in favour of the flattened `text/plain`
 * copy: bullets became lines, numbering became stray digits, code lost its
 * fence. This module is the one place that conversion happens, for every
 * composer, so no surface can invent its own rules.
 *
 * ## Safety
 * Clipboard HTML is untrusted input — it can come from any page the user
 * visited. Nothing here ever *renders* it: the markup is parsed into an inert
 * document (`DOMParser`, which does not execute scripts or fetch anything) and
 * walked through a strict **allowlist**. An element not on the list contributes
 * only its text; an element on the blocklist contributes nothing at all. No
 * attribute survives except `href` on a link, and only when the URL is an
 * `http(s)`/`mailto` one — so `javascript:`/`data:` links, inline styles,
 * event handlers, tracking pixels, iframes and scripts cannot cross the
 * boundary even as text.
 *
 * ## Fidelity
 * Only formatting the composer's renderer can actually show is preserved;
 * anything else degrades to its text rather than to a marker the user would
 * then have to delete. Plain-text-only clipboards never reach this module.
 */

/** Elements whose content is dropped entirely, not just unwrapped. */
const DROPPED = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'LINK', 'META',
  'HEAD', 'TITLE', 'FORM', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'SVG',
  'VIDEO', 'AUDIO', 'CANVAS', 'MAP', 'AREA', 'TEMPLATE', 'BASE',
]);

/** Only these schemes may survive on a link. */
export function isSafeHref(href) {
  const value = (href ?? '').trim();
  if (!value) return false;
  // Relative URLs are dropped on purpose: pasted out of their origin they
  // point at nothing meaningful here.
  return /^(https?:\/\/|mailto:)/i.test(value);
}

const collapse = (s) => s.replace(/[ \t\r\n]+/g, ' ');
const block = (s) => (s.trim() ? `\n\n${s.trim()}\n\n` : '');

function textOf(node) {
  return node.textContent ?? '';
}

/** `**bold**` / `*italic*` only wrap real content — never whitespace. */
function wrap(inner, marker) {
  const trimmed = inner.trim();
  if (!trimmed) return inner;
  const lead = inner.startsWith(' ') ? ' ' : '';
  const tail = inner.endsWith(' ') ? ' ' : '';
  return `${lead}${marker}${trimmed}${marker}${tail}`;
}

function serializeList(el, ctx) {
  const ordered = el.tagName === 'OL';
  const start = Number(el.getAttribute?.('start')) || 1;
  const indent = '  '.repeat(ctx.depth);
  const items = [];
  let index = start;

  for (const child of el.children) {
    if (child.tagName !== 'LI') continue;
    // A nested list is serialized separately so its own indent applies; the
    // item's own text is everything that is not a nested list.
    const nested = [];
    let inline = '';
    for (const node of child.childNodes) {
      if (node.nodeType === 1 && (node.tagName === 'UL' || node.tagName === 'OL')) {
        nested.push(serializeList(node, { ...ctx, depth: ctx.depth + 1 }));
      } else {
        inline += serialize(node, ctx);
      }
    }
    const marker = ordered ? `${index}. ` : '- ';
    index += 1;
    const body = inline.replace(/\s+/g, ' ').trim();
    items.push(`${indent}${marker}${body}`.trimEnd());
    nested.filter(Boolean).forEach((n) => items.push(n));
  }

  return items.join('\n');
}

function serializeTable(el) {
  const rows = Array.from(el.querySelectorAll('tr'));
  if (!rows.length) return '';
  const cells = (row) =>
    Array.from(row.children)
      .filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
      .map((c) => collapse(textOf(c)).trim().replace(/\|/g, '\\|'));

  const head = cells(rows[0]);
  if (!head.length) return '';
  const out = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  for (const row of rows.slice(1)) {
    const body = cells(row);
    if (body.length) out.push(`| ${body.join(' | ')} |`);
  }
  return out.join('\n');
}

function serializeChildren(node, ctx) {
  let out = '';
  for (const child of node.childNodes) out += serialize(child, ctx);
  return out;
}

function serialize(node, ctx) {
  if (node.nodeType === 3) {
    return ctx.pre ? textOf(node) : collapse(textOf(node));
  }
  if (node.nodeType !== 1) return '';

  const tag = node.tagName;
  if (DROPPED.has(tag)) return '';

  switch (tag) {
    case 'BR':
      return '\n';
    case 'HR':
      return block('---');

    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const level = Number(tag[1]);
      const text = collapse(serializeChildren(node, ctx)).trim();
      return text ? block(`${'#'.repeat(level)} ${text}`) : '';
    }

    case 'P':
    case 'DIV':
    case 'SECTION':
    case 'ARTICLE':
    case 'MAIN':
    case 'HEADER':
    case 'FOOTER':
    case 'DD':
    case 'DT':
    case 'DL':
    case 'FIGURE':
    case 'FIGCAPTION':
      return block(serializeChildren(node, ctx));

    case 'UL':
    case 'OL':
      return block(serializeList(node, ctx));

    case 'BLOCKQUOTE': {
      const inner = serializeChildren(node, ctx).trim();
      if (!inner) return '';
      return block(inner.split('\n').map((line) => `> ${line}`.trimEnd()).join('\n'));
    }

    case 'PRE': {
      const code = textOf(node).replace(/\n+$/, '');
      if (!code.trim()) return '';
      // A fence long enough to survive backticks inside the pasted code.
      const longest = (code.match(/`+/g) ?? []).reduce((n, run) => Math.max(n, run.length), 0);
      const fence = '`'.repeat(Math.max(3, longest + 1));
      return block(`${fence}\n${code}\n${fence}`);
    }

    case 'CODE': {
      if (ctx.pre) return textOf(node);
      const code = collapse(textOf(node)).trim();
      return code ? `\`${code.replace(/`/g, '')}\`` : '';
    }

    case 'STRONG':
    case 'B':
      return wrap(serializeChildren(node, ctx), '**');
    case 'EM':
    case 'I':
      return wrap(serializeChildren(node, ctx), '*');

    case 'A': {
      const inner = serializeChildren(node, ctx);
      const href = node.getAttribute?.('href');
      const text = inner.trim();
      if (!text) return '';
      return isSafeHref(href) ? `[${text}](${href.trim()})` : inner;
    }

    case 'TABLE':
      return block(serializeTable(node));

    // Images arrive through the attachment pipeline, never as markup: a
    // pasted `<img>` here would be a remote URL we neither host nor trust.
    case 'IMG':
      return '';

    default:
      // Anything unrecognised is unwrapped — its text survives, its markup
      // does not.
      return serializeChildren(node, ctx);
  }
}

/** Tidy: no more than one blank line anywhere, no trailing spaces. */
function normalizeMarkdown(md) {
  return md
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Sanitized clipboard HTML → Markdown. Exported for tests; composers use
 * `markdownFromClipboard`.
 */
export function htmlToMarkdown(html) {
  if (!html || typeof DOMParser === 'undefined') return '';
  let doc;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return '';
  }
  if (!doc?.body) return '';
  return normalizeMarkdown(serializeChildren(doc.body, { depth: 0, pre: false }));
}

/** Whitespace-insensitive comparison, for "did the HTML actually add anything?" */
const flatten = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * What a composer should insert for this paste, or `null` to let the browser
 * paste the plain text itself.
 *
 * `null` is returned whenever the conversion gains nothing — a copied
 * paragraph, a code-free sentence, a clipboard with no `text/html` at all — so
 * the ordinary case keeps the browser's own undo stack and caret behaviour
 * rather than routing through us for no reason.
 */
export function markdownFromClipboard(clipboardData) {
  const html = clipboardData?.getData?.('text/html');
  if (!html) return null;

  const markdown = htmlToMarkdown(html);
  if (!markdown) return null;

  const plain = clipboardData.getData('text/plain') ?? '';
  // Same content once whitespace is ignored → the HTML carried no structure
  // worth preserving.
  if (flatten(markdown) === flatten(plain)) return null;

  return markdown;
}
