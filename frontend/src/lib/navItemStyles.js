import { cn } from './utils';

/**
 * The one selected/hover language for every sidebar list — primary navigation
 * and Recents alike — so "which item am I on?" looks the same everywhere and
 * can be re-tuned in one place.
 *
 * Four states that must stay visibly different from each other:
 *
 *  - **Idle**: no surface, soft ink.
 *  - **Hover**: `hoverline` (#EEF5FB) — a cool step, and deliberately the
 *    lighter of the two surfaces, so passing the pointer over a list never
 *    looks like selecting.
 *  - **Selected**: `active` (#DFEDF5), a weight step to 600, and the label and
 *    icon in `accent`. The surface still does most of the work — no slab, no
 *    pill, no leading bar, no border, no shadow — but the current row now also
 *    reads as *the actionable one*, which is the job teal has everywhere else
 *    in the interface. Two near-identical tinted surfaces alone left the
 *    current route hard to find at a glance on a long menu.
 *  - **Focus**: the global `:focus-visible` teal ring, which sits *outside* the
 *    item, so keyboard focus is never confused with route selection — and a
 *    focused item that is also selected shows both at once.
 *
 * Selection is always derived from the route (plus the explicit workspace
 * mode where the two can disagree), never from a click handler, so it can't go
 * stale after navigating away.
 */

const BASE =
  'group relative flex items-center gap-[10px] w-full h-[34px] px-[10px] rounded-[9px] text-[13.5px] text-left no-underline hover:no-underline transition-colors duration-200';

export function navItemClass(active, extra) {
  return cn(
    BASE,
    active ? 'bg-active text-accent font-[600]' : 'bg-transparent text-ink-soft font-[500] hover:bg-hoverline',
    extra,
  );
}

/**
 * Icons stay subdued and take the accent only on the selected row — the one
 * place in a sidebar list where colour is carrying meaning rather than
 * decorating. Hover firms the tone without colouring it, so hovering still
 * never looks like selecting.
 *
 * The selected icon also gets one short settle (`nav-icon-settle`, 200ms, in
 * `index.css`) and a small hover response. Both are scoped to this one element
 * on purpose: the label, the row, its surface and every non-selected icon stay
 * completely still, and there is no idle loop once the settle has played. The
 * caller keys the icon by route so the settle replays per navigation rather
 * than persisting. Under `prefers-reduced-motion` the global rule drops both
 * transforms and only the colour/surface change remains.
 */
export function navIconClass(active) {
  return cn(
    'transition-transform duration-150 ease-out',
    active ? 'text-accent nav-icon-settle' : 'text-ink-ghost group-hover:text-ink-soft group-hover:scale-[1.08]',
  );
}

/** Recents rows: same selected surface, no indicator — a dense list of them would be noise. */
export function recentItemClass(active, extra) {
  return cn(
    'flex items-center gap-[9px] w-full h-[32px] min-h-[32px] shrink-0 px-[9px] border-0 rounded-[9px] font-sans cursor-pointer text-left overflow-hidden transition-colors duration-200',
    active ? 'bg-active' : 'bg-transparent hover:bg-hoverline',
    extra,
  );
}
