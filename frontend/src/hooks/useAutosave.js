import { useCallback, useEffect, useRef, useState } from 'react';
import { clearDraft, readDraft, writeDraft } from '../lib/draftStore';

/**
 * The one autosave primitive every editable ArcNave surface uses.
 *
 * What it guarantees, and why each piece exists:
 *
 * - **Debounced saves.** Text fields settle at 600ms, mark-entry cells at
 *   400ms — long enough not to save every keystroke, short enough that an
 *   accidental close almost never has anything left to flush.
 * - **Flush on close.** `flush()` runs the pending save immediately. Drawers
 *   call it before they close (backdrop, Escape, close button, route change),
 *   so "I clicked outside and lost everything" is structurally impossible.
 * - **A local fallback that outlives the request.** The value is mirrored into
 *   `sessionStorage` on every change and only cleared once the server accepts
 *   it. A failed or offline save therefore leaves a recoverable draft, and
 *   reopening the same record restores it.
 * - **Ordering.** Each save carries a monotonic sequence number; a slower
 *   earlier response can never mark a newer edit as saved, and can never
 *   clear a draft that has since moved on.
 *
 * It deliberately saves **drafts only**. Lock, Submit, Publish, Send and
 * Delete stay explicit user actions — nothing in here can trigger them.
 */

export const TEXT_DEBOUNCE_MS = 600;
export const CELL_DEBOUNCE_MS = 400;

/**
 * @param {object}   opts
 * @param {any}      opts.value      current editable value (serialisable)
 * @param {Function} opts.onSave     (value) => void | Promise — persists the draft
 * @param {string}   [opts.storageKey] sessionStorage key for the local fallback
 * @param {number}   [opts.delay]    debounce window
 * @param {boolean}  [opts.enabled]  false parks autosave entirely (e.g. published/locked records)
 * @param {boolean}  [opts.keepLocalDraft] keep the local mirror after a successful
 *        save. Set for forms whose content has no home until an explicit action
 *        takes it (a request being composed, a name being typed) — for those the
 *        session mirror *is* the draft, so clearing it on save would throw away
 *        exactly what reopening is supposed to restore. Left false where a store
 *        already holds the draft (attendance, marks, notes), so the mirror is
 *        only a fallback for a save that never landed.
 */
export function useAutosave({
  value,
  onSave,
  storageKey,
  delay = TEXT_DEBOUNCE_MS,
  enabled = true,
  keepLocalDraft = false,
}) {
  // 'idle' | 'saving' | 'saved' | 'error'
  const [status, setStatus] = useState('idle');
  const [savedAt, setSavedAt] = useState(null);

  const valueRef = useRef(value);
  const onSaveRef = useRef(onSave);
  const timer = useRef(null);
  const seq = useRef(0);
  const acked = useRef(0);
  const dirty = useRef(false);

  valueRef.current = value;
  onSaveRef.current = onSave;

  const run = useCallback(async () => {
    if (!enabled || !dirty.current) return;
    const mine = (seq.current += 1);
    const snapshot = valueRef.current;
    setStatus('saving');
    try {
      await onSaveRef.current(snapshot);
      // A slower earlier response must not overwrite a newer one's outcome.
      if (mine < acked.current) return;
      acked.current = mine;
      dirty.current = false;
      setSavedAt(new Date());
      setStatus('saved');
      // The store now holds it, so the fallback has done its job — unless this
      // form has no other home for its draft (see `keepLocalDraft`).
      if (storageKey && !keepLocalDraft) clearDraft(storageKey);
    } catch {
      if (mine < acked.current) return;
      acked.current = mine;
      setStatus('error'); // draft stays in sessionStorage, and stays dirty for retry
    }
  }, [enabled, storageKey, keepLocalDraft]);

  /**
   * Mirror locally *after* the render that carries the new value. Writing it
   * inside `schedule()` would capture the pre-edit value, because the handler
   * that calls it runs before React re-renders — which quietly made every
   * restored draft one keystroke stale.
   */
  useEffect(() => {
    if (!enabled || !dirty.current || !storageKey) return;
    writeDraft(storageKey, value);
  }, [value, enabled, storageKey]);

  // Called by the surface on every edit: mirror locally straight away, so the
  // fallback is in place while the debounce is still counting down, then
  // schedule the real save.
  const schedule = useCallback(() => {
    if (!enabled) return;
    dirty.current = true;
    // Mirror what is known right now, so there is a fallback even for a
    // surface that schedules without a value change; the effect above
    // immediately replaces it with the post-render value.
    if (storageKey) writeDraft(storageKey, valueRef.current);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      run();
    }, delay);
  }, [delay, enabled, run, storageKey]);

  /** Run any pending save now — used by drawer close, unmount and route change. */
  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    return run();
  }, [run]);

  const retry = useCallback(() => flush(), [flush]);

  /** Called after an explicit action (Submit/Publish/Send) has taken the data. */
  const markClean = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    dirty.current = false;
    setStatus('idle');
    if (storageKey) clearDraft(storageKey);
  }, [storageKey]);

  // Unmount is the last chance: flush whatever is pending. The local mirror is
  // already written, so even a save that never lands is recoverable.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        if (dirty.current) run();
      }
    },
    [run],
  );

  return { status, savedAt, schedule, flush, retry, markClean };
}

/**
 * Reads a local draft once, when a form opens. Returns the stored value and a
 * `restored` flag so the surface can show one quiet "Draft restored" label —
 * never a modal, because a recovered draft is the expected case, not an error.
 */
export function useRestoredDraft(storageKey, open) {
  const [restored, setRestored] = useState(null);
  const lastKey = useRef(null);

  useEffect(() => {
    if (!open || !storageKey) return;
    if (lastKey.current === storageKey) return;
    lastKey.current = storageKey;
    setRestored(readDraft(storageKey));
  }, [open, storageKey]);

  useEffect(() => {
    if (!open) lastKey.current = null;
  }, [open]);

  return restored;
}
