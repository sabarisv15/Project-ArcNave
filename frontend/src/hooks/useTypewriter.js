import { useEffect, useRef, useState } from 'react';

/**
 * Smooths a streamed reply into a real typing motion instead of the text
 * simply replacing itself on every SSE chunk.
 *
 * The transport (`api/ai.js`'s `streamRequest`) already delivers real
 * per-chunk deltas, but a provider's own chunk size varies — some arrive as
 * a handful of characters, others as a whole sentence at once, which reads
 * as a sudden paste rather than something being written. This decouples
 * *when data arrives* from *when it appears*: `target` grows however the
 * network delivers it, `displayed` catches up to it on every animation
 * frame at a bounded rate, so the reveal stays smooth even across a bursty
 * chunk. Falling behind speeds the catch-up up (a big chunk does not take
 * seconds to reveal); already caught up just idles until more arrives.
 *
 * Only runs while `active` — a message loaded from history, or one whose
 * generation just finished, renders its full text immediately rather than
 * replaying a typewriter effect nobody asked to watch again.
 */
export function useTypewriter(target, { active = true } = {}) {
  const [displayed, setDisplayed] = useState(active ? '' : target);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    if (!active) {
      setDisplayed(target);
      return undefined;
    }
    let frameId;
    const tick = () => {
      setDisplayed((prev) => {
        const full = targetRef.current;
        if (prev.length >= full.length) return prev;
        // Catch up faster the further behind it is, so a large chunk still
        // finishes revealing in a beat rather than a slow crawl.
        const remaining = full.length - prev.length;
        const step = Math.max(2, Math.ceil(remaining / 10));
        return full.slice(0, prev.length + step);
      });
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
    // targetRef carries every update; this loop only needs to know whether
    // it should be running at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return displayed;
}
