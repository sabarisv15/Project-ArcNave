import { cn } from '../lib/utils';

/**
 * Shared layout + typography primitives for the Attendance workspace's tab
 * panes, so every pane has the same vertical rhythm, the same heading scale,
 * and the same sticky-header table behavior instead of each route inventing
 * its own.
 *
 * Scroll model (important): a pane never relies on the document/outer
 * container scrolling. The pane itself is a fixed-height flex column; the
 * table inside it owns the only scroll region. That is what lets a table
 * header stay put (`position: sticky; top: 0`) while its rows scroll
 * underneath, and it keeps the rounded container corners intact because the
 * rounding + `overflow-hidden` live on the outer shell, not the scroller.
 */

/**
 * A tab pane: full available height, fixed outer padding, never its own page
 * scroll. Panes deliberately carry no `<h1>`/`<h2>` — the Level 1 (and, in
 * Attendance, Level 2) tab already names the view, so repeating it as a
 * heading would be a duplicated label that costs ~40px of the vertical budget
 * a full 8-period day needs to fit without scrolling.
 */
export const PANE = 'flex-1 min-h-0 flex flex-col overflow-hidden px-[24px] pt-[18px] pb-[20px]';

/** Table column header — 11px semibold, muted but readable. */
export const TABLE_HEAD = 'text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted';

/** Opaque sticky chrome for a scrolling table's column-header row. Rows must never bleed through it. */
export const STICKY_HEAD = 'sticky top-0 z-[46] bg-tint border-b border-line';

/**
 * Rounded table shell: rounding + `overflow-hidden` on the outer element,
 * the single scroll region inside it. `minWidth` keeps column alignment
 * intact on narrow viewports by scrolling horizontally rather than crushing
 * cells.
 */
export function StickyTableShell({ minWidth, children, className, bodyClassName }) {
  return (
    <div className={cn('flex-1 min-h-0 border border-line rounded-[16px] bg-paper overflow-hidden', className)}>
      <div className={cn('h-full overflow-auto scroll-quiet', bodyClassName)}>
        <div style={minWidth ? { minWidth } : undefined}>{children}</div>
      </div>
    </div>
  );
}

/** Quiet empty state used inside a table shell. */
export function TableEmptyState({ title, hint }) {
  return (
    <div className="py-[48px] px-[20px] text-center">
      <div className="text-[13.5px] font-[500] text-ink">{title}</div>
      {hint && <div className="mt-[5px] text-[12px] text-ink-faint">{hint}</div>}
    </div>
  );
}
