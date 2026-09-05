import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { CopyButton } from './ui/CopyButton';
import { MermaidDiagram } from './MermaidDiagram';
import { ErrorBoundary } from './ErrorBoundary';
import { cn } from '../lib/utils';
import { isSafeHref } from '../lib/richPaste';
import { highlightCode, languageFromClassName } from '../lib/codeHighlight';

/**
 * The one renderer for chat prose — assistant replies and structured user
 * messages alike, so a pasted list looks the same going out as it does coming
 * back.
 *
 * ## Hierarchy
 * A reply is body text with emphasis, not a bolded block. Body is 14.5px/400 at
 * 1.4; weight only steps up where it carries meaning — a reply heading
 * (17px/600), a short subheading (14.5px/600), a term or a result. Long
 * sentences are never bolded, so when something *is* bold it still means
 * something.
 *
 * ## Density
 * The rhythm is deliberately tight, because a reply that needs three screens of
 * scrolling to say four things is harder to read, not easier: paragraph gaps
 * are 7px, list items 4px, a heading sits 12px under the block before it and
 * 5px above its own first line. Every gap below comes from that one scale — no
 * component adds its own margin on top of it, and there is no container around
 * any of it: prose sits directly on the chat canvas, and the only quiet
 * surfaces are the ones code and table headers genuinely need.
 *
 * Structure is real structure: `<ul>`/`<ol>` with their own indentation and
 * rhythm, real `<table>`, real `<blockquote>`, real `<code>` — which is also
 * what makes the whole thing legible to a screen reader, where a hand-drawn
 * bullet glyph is just a stray character.
 *
 * No cards, no coloured banners, no thick rules, no "AI" chrome: the quiet
 * neutral surfaces are reserved for code and table headers, which genuinely
 * need to separate from the prose.
 */

