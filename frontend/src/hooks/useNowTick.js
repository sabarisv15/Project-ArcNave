import { useEffect, useState } from 'react';

/** A local 1-second clock, only ticking while `enabled` — used for the live marking-window countdown so the rest of the page doesn't re-render every second. */
export function useNowTick(enabled, intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return undefined;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
  return now;
}
