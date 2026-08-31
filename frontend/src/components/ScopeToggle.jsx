import { cn } from '../lib/utils';

/**
 * Research | Curriculum — what used to be Ask/Act (read vs write). Redefined:
 * this now controls how broad the AI is allowed to be, not whether it can
 * write. Research is a pure open-domain assistant (research, new tech,
 * subject knowledge — no ARCNAVE tool ever offered to the model, see
 * aiService.js's own GENERAL_CHAT_SYSTEM_PROMPT comment). Curriculum is the
 * unchanged, Policy-Gate-scoped campus assistant — same behavior this
 * toggle already had under its old name. Equal width/height, compact, never
 * dominant — unchanged visual language from the toggle this replaces.
 *
 * Label only — the wire-level mode value stays 'general' (ADL-045).
 */
const LABEL = { general: 'Research', curriculum: 'Curriculum' };

export function ScopeToggle({ mode, onMode }) {
  const base = 'w-[92px] h-[28px] rounded-[8px] border-0 text-[12.5px] cursor-pointer transition-colors duration-200';
  return (
    <div
      role="group"
      aria-label="Composer scope"
      className="flex items-center gap-[2px] p-[2px] bg-tint2 rounded-[10px]"
    >
      {['general', 'curriculum'].map((m) => {
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
                ? // Raised, not coloured: the active option lifts onto `paper`
                  // behind a hairline shadow and keeps the primary ink. Teal in a
                  // low-emphasis group would read as the composer's send action.
                  'bg-paper text-ink-soft font-[600] shadow-chip'
                : 'bg-transparent text-ink-muted font-[500] hover:text-ink-soft',
            )}
          >
            {LABEL[m]}
          </button>
        );
      })}
    </div>
  );
}
