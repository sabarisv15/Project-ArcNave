import { useEffect, useRef } from 'react';
import { Maximize2, X } from 'lucide-react';
import { ME } from '../lib/substituteData';

/**
 * The once-a-day "Curriculum reads better full screen" hint.
 *
 * Curriculum pages are tables, timetables and rosters — they want the width
 * the sidebar is holding. Saying so is worth one small prompt and never more
 * than that, so this appears the **first time in a calendar day** a user moves
 * into Curriculum, and not again that day however many Curriculum items they
 * open. A new day is a new session in practice, so the offer is made again
 * then rather than never.
 *
 * Acknowledgement is keyed per user *and* per date
 * (`curriculumFullscreenHint:<userId>:YYYY-MM-DD`) so it cannot follow the
 * wrong person on a shared machine and cannot carry across days.
 * `localStorage` is the prototype's store; a real implementation writes this
 * on the user profile, which is why the read and the write are two functions
 * rather than inlined expressions.
 *
 * The date is the **local** calendar date, not UTC — "today" is the user's
 * day, and an ISO timestamp would flip the hint back on mid-evening for
 * anyone east of Greenwich.
 */
const KEY_PREFIX = 'arcnave.curriculumFullscreenHint';

function today(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function hintKey(userId, date) {
  return `${KEY_PREFIX}:${userId}:${date}`;
}

export function hasSeenCurriculumHintToday(userId = ME.id, date = today()) {
  try {
    return window.localStorage.getItem(hintKey(userId, date)) === '1';
  } catch {
    // Private mode or a blocked store: showing it once per session is a better
    // failure than crashing, and better than never showing it at all.
    return false;
  }
}

export function markCurriculumHintSeen(userId = ME.id, date = today()) {
  try {
    window.localStorage.setItem(hintKey(userId, date), '1');
  } catch {
    /* nothing to persist to — the in-memory flag still suppresses it here */
  }
}

/**
 * A compact anchored popover, not an onboarding modal: no scrim, no focus
 * trap, nothing behind it disabled. The page stays fully interactive while it
 * is up, and ignoring it entirely is a valid way to use it.
 *
 * It is a `dialog` with an accessible name and description because it carries
 * a real action; focus moves to `Go full screen` on mount so the whole thing
 * is operable from the keyboard the moment it appears, and Escape dismisses it
 * exactly as `Not now` does. Every route out of it — the primary action, `Not
 * now`, the close icon, Escape — counts as seen for the rest of the day.
 */
export function CurriculumFullscreenHint({ onGoFullScreen, onDismiss }) {
  // A ref, so a click and a keypress can never both settle the hint, and so a
  // parent re-render cannot re-arm it.
  const settled = useRef(false);
  const primaryRef = useRef(null);

  const settle = (fullScreen) => {
    if (settled.current) return;
    settled.current = true;
    markCurriculumHintSeen();
    if (fullScreen) onGoFullScreen();
    onDismiss();
  };

  useEffect(() => {
    primaryRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') settle(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `settle` is stable for the life of this mount (guarded by the ref).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="dialog"
      aria-labelledby="curriculum-fullscreen-hint-title"
      aria-describedby="curriculum-fullscreen-hint-body"
      className={[
        // Anchored beside the Curriculum toggle on desktop, and to the top of
        // the workspace on narrow screens where the rail is a drawer.
        'fixed z-[95] left-[16px] top-[16px] lg:left-[292px] lg:top-[84px]',
        'w-[268px] p-[12px] bg-raised border border-line-strong rounded-[14px] shadow-pop',
        'animate-fadeUp motion-reduce:animate-none',
      ].join(' ')}
    >
      <div className="flex items-start gap-[9px]">
        <span
          aria-hidden="true"
          className="flex-none grid place-items-center w-[24px] h-[24px] mt-[1px] rounded-[8px] bg-surface text-accent"
        >
          <Maximize2 size={14} strokeWidth={1.9} />
        </span>

        <div className="min-w-0 flex-1">
          <p
            id="curriculum-fullscreen-hint-title"
            className="m-0 text-[12.5px] font-[600] leading-[1.35] text-ink-soft"
          >
            Use Curriculum in full-screen mode
          </p>
          <p
            id="curriculum-fullscreen-hint-body"
            className="mt-[3px] mb-0 text-[12px] leading-[1.45] text-ink-muted"
          >
            For the best experience, use Curriculum pages in full-screen mode.
          </p>

          <div className="flex items-center gap-[6px] mt-[10px]">
            <button
              ref={primaryRef}
              type="button"
              onClick={() => settle(true)}
              className="h-[26px] px-[10px] border-0 rounded-[8px] bg-accent font-sans text-[11.5px] font-[600] text-white cursor-pointer transition-colors duration-200 hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            >
              Go full screen
            </button>
            <button
              type="button"
              onClick={() => settle(false)}
              className="h-[26px] px-[8px] border-0 bg-transparent rounded-[8px] font-sans text-[11.5px] font-[500] text-ink-muted cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            >
              Not now
            </button>
          </div>
        </div>

        <button
          type="button"
          aria-label="Dismiss full-screen tip"
          title="Dismiss"
          onClick={() => settle(false)}
          className="flex-none w-[22px] h-[22px] grid place-items-center border-0 bg-transparent rounded-[7px] text-ink-ghost cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        >
          <X size={14} strokeWidth={1.9} />
        </button>
      </div>
    </div>
  );
}