function CodeBlock({ children, className }) {
  const code = String(children ?? '').replace(/\n$/, '');
  const lang = languageFromClassName(className);
  // null = not yet highlighted (or a language Shiki couldn't load) — the
  // plain <pre><code> below covers both the loading state and that
  // fallback, so a slow/failed highlight is never a blank block.
  const [html, setHtml] = useState(null);

  useEffect(() => {
    let cancelled = false;
    highlightCode(code, lang).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  return (
    <div className="relative group my-[9px]">
      {html ? (
        // Shiki's own output already includes <pre><code>; only the sizing/
        // scroll chrome this codebase's plain fallback below also uses is
        // layered on top, via the wrapper div — Shiki's inline background/
        // color styles are left as they are, not fought with utility classes.
        <div
          className={cn(
            '[&>pre]:m-0 [&>pre]:p-[10px] [&>pre]:pr-[36px] [&>pre]:rounded-[10px] [&>pre]:overflow-x-auto [&>pre]:scroll-quiet',
            '[&>pre]:font-mono [&>pre]:text-[12.5px] [&>pre]:leading-[1.5] [&>pre]:border [&>pre]:border-line-light',
          )}

          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre
          className={cn(
            'm-0 p-[10px] pr-[36px] rounded-[10px] bg-soft border border-line-light overflow-x-auto scroll-quiet',
            'font-mono text-[12.5px] leading-[1.5] text-ink-soft',
            className,
          )}
        >
          <code>{code}</code>
        </pre>
      )}
      <CopyButton
        getText={() => code}
        label="Copy code"
        size={13}
        className="absolute top-[7px] right-[7px] w-[24px] h-[24px] grid place-items-center border-0 bg-transparent rounded-[6px] text-ink-faint cursor-pointer opacity-0 transition-[opacity,color] duration-200 group-hover:opacity-100 focus-visible:opacity-100 hover:text-ink-soft"
      />
    </div>
  );
}

export const markdownComponents = {
  h1: ({ children }) => (
    <h3 className="mt-[12px] mb-[5px] first:mt-0 text-[17px] font-[600] leading-[1.3] text-ink">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mt-[12px] mb-[5px] first:mt-0 text-[16px] font-[600] leading-[1.3] text-ink">{children}</h3>
  ),
  // h3 and below are subheadings: the same size as body, distinguished by
  // weight alone, so a reply never grows a second title.
  h3: ({ children }) => (
    <h4 className="mt-[12px] mb-[5px] first:mt-0 text-[14.5px] font-[600] leading-[1.35] text-ink-soft">{children}</h4>
  ),
  h4: ({ children }) => (
    <h4 className="mt-[12px] mb-[5px] first:mt-0 text-[14.5px] font-[600] leading-[1.35] text-ink-soft">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="mt-[11px] mb-[5px] first:mt-0 text-[14px] font-[600] text-ink-soft">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="mt-[11px] mb-[5px] first:mt-0 text-[14px] font-[600] text-ink-soft">{children}</h6>
  ),

  p: ({ children }) => <p className="m-0 mb-[7px] last:mb-0 font-[400]">{children}</p>,

  // Real lists with real markers: indentation and rhythm come from the list,
  // not from a bullet character typed into a flex row. Indentation is one step
  // only — a nested list steps in from its parent, not from the column edge.
  ul: ({ children }) => (
    <ul className="my-[7px] first:mt-0 last:mb-0 pl-[18px] list-disc marker:text-ink-ghost flex flex-col gap-[4px]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-[7px] first:mt-0 last:mb-0 pl-[19px] list-decimal marker:text-ink-faint marker:font-[500] flex flex-col gap-[4px]">
      {children}
    </ol>
  ),
  // A list item is one line where the content allows it, so the paragraph
  // margin inside a loose list is suppressed rather than doubling the gap the
  // list already sets.
  li: ({ children }) => (
    <li className="pl-[2px] leading-[1.4] [&>ul]:mt-[4px] [&>ol]:mt-[4px] [&>p]:mb-[4px] [&>p:last-child]:mb-0">
      {children}
    </li>
  ),

  strong: ({ children }) => <strong className="font-[600] text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,

  blockquote: ({ children }) => (
    <blockquote className="my-[8px] pl-[11px] border-l-2 border-line text-ink-muted italic">{children}</blockquote>
  ),

  hr: () => <hr className="my-[12px] border-0 border-t border-line-light" />,

  /*
   * react-markdown 9 dropped the `inline` flag, so the split is done by
   * element instead: a fenced block arrives as `pre > code` and is rendered by
   * `pre` from the code's own text, while `code` only ever renders the inline
   * case — the block path never reaches it, because `pre` doesn't render its
   * children through.
   */
  code: ({ children }) => (
    <code className="px-[5px] py-[1px] rounded-[5px] bg-soft font-mono text-[12.5px] text-ink-soft">{children}</code>
  ),
  pre: ({ children }) => {
    const code = String(children?.props?.children ?? '').replace(/\n$/, '');
    const className = children?.props?.className;
    // ```mermaid fences render as a diagram (P2.2), never as a highlighted
    // code block — a real, product-relevant split, not an inconsistency:
    // Mermaid source is meant to be seen as the diagram it describes, the
    // same way a LaTeX $$block$$ below renders as the formula, not the markup.
    if (languageFromClassName(className) === 'mermaid') {
      return <MermaidDiagram code={code} />;
    }
    return <CodeBlock className={className}>{code}</CodeBlock>;
  },

  // Wide tables scroll in their own container rather than widening the reading
  // column; the header sticks only once that container is actually scrolling.
  table: ({ children }) => (
    <div className="my-[9px] max-h-[320px] overflow-auto scroll-quiet border border-line rounded-[10px]">
      <table className="w-full border-collapse text-[13.5px] leading-[1.45]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="sticky top-0 bg-soft">{children}</thead>,
  th: ({ children }) => (
    <th className="text-left font-[600] text-ink-soft px-[9px] py-[6px] border-b border-line">{children}</th>
  ),
  td: ({ children }) => <td className="px-[9px] py-[6px] border-b border-line-light align-top">{children}</td>,

  a: ({ children, href }) =>
    isSafeHref(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2">
        {children}
      </a>
    ) : (
      // An unsafe or relative URL keeps its text and loses its link — never
      // silently dropped, never navigable.
      <span>{children}</span>
    ),

  img: () => null,
};

export function Markdown({ children, className }) {
  return (
    // Reading scale: 14.5px at 400 with 1.48 leading. The leading is a point
    // looser than the density pass left it — a face change is also a rhythm
    // change, and DM Sans at this size reads better with the extra half-point
    // than the gain of two more visible lines is worth.
    <div className={cn('text-[14.5px] leading-[1.48] font-[400] text-ink-soft', className)}>
      {/* P4 5.12 — remark-math/rehype-katex parse arbitrary AI- or
          user-authored content synchronously during render and can throw on
          malformed LaTeX; this keeps a bad message from blanking the whole
          chat/document pane around it. Keyed on the source itself so a
          different message always gets a fresh render attempt rather than
          staying stuck on a previous one's error. */}
      <ErrorBoundary key={children} label="content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={markdownComponents}
        >
          {children}
        </ReactMarkdown>
      </ErrorBoundary>
    </div>
  );
}
