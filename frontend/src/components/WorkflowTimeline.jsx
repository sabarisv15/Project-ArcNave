import { cn } from '../lib/utils';

/**
 * Where a request has got to, and what is left.
 *
 * A status word on its own ("Pending") answers only half the question — pending
 * *on whom*, after what, before what. The timeline is the other half, and it is
 * the same shape whether the request was approved yesterday or is sitting on
 * this seat right now, so a decided request reads as a finished version of the
 * thing the user was looking at, not a different screen.
 *
 * Steps carry who and when where those are known. A step that has not happened
 * yet carries neither, and says nothing rather than guessing.
 */

const DOT = {
  done: 'bg-accent border-accent',
  current: 'bg-paper border-accent',
  pending: 'bg-paper border-line',
};

function when(at) {
  if (!at) return null;
  return at.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function WorkflowTimeline({ steps }) {
  return (
    <ol className="m-0 p-0 list-none">
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={step.label} className="relative flex gap-[10px] pb-[12px] last:pb-0">
            {/* The connector stops at the last step rather than trailing into nothing. */}
            {!last && (
              <span aria-hidden="true" className="absolute left-[4px] top-[13px] bottom-[1px] w-px bg-line" />
            )}
            <span
              aria-hidden="true"
              className={cn('relative z-[1] flex-none w-[9px] h-[9px] mt-[4px] rounded-full border', DOT[step.state])}
            />
            <span className="min-w-0">
              <span
                className={cn(
                  'block text-[12.5px]',
                  step.state === 'pending' ? 'text-ink-faint' : 'text-ink',
                  step.state === 'current' && 'font-[600]'
                )}
              >
                {step.label}
              </span>
              {(step.at || step.by) && (
                <span className="block mt-[1px] text-[11.5px] text-ink-faint">
                  {[step.by, when(step.at)].filter(Boolean).join(' · ')}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
