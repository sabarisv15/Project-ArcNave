import { cn } from '../lib/utils';

/**
 * Fast | Balanced | Deep — CEO Vertex/Gemini audit #26 (2026-08-30): "in AI
 * Composer enable level switching let user decide". Maps to gemini.js's
 * real GENERATION_CONFIG.thinkingConfig.thinkingLevel values (LOW/MEDIUM/
 * HIGH) — see routes/ai.js's own THINKING_LEVEL_BY_LABEL for the exact
 * mapping sent to the backend. 'fast' (LOW) is this codebase's own
 * existing default, unchanged by this control's addition.
 *
 * Same visual language as ScopeToggle (equal-width segmented buttons,
 * paper-raised active state) — an established design-system pattern
 * extended to a new instance, not a new visual design.
 */
const LABEL = { fast: 'Fast', balanced: 'Balanced', deep: 'Deep' };
const LEVELS = ['fast', 'balanced', 'deep'];

export function ThinkingLevelToggle({ level, onLevel }) {
  const base = 'w-[76px] h-[28px] rounded-[8px] border-0 text-[12.5px] cursor-pointer transition-colors duration-200';
  // `level` is `null` until the user actually clicks a button (P3 1.11 —
  // EMPTY_COMPOSER.thinkingLevel's own comment): displays exactly as
  // before ("Fast" pressed) so this is a zero-visual-change default,
  // even though the real wire value sent to the backend stays `null`
  // (letting the backend auto-pick depth) until a real click happens.
  const displayLevel = level ?? 'fast';
  return (
    <div
      role="group"
      aria-label="Thinking level"
      className="flex items-center gap-[2px] p-[2px] bg-tint2 rounded-[10px]"
    >
      {LEVELS.map((l) => {
        const active = displayLevel === l;
        return (
          <button
            key={l}
            type="button"
            aria-pressed={active}
            onClick={() => onLevel(l)}
            className={cn(
              base,
              active
                ? 'bg-paper text-ink-soft font-[600] shadow-chip'
                : 'bg-transparent text-ink-muted font-[500] hover:text-ink-soft',
            )}
          >
            {LABEL[l]}
          </button>
        );
      })}
    </div>
  );
}
