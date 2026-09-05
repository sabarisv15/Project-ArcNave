/**
 * The one line that says what scope everything below it belongs to.
 *
 * Every institutional screen opens with it, and it answers the four questions a
 * seat's screen has to answer before anything else on it means anything: which
 * institution, what scope, which academic year and semester band, and **in what
 * position** the actions below are being taken.
 *
 * It is deliberately a **line, not a card**: it carries no action, competes
 * with nothing, and costs one row of the vertical budget. The seat badge is the
 * same weight as the rest of the row — it names the position an action will be
 * recorded against, which is what an audit line needs; it is not a badge to be
 * proud of.
 *
 * **The title is configured, never derived from a key.** The caller passes the
 * resolved title from `seatTitles.js`, so a college that calls its department
 * seat "Department Head" sees that word and nothing in this component changes.
 * No L-number ever reaches the screen.
 *
 * The three seat-specific headers — `ClassScopeHeader`, `DepartmentScopeHeader`,
 * `InstitutionScopeHeader` — are thin wrappers over this, each keeping its own
 * defaults and prop shape so the screens already built on them are untouched.
 */

import { cn } from '../lib/utils';

/**
 * The scope line sits on a `mist` band — the calm cool field reserved for
 * something that *labels what is under it*. It is what tells the eye, before
 * anything is read, that this row is a boundary statement and not the first
 * row of the content.
 *
 * The band is painted without moving anything: the inline padding is cancelled
 * by an equal negative margin (the pane's own 24px gutter absorbs the 10px
 * bleed), and the vertical padding is taken back out of the 10px bottom margin
 * the line already had. Same box, same rhythm, one more surface.
 */
const BAND = 'px-[10px] py-[6px] mx-[-10px] mt-[-6px] mb-[4px] rounded-[10px] bg-mist';

function Dot() {
  return (
    <span aria-hidden="true" className="text-ink-faint">
      ·
    </span>
  );
}

/**
 * @param parts   Ordered scope segments. `{ label, strong }` — one segment is
 *                the scope's own name and carries the weight; the rest are
 *                context. A null entry is skipped, so the line never grows a
 *                dangling separator.
 * @param year    The academic year label, rendered with its tabular figures.
 * @param band    The active semester band, where the screen is band-scoped.
 * @param title   The configured display title of the seat.
 * @param empty   Copy for the case where the seat has no scope at all.
 */
export function SeatScopeHeader({ parts = [], year, band, title, empty, className }) {
  if (empty) {
    return (
      <div className={cn('flex-none flex items-center gap-[7px] text-[12px] text-ink-muted', BAND, className)}>
        <span>{empty}</span>
      </div>
    );
  }

  const segments = parts.filter(Boolean);

  return (
    <div className={cn('flex-none flex items-center gap-[7px] flex-wrap text-[12px] text-ink-muted', BAND, className)}>
      {segments.map((part, i) => (
        <span key={`${part.label}-${i}`} className="flex items-center gap-[7px]">
          {i > 0 && <Dot />}
          <span className={part.strong ? 'text-ink font-[500]' : undefined}>{part.label}</span>
        </span>
      ))}
      {year && (
        <>
          <Dot />
          <span className="tabular-nums">AY {year}</span>
        </>
      )}
      {band && (
        <>
          <Dot />
          <span>{band}</span>
        </>
      )}
      {title && (
        // A white chip on the mist band, not a second tint on a tint — the two
        // would have merged into one field and the position would have stopped
        // being separately legible.
        <span className="inline-flex items-center h-[19px] px-[7px] rounded-[6px] bg-paper border border-line text-[11px] font-[500] text-ink-soft">
          {title}
        </span>
      )}
    </div>
  );
}
