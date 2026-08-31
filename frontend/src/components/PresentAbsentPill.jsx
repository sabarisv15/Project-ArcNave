import { cn } from '../lib/utils';

/** Two-way Present/Absent control — icon-free but never colour-only (text label carries the state). */
export function PresentAbsentPill({ present, onToggle, disabled, size = 'md' }) {
  const dims = size === 'sm' ? 'h-[22px] text-[10.5px]' : 'h-[26px] text-[11.5px]';
  return (
    <div className={cn('inline-flex shrink-0 overflow-hidden rounded-full border border-line font-[600]', dims)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && !present && onToggle()}
        aria-pressed={present}
        className={cn(
          'px-[10px] transition-colors duration-200',
          present ? 'bg-success-soft text-success' : 'bg-transparent text-ink-faint',
          !disabled && !present && 'hover:bg-tint2 cursor-pointer',
          disabled && 'cursor-default',
        )}
      >
        Present
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && present && onToggle()}
        aria-pressed={!present}
        className={cn(
          'px-[10px] transition-colors duration-200',
          !present ? 'bg-danger-soft text-danger' : 'bg-transparent text-ink-faint',
          !disabled && present && 'hover:bg-tint2 cursor-pointer',
          disabled && 'cursor-default',
        )}
      >
        Absent
      </button>
    </div>
  );
}
