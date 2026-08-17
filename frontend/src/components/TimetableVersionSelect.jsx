import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { FILTER_SURFACE } from './FilterPopover';
import { TIMETABLE_VERSIONS, versionMeta } from '../lib/timetableData';

/**
 * The timetable's version context, shared by the Timetable grid and the
 * Workload view so the two can never show figures from different versions.
 *
 * Naming follows the publication rule exactly: the first approved publication
 * is `Published` and every later one is `Revised v1`, `Revised v2`, … — the
 * original is never relabelled `Revised v0`. Staff get selection only; there
 * is no edit or publish control anywhere in this component.
 */
export function VersionBadge({ versionId, className }) {
  const meta = versionMeta(versionId);
  if (!meta) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[10.5px] font-[500] whitespace-nowrap',
        meta.active ? 'bg-accent-soft text-accent' : 'bg-tint2 text-ink-muted',
        className
      )}
    >
      {meta.label}
    </span>
  );
}

/** Compact version picker — a popover, never a large version-history card. */
export function TimetableVersionSelect({ value, onChange, label = 'Timetable version' }) {
  const meta = versionMeta(value);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`${label} · ${meta?.label}`}
          className="inline-flex items-center gap-[6px] h-[28px] pl-[9px] pr-[7px] border border-line rounded-[9px] bg-paper font-sans text-[11.5px] font-[500] text-ink-soft cursor-pointer transition-colors duration-200 hover:bg-tint2 data-[state=open]:border-accent-line"
        >
          <span className={cn('flex-none w-[6px] h-[6px] rounded-full', meta?.active ? 'bg-accent' : 'bg-ink-disabled')} aria-hidden="true" />
          {meta?.label}
          <ChevronDown size={12} strokeWidth={2} className="text-ink-faint" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className={cn(FILTER_SURFACE, 'p-[5px] w-[228px]')}>
          {TIMETABLE_VERSIONS.map((v) => {
            const on = v.id === value;
            return (
              <Popover.Close asChild key={v.id}>
                <button
                  type="button"
                  onClick={() => onChange(v.id)}
                  className={cn(
                    'flex items-center gap-[8px] w-full px-[9px] py-[7px] border-0 bg-transparent rounded-[10px] font-sans text-left cursor-pointer hover:bg-tint2',
                    on && 'bg-accent-soft hover:bg-accent-soft'
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className={cn('flex items-center gap-[6px] text-[12.5px]', on ? 'text-accent font-[500]' : 'text-ink font-[500]')}>
                      {v.label}
                      {v.active && (
                        <span className="flex-none inline-flex items-center h-[15px] px-[5px] rounded-[5px] bg-accent-soft text-accent text-[9px] font-[600] uppercase tracking-[.04em]">
                          Active
                        </span>
                      )}
                    </span>
                    <span className="block mt-[1px] text-[10.5px] text-ink-faint">
                      Effective from {v.effectiveFrom}
                      {!v.active && ' · view only'}
                    </span>
                  </span>
                  {on && <Check size={13} strokeWidth={2.4} className="flex-none text-accent" aria-hidden="true" />}
                </button>
              </Popover.Close>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
