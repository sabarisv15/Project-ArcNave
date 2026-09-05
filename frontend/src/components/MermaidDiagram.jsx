import { useEffect, useRef, useState } from 'react';

/**
 * Mermaid diagram rendering (P2.2) — render-only, never executable.
 *
 * `securityLevel: 'strict'` is load-bearing, not a default left alone: it
 * disables Mermaid's own `click`/tooltip interaction directives and HTML
 * labels, which is exactly what keeps a diagram fenced block from ever
 * becoming a script-execution surface inside an LLM-generated chat message
 * (CHECKPOINT.md's own rule for this feature). `mermaid.render` itself
 * returns an SVG string — this component's only job is showing it, the
 * same "trusted output, still handled carefully" posture CodeBlock/Shiki
 * already has for code fences.
 */
let mermaidPromise;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
      return mermaid;
    });
  }
  return mermaidPromise;
}

let diagramCounter = 0;

export function MermaidDiagram({ code }) {
  const [svg, setSvg] = useState(null);
  const [error, setError] = useState(false);
  const idRef = useRef(`mermaid-${(diagramCounter += 1)}`);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    loadMermaid()
      .then((mermaid) => mermaid.render(idRef.current, code))
      .then(({ svg: rendered }) => {
        if (!cancelled) setSvg(rendered);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    // A malformed diagram falls back to the raw source, never a blank gap
    // or a thrown render — the same "never worse than plain text" rule
    // CodeBlock's own highlight-failure fallback follows.
    return (
      <pre className="m-0 p-[10px] rounded-[10px] bg-soft border border-line-light overflow-x-auto text-[12.5px] font-mono text-ink-soft">
        {code}
      </pre>
    );
  }
  if (!svg) {
    return <div className="my-[9px] h-[80px] rounded-[10px] bg-soft border border-line-light animate-pulse" />;
  }

  return (
    <div
      className="my-[9px] flex justify-center overflow-x-auto scroll-quiet"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
