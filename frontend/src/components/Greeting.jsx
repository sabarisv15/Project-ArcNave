import { useEffect, useState } from 'react';
import { ArcNaveVelMark } from './ArcNaveVelMark';
import { cn } from '../lib/utils';

/** One arrival per session, not per render. Home remounts on every navigation
 *  back to it, and an animation that replays each time stops being an arrival
 *  and becomes a tic. */
const LANDED_KEY = 'arcnave.homeMarkLanded';

function alreadyLanded() {
  try {
    return window.sessionStorage.getItem(LANDED_KEY) === '1';
  } catch {
    return false; // storage unavailable — animate, it is only ever cosmetic
  }
}

function markLanded() {
  try {
    window.sessionStorage.setItem(LANDED_KEY, '1');
  } catch {
    /* nothing to do — the animation simply plays again next time */
  }
}

/**
 * The Vel mark and the greeting on the same line — nothing else.
 *
 * Home is the one place the mark renders large, and it renders *inline*: it
 * sits beside the greeting as part of the same line, never stacked above it as
 * a separate block, so the two read as one statement.
 *
 * On the first entry of a session it travels in from slightly off-position and
 * lands — one controlled arrival, ~620ms, no bounce, no spin, no colour flare —
 * and then holds still. It is decorative here (the greeting beside it already
 * says whose workspace this is), so it carries no accessible label and stays
 * out of the reading order; under `prefers-reduced-motion` the global rule in
 * `index.css` drops the travel entirely and it simply is where it belongs.
 */
export function Greeting() {
  // Decided once, on mount, and recorded in an effect — never during render,
  // so a StrictMode double-render can't consume the session's one arrival.
  const [animate] = useState(() => !alreadyLanded());

  useEffect(() => {
    if (animate) markLanded();
  }, [animate]);

  return (
    <>
      <div className="flex items-center justify-center gap-[16px]">
        <ArcNaveVelMark
          size={56}
          state="static"
          className={cn(
            'w-[44px] h-[44px] sm:w-[56px] sm:h-[56px] text-ink-soft',
            animate && 'animate-velTravel motion-reduce:animate-none'
          )}
        />
        <h1 className="m-0 text-[25px] font-[600] tracking-[-.015em]">Good afternoon, Priya.</h1>
      </div>
      <p className="mt-[10px] mb-[26px] text-[14px] text-ink-muted">
        What would you like to work on for your campus today?
      </p>
    </>
  );
}
