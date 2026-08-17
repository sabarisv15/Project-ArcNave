import { AlertCircle, Check } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * The one autosave indicator. Deliberately tiny and text-first, sitting in the
 * form's own action rail: entering data must never produce a toast per save,
 * and a save must never take over the screen with a spinner.
 *
 * Three states, one line each — `Saving…`, `Saved`, and a failure that is
 * calm but actionable ("Couldn't save — Retry"). Failure keeps the retry
 * affordance next to the work, because the draft is still there to retry with.
 */
export function AutosaveStatus({ status, savedAt, onRetry, className }) {
  if (status === 'error') {
    return (
      <span className={cn('inline-flex items-center gap-[5px] text-[11px] text-danger', className)} role="status">
        <AlertCircle size={12} strokeWidth={2.2} aria-hidden="true" />
        <span>Couldn’t save.</span>
        <button
          type="button"
          onClick={onRetry}
          aria-label="Retry saving"
          className="border-0 bg-transparent p-0 font-sans text-[11px] font-[500] text-danger underline underline-offset-2 cursor-pointer"
        >
          Retry
        </button>
      </span>
    );
  }

  if (status === 'saving') {
    return (
      <span className={cn('text-[11px] text-ink-faint', className)} aria-live="polite">
        Saving…
      </span>
    );
  }

  if (status === 'saved' || savedAt) {
    return (
      <span className={cn('inline-flex items-center gap-[4px] text-[11px] text-ink-faint', className)} aria-live="polite">
        <Check size={11} strokeWidth={2.4} className="text-accent" aria-hidden="true" />
        Saved
      </span>
    );
  }

  return null;
}

/**
 * One quiet line, shown only when a local draft was actually recovered. Never a
 * modal: recovering the user's own unsent input is the expected behaviour, and
 * interrupting them to announce it would defeat the point.
 */
export function DraftRestoredNote({ show, className }) {
  if (!show) return null;
  return (
    <span className={cn('text-[11px] font-[500] text-accent', className)} role="status">
      Draft restored
    </span>
  );
}
