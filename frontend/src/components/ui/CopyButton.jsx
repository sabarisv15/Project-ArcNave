import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * The one copy affordance in ArcNave.
 *
 * Every copy control in the app — a reply, a sent message, a code block, an
 * email in a table, a report cell — behaves identically, because "did that
 * work?" is the same question everywhere and it deserves the same answer:
 * the icon becomes a check, the accessible name becomes "Copied", it holds
 * for about a second and a half, and then it goes back. That is the whole
 * feedback.
 *
 * Two things it deliberately does not do:
 *
 *  - **No success toast.** A toast for a copy is a notification about
 *    something the user just did, on purpose, and watched happen. It steals
 *    the corner of the screen for a fact already visible under the cursor.
 *  - **No silent failure.** A clipboard write can be refused (insecure
 *    context, permissions, an older browser). The icon returns to Copy
 *    immediately and one short line is announced politely — never a modal,
 *    never a toast queue.
 *
 * `useCopyState` is exported for the cases that already own their button's
 * geometry and only need the behaviour.
 */

/** Long enough to register, short enough that the control is ready again. */
const HOLD_MS = 1600;

export function useCopyState({ getText, holdMs = HOLD_MS } = {}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    const text = typeof getText === 'function' ? getText() : getText;
    clearTimeout(timer.current);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(String(text ?? ''));
      setFailed(false);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), holdMs);
    } catch {
      // Straight back to the resting icon: a control stuck mid-state is worse
      // than one that plainly says it didn't work.
      setCopied(false);
      setFailed(true);
      timer.current = setTimeout(() => setFailed(false), 4000);
    }
  }, [getText, holdMs]);

  return { copied, failed, copy };
}

/**
 * Icon-only copy control. `label` names what is being copied ("Copy response")
 * and is what the accessible name returns to once the confirmation has passed.
 */
export function CopyButton({ getText, label = 'Copy', size = 14, className, holdMs }) {
  const { copied, failed, copy } = useCopyState({ getText, holdMs });

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : label}
        title={copied ? 'Copied' : label}
        // `copied` last, so the confirmation colour wins over whatever resting
        // tone the caller's own class set.
        className={cn('transition-colors duration-200', className, copied && 'text-accent')}
      >
        {/* The swap is a straight exchange, not a cross-fade: at 14px a
            dissolve between two line glyphs reads as a smudge. The colour
            change is what carries the transition, and reduced motion has
            nothing to disable. */}
        {copied ? (
          <Check size={size} strokeWidth={2} aria-hidden="true" />
        ) : (
          <Copy size={size} strokeWidth={1.8} aria-hidden="true" />
        )}
      </button>
      <CopyFailureNote failed={failed} />
    </>
  );
}

/** The polite, visually quiet failure line. Rendered only when it has something to say. */
export function CopyFailureNote({ failed, className }) {
  return (
    <span role="status" aria-live="polite" className={cn('sr-only', className)}>
      {failed ? 'Copy failed. Your browser blocked clipboard access.' : ''}
    </span>
  );
}
