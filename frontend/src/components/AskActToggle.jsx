import { cn } from '../lib/utils';

/** Ask | Act — exactly equal width and height, compact, never dominant. */
export function AskActToggle({ mode, onMode }) {
  const base =
    'w-[60px] h-[28px] rounded-[8px] border-0 text-[12.5px] cursor-pointer transition-colors duration-200';
  return (
    <div role="group" aria-label="Composer mode" className="flex items-center gap-[2px] p-[2px] bg-tint2 rounded-[10px]">
      {['ask', 'act'].map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            aria-pressed={active}
            onClick={() => onMode(m)}
            className={cn(
              base,
              active
                // Raised, not coloured: the active option lifts onto `paper`
                // behind a hairline shadow and keeps the primary ink. Teal in a
                // low-emphasis group would read as the composer's send action.
                ? 'bg-paper text-ink-soft font-[600] shadow-chip'
                : 'bg-transparent text-ink-muted font-[500] hover:text-ink-soft'
            )}
          >
            {m === 'ask' ? 'Ask' : 'Act'}
          </button>
        );
      })}
    </div>
  );
}
