import { cn } from '../lib/utils';

/**
 * One shared elevated surface for the composer + its secondary contextual
 * strip (e.g. today's schedule) — a single border/shadow, not two stacked cards.
 */
export function ComposerWorkspaceGroup({ children, className }) {
  return (
    <div
      className={cn(
        'w-full flex flex-col gap-[9px] p-[10px] rounded-[22px] border border-line bg-paper shadow-composer',
        className
      )}
    >
      {children}
    </div>
  );
}
