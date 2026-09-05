import { useEffect, useState } from 'react';
import { useAttendanceStore, TICK_MS } from './attendanceStore';

/**
 * Owns the two things AttendanceProvider used to do with effects, now that
 * the state itself lives in a module-level Zustand store.
 *
 * 1. **Reset on mount.** The provider was mounted only under the
 *    `/curriculum/attendance/*` route tree, so leaving the section and
 *    coming back discarded every draft edit, lock, correction and
 *    substitute request. A module-level store would silently start
 *    persisting all of that across visits. That may well be the nicer
 *    behaviour, but it is a product change, not a refactor, so this keeps
 *    the existing semantics exactly. Making it persist later is now a
 *    one-line deletion here rather than a rewrite.
 *
 * 2. **The 30s clock.** `phaseFor` compares each period against `now`, so
 *    the Locked → submission-window → expired transitions move without a
 *    page reload. The interval lives here (mounted/unmounted with the
 *    section) rather than in the store module, so nothing keeps ticking
 *    after the user has navigated away.
 */
export function useAttendanceLifecycle() {
  // Runs during the FIRST render, not in an effect. That matters: the
  // provider built its fresh state in useState initializers, i.e. before
  // its children ever rendered. Resetting in an effect instead would let
  // the first paint show the previous visit's state and then snap back.
  // A lazy useState initializer is the faithful equivalent, and reset()
  // is idempotent so StrictMode's double-invoke is harmless.
  useState(() => {
    useAttendanceStore.getState().reset();
    return true;
  });

  useEffect(() => {
    const id = setInterval(() => useAttendanceStore.getState().tick(), TICK_MS);
    return () => clearInterval(id);
  }, []);
}
