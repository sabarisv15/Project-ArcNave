import { useEffect, useRef } from 'react';
import { PanelLeftOpen } from 'lucide-react';
import { ME } from '../lib/substituteData';

/**
 * The one-time "how do I get the sidebar back?" hint.
 *
 * Collapsing the rail leaves an 18px edge strip and nothing else, which is
 * quiet by design and undiscoverable by accident. This appears **once**, the
 * first time a given user collapses it — not on login, not per route, and not
 * on any later collapse.
 *
 * Acknowledgement is stored per authenticated user
 * (`sidebarRevealHintAcknowledged:<userId>`), so it cannot follow the wrong
 * person on a shared machine. `localStorage` is the fallback the prototype
 * ships with; the real implementation should read and write this on the user
 * profile, so acknowledging it on a laptop also silences it on a phone. That
 * is why the read is a function rather than an inlined expression — only these
 * two helpers change when the server is wired in.
 */
const KEY_PREFIX = 'arcnave.sidebarRevealHintAcknowledged';
const AUTO_DISMISS_MS = 7000;

function hintKey(userId) {
  return `${KEY_PREFIX}:${userId}`;
}

export function hasAcknowledgedRevealHint(userId = ME.id) {
  try {
    return window.localStorage.getItem(hintKey(userId)) === '1';
  } catch {
    // Private mode or a blocked store: showing the hint once per session is a
    // better failure than crashing, and better than never showing it at all.
    return false;
  }
}

export function acknowledgeRevealHint(userId = ME.id) {
  try {
    window.localStorage.setItem(hintKey(userId), '1');
  } catch {
    /* nothing to persist to — the in-memory flag still suppresses it here */
  }
}

/**
 * A compact anchored tooltip beside the edge trigger. Not a modal and not an
 * overlay: it takes no focus on mount, blocks nothing behind it, and the
 * workspace stays fully interactive while it is up.
 *
 * Wording is about the edge, not about a keystroke, because the edge strip is
 * what is actually on screen. `Got it` is a real button so the hint is
 * reachable and dismissible from the keyboard; Escape closes it too. Auto
 * dismissal after ~7s counts as acknowledgement — a user who read it and moved
 * on should not be told again.
 */
export function SidebarRevealHint({ onDismiss }) {
  // Held in a ref so the auto-dismiss timer never restarts when the parent
  // re-renders, and so a click and the timeout can't both acknowledge.
  const dismissed = useRef(false);

  useEffect(() => {
    const finish = () => {
      if (dismissed.current) return;
      dismissed.current = true;
      acknowledgeRevealHint();
      onDismiss();
    };
    const timer = setTimeout(finish, AUTO_DISMISS_MS);
    const onKey = (e) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [onDismiss]);

  const dismiss = () => {
    if (dismissed.current) return;
    dismissed.current = true;
    acknowledgeRevealHint();
    onDismiss();
  };

  return (
    <div
      role="status"
      className="hidden lg:flex fixed left-[26px] top-[22px] z-[95] items-start gap-[10px] w-[268px] p-[12px] bg-raised border border-line-strong rounded-[14px] shadow-pop animate-fadeUp motion-reduce:animate-none"
    >
      {/* The edge strip, drawn at the size it actually is — a label alone
          doesn't tell you what to look for. */}
      <span
        aria-hidden="true"
        className="flex-none flex items-center gap-[5px] mt-[1px] text-ink-ghost"
      >
        <span className="block w-[3px] h-[22px] rounded-full bg-accent-line" />
        <PanelLeftOpen size={15} strokeWidth={1.8} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="m-0 text-[12.5px] leading-[1.45] text-ink-soft">
          Move to the left edge to open the sidebar.
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="mt-[8px] h-[26px] px-[10px] border border-divider rounded-[8px] bg-transparent font-sans text-[11.5px] font-[500] text-ink-soft cursor-pointer transition-colors duration-200 hover:bg-tint2"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
