import { useCallback, useRef, useState } from 'react';
import { FolderKanban, MessageCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { recentItemClass } from '../lib/navItemStyles';

/** Slow enough to actually read — the point is legibility, not motion. */
const MARQUEE_PX_PER_SECOND = 26;
/** A beat before it starts, so passing the pointer across the list stays still. */
const MARQUEE_DELAY_MS = 400;

/**
 * Single-line row — normal chats and project chats are quietly but clearly
 * different. A singular conversation reads as `MessageCircle`: at 15px the
 * rounded outline is unmistakably a conversation, where the previous squared
 * bubble was easy to confuse with the document and note glyphs beside it.
 *
 * ## The truncated title
 * The label truncates with a real ellipsis and, **only when it is genuinely
 * truncated**, walks its overflow into view on hover so the rest can be read
 * without opening the chat. Three things that decision depends on:
 *
 *  - Truncation is measured (`scrollWidth > clientWidth`), never guessed from
 *    character count — a title that already fits must not move at all, and a
 *    proportional font makes length a bad proxy for width.
 *  - It travels exactly its own overflow and stops. No loop, no bounce, no
 *    return trip: this is a reveal, not an attract animation, and a sidebar of
 *    them cycling would be unreadable.
 *  - Duration is derived from distance at a fixed speed, so a slightly long
 *    title takes a moment and a very long one takes proportionally longer —
 *    both read at the same pace.
 *
 * The row never changes size, the sidebar never reflows, and the full name is
 * always available as the native tooltip and accessible name regardless. Under
 * `prefers-reduced-motion` the walk is skipped entirely and that tooltip is the
 * whole affordance.
 */
export function RecentChatItem({ chat, active, onClick }) {
  const isProject = chat.kind === 'project';
  const Icon = isProject ? FolderKanban : MessageCircle;

  const labelRef = useRef(null);
  const textRef = useRef(null);
  const [run, setRun] = useState(null); // { distance, durationMs } | null

  const start = useCallback(() => {
    const track = labelRef.current;
    const text = textRef.current;
    if (!track || !text) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    // The overflow is the *text's* full width against the track that clips it —
    // the track's own scrollWidth is no longer a proxy for it, because the
    // ellipsis now lives on the text element and holds it to the track's width.
    const distance = text.scrollWidth - track.clientWidth;
    if (distance <= 1) return; // it already fits — leave it alone
    setRun({ distance, durationMs: Math.round((distance / MARQUEE_PX_PER_SECOND) * 1000) });
  }, []);

  const stop = useCallback(() => setRun(null), []);

  return (
    <button
      type="button"
      title={chat.title}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      onPointerEnter={start}
      onPointerLeave={stop}
      onFocus={start}
      onBlur={stop}
      className={recentItemClass(active)}
    >
      <span className={cn('shrink-0 flex items-center', isProject || active ? 'text-accent' : 'text-ink-faint')}>
        <Icon size={15} strokeWidth={1.75} />
      </span>
      {/*
        The selected surface carries the state; the label stays at the same
        weight as its neighbours, so selecting an item in a long Recents list
        never makes the whole column reflow.

        The track takes every pixel the row has left (`flex-1 min-w-0`) and
        clips; the text inside it is one nowrap line held to the track's width,
        so a long title runs to the row's right margin and ends in a real
        ellipsis instead of wrapping to a second line or being cut mid-glyph.
        The ellipsis has to sit on the text element itself: `text-overflow`
        never applies to an overflowing inline-block child, which is why the
        truncation used to read as a hard clip.
      */}
      <span
        ref={labelRef}
        className="flex-1 min-w-0 text-[12.8px] font-[500] leading-[32px] text-ink whitespace-nowrap overflow-hidden"
      >
        <span
          ref={textRef}
          className={cn(
            'block max-w-full whitespace-nowrap will-change-transform motion-reduce:!transform-none motion-reduce:!transition-none',
            // The ellipsis is the resting state and has to be gone while the
            // text walks, or the reveal would slide out from behind a "…".
            run ? 'overflow-visible text-clip' : 'overflow-hidden text-ellipsis'
          )}
          style={
            run
              ? {
                  transform: `translateX(-${run.distance}px)`,
                  transition: `transform ${run.durationMs}ms linear ${MARQUEE_DELAY_MS}ms`,
                }
              : { transform: 'none', transition: 'transform 180ms ease-out' }
          }
        >
          {chat.title}
        </span>
      </span>
    </button>
  );
}
