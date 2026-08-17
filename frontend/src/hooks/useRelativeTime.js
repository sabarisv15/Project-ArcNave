import { useEffect, useState } from 'react';
import { relativeTime } from '../lib/messageTime';

/**
 * The relative timestamp on a message, kept current without churning renders.
 *
 * One interval for the whole app, not one per message: a long transcript can
 * hold fifty timestamps, and fifty independent timers waking at fifty
 * different moments would re-render fifty components out of step for a label
 * that changes once a minute. Instead a single 30s tick publishes a shared
 * `now`, every subscriber recomputes from the same instant, and a message
 * whose label has not actually changed bails out of its state update — so the
 * common case (an hour-old message reading "1 hr ago") costs nothing after the
 * first render.
 *
 * 30s rather than 60s because the boundaries are the point: "Just now" should
 * become "1 min ago" within a few seconds of being wrong, not up to a minute
 * later.
 */

const TICK_MS = 30_000;

const subscribers = new Set();
let timer = null;

function publish() {
  const now = Date.now();
  subscribers.forEach((fn) => fn(now));
}

function subscribe(fn) {
  subscribers.add(fn);
  // The interval exists only while something is watching it.
  if (!timer) timer = setInterval(publish, TICK_MS);
  return () => {
    subscribers.delete(fn);
    if (!subscribers.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useRelativeTime(iso) {
  const [label, setLabel] = useState(() => relativeTime(iso));

  useEffect(() => {
    setLabel(relativeTime(iso));
    // `setLabel` with an unchanged string is a no-op in React, so a tick that
    // doesn't move the label doesn't re-render the message.
    return subscribe((now) => setLabel(relativeTime(iso, now)));
  }, [iso]);

  return label;
}
