import { ArrowDown } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * Back to the newest message.
 *
 * An icon and nothing else. The control appears only while the reader is away
 * from the bottom of a transcript, which is exactly the moment a labelled pill
 * floating over the conversation is at its most intrusive — a down arrow says
 * the same thing in a fifth of the space, and the label survives as the tooltip
 * and the accessible name. It sits on the quiet sky-blue surface rather than a
 * paper button, so it reads as chrome belonging to the composer beneath it.
 */
export function JumpToLatest({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Jump to latest"
      title="Jump to latest"
      className={cn(
        'absolute -top-[36px] left-1/2 -translate-x-1/2 z-[5]',
        'w-[30px] h-[30px] grid place-items-center rounded-full',
        'border border-line bg-surface text-accent shadow-jump cursor-pointer',
        'transition-colors duration-200 hover:bg-hoverline',
      )}
    >
      <ArrowDown size={15} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
