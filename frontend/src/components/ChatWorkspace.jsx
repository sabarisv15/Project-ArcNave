import { cn } from '../lib/utils';
import { JumpToLatest } from './JumpToLatest';

/**
 * The one ArcNave chat-based workspace shell — normal chat, Project chat, and
 * Artifact chat all render through this same hierarchy:
 *   ChatWorkspace > ChatHeader (see ChatHeader.jsx), ChatTranscriptScrollArea, ChatComposerDock
 * Route-specific content varies inside each slot; the layout behavior never does.
 * No page-level h-screen — height comes entirely from the flex chain up to AppShell.
 */
export function ChatWorkspace({ children, className }) {
  // `chat-workspace` is the hook `index.css` uses to run the island's bottom
  // edge out to the app area on chat routes only — see the rule there. Every
  // other workspace keeps the rounded island untouched.
  return <div className={cn('chat-workspace flex-1 min-h-0 flex flex-col animate-viewIn', className)}>{children}</div>;
}

/**
 * The dominant, primary scroll region. Only this area scrolls — the header and
 * composer dock stay fixed in place. A single readable column, not a card.
 *
 * The gap between messages is 14px and the region ends flush against the
 * composer — no bottom padding, no trailing spacer: a chat is read in long
 * passes, and what makes that hard is not dense text but a short measure with
 * big empty bands between turns.
 *
 * The column sits **left**, not centred: a centred column pays for its
 * symmetry twice, once on each side, and on a wide viewport that is most of
 * the workspace spent on nothing.
 *
 * The gutter that holds it off the edge grows with the viewport instead of
 * staying fixed — 14px on a phone, 56px maximised. A single small value reads
 * as generous on a 375px screen and as "the text is stuck to the wall" on a
 * 1920px one, which is the whole reason this is a scale and not a number.
 * `CHAT_GUTTER` is that scale, shared by the transcript and the composer dock
 * so the two can never drift apart.
 */
export const CHAT_GUTTER =
  'pl-[14px] pr-[16px] sm:pl-[24px] sm:pr-[24px] lg:pl-[40px] lg:pr-[32px] 2xl:pl-[56px] 2xl:pr-[40px]';

export function ChatTranscriptScrollArea({ scrollRef, onScroll, columnClass = 'max-w-[780px]', children }) {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      // `font-chat` is set once, here: everything the transcript renders —
      // both message roles, prose, lists, tables, the actions row — inherits
      // the reading face from this one element rather than asking for it.
      className={cn('flex-1 min-h-0 overflow-y-auto scroll-quiet font-chat pt-[12px] pb-0', CHAT_GUTTER)}
    >
      <div className={cn('mr-auto flex flex-col gap-[14px]', columnClass)}>{children}</div>
    </div>
  );
}

/**
 * Bottom-docked composer, shrink-0, never a second floating panel. Exactly one
 * shared AIComposer instance renders inside this slot on every chat route.
 *
 * No top padding: the composer sits directly under the last line of the
 * transcript, so the only thing between the conversation and the input is the
 * composer's own surface. Its gutter and alignment match the transcript's
 * exactly — the composer has to sit under the column it belongs to, not
 * beside it.
 */
export function ChatComposerDock({ showJump, onJumpToLatest, columnClass = 'max-w-[780px]', children }) {
  return (
    <div className={cn('shrink-0 relative pt-0 pb-[12px]', CHAT_GUTTER)}>
      {showJump && <JumpToLatest onClick={onJumpToLatest} />}
      <div className={cn('mr-auto', columnClass)}>{children}</div>
    </div>
  );
}
