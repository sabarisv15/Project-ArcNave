import { useEffect, useRef, useState } from 'react';
import { Sidebar } from './Sidebar';
import { cn } from '../lib/utils';

/**
 * What a *fully* collapsed sidebar leaves behind: a 12px interactive edge
 * strip, not a button bar. It reserves no meaningful workspace width, and the
 * revealed sidebar is an overlay that floats above the workspace rather than
 * pushing it — so collapsing never reflows the content the user is reading.
 *
 * Reveal is by hover or keyboard focus; it closes on pointer-out after a short
 * grace delay, and Escape closes it when unpinned. Pinning (the control in the
 * revealed sidebar's top row) keeps it open for keyboard and touch users, for
 * whom "hover" is not an available gesture.
 *
 * There is deliberately no Back/Forward/collapse control out here — those live
 * in the sidebar's own utility row, which is reachable through this rail.
 */
const CLOSE_DELAY_MS = 220;

export function CollapsedRail() {
  const [revealed, setRevealed] = useState(false);
  const [pinned, setPinned] = useState(false);
  const closeTimer = useRef(null);

  const open = revealed || pinned;

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setRevealed(false), CLOSE_DELAY_MS);
  };

  useEffect(() => cancelClose, []);

  useEffect(() => {
    if (!open || pinned) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setRevealed(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pinned]);

  return (
    <>
      <button
        type="button"
        aria-label="Reveal sidebar"
        title="Sidebar"
        aria-expanded={open}
        onMouseEnter={() => {
          cancelClose();
          setRevealed(true);
        }}
        onMouseLeave={scheduleClose}
        onFocus={() => {
          cancelClose();
          setRevealed(true);
        }}
        onClick={() => setPinned((v) => !v)}
        className="group h-full w-[12px] shrink-0 border-0 p-0 bg-transparent cursor-pointer outline-none"
      >
        <span
          aria-hidden="true"
          className="block h-full w-[4px] mx-auto rounded-full bg-line transition-colors duration-200 group-hover:bg-accent-line group-focus-visible:bg-accent"
        />
      </button>

      {/*
        `fixed` + high z-index: the peek panel must not participate in the app's
        flex row, or revealing it would shift the workspace it is sitting over.
      */}
      <div
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        className={cn(
          'fixed left-[12px] top-[12px] bottom-[12px] z-[90] w-[298px] transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none',
          open ? 'opacity-100 translate-x-0' : 'pointer-events-none opacity-0 -translate-x-[10px]',
        )}
      >
        <div className="h-full rounded-[18px] shadow-pop">
          <Sidebar pinned={pinned} onTogglePin={() => setPinned((v) => !v)} />
        </div>
      </div>
    </>
  );
}
