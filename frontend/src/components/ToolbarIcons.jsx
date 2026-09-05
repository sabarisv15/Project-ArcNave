import { useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ArrowUpDown, Check, Search, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { FILTER_SURFACE } from './FilterPopover';

const ICON_BTN =
  'w-[34px] h-[34px] grid place-items-center rounded-[9px] cursor-pointer transition-colors duration-200 text-ink-soft hover:bg-tint2';

/**
 * Icon-first search — a compact 34px button that reveals an inline expanding
 * field on click, instead of a permanently wide input competing with the
 * page's main content for space. Closes back to icon-only when empty and
 * blurred.
 */
export function SearchPopoverField({ value, onChange, placeholder, ariaLabel }) {
  const [open, setOpen] = useState(!!value);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        aria-label={ariaLabel || 'Search'}
        title="Search"
        onClick={() => setOpen(true)}
        className={ICON_BTN}
      >
        <Search size={15} strokeWidth={1.9} />
      </button>
    );
  }

  return (
    <div className="relative flex-1 min-w-[160px] max-w-[280px]">
      <input
        ref={inputRef}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (!value) setOpen(false);
        }}
        placeholder={placeholder}
        className="w-full h-[34px] pl-[32px] pr-[28px] border border-line rounded-[9px] bg-paper font-sans text-[12.5px] text-ink outline-none transition-[border-color,box-shadow] duration-200 focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]"
      />
      <span className="absolute left-[9px] top-0 bottom-0 flex items-center text-ink-ghost pointer-events-none">
        <Search size={14} strokeWidth={1.9} />
      </span>
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange('');
            setOpen(false);
          }}
          className="absolute right-[6px] top-0 bottom-0 flex items-center text-ink-faint hover:text-ink"
        >
          <X size={13} strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}

/** Compact icon-only sort popover — a 34px trigger, never a wide "Sort: X" text button. */
export function SortIconPopover({ options, value, onChange, label = 'Sort' }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          aria-expanded={open}
          className={cn(ICON_BTN, open && 'bg-accent-soft text-accent')}
        >
          <ArrowUpDown size={15} strokeWidth={1.9} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className={cn(FILTER_SURFACE, 'p-[5px] min-w-[180px]')}>
          {options.map((opt) => {
            const on = opt.key === value;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  onChange(opt.key);
                  setOpen(false);
                }}
                className={cn(
                  'flex items-center justify-between w-full h-[32px] px-[10px] border-0 bg-transparent rounded-[10px] font-sans text-[12.5px] cursor-pointer text-left hover:bg-tint2',
                  on ? 'text-accent font-[600]' : 'text-ink-soft font-[500]',
                )}
              >
                <span>{opt.label}</span>
                {on && <Check size={13} strokeWidth={2.2} className="text-accent" />}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The one compact header row a pane gets: `leading` on the left, then
 * search · sort · filter and the quiet result count on the right.
 *
 * `leading` exists so the left half of this row is not dead space. A toolbar
 * whose whole content is pinned right leaves a band of empty white across the
 * top of every table, which reads as a missing heading rather than as
 * restraint — so whatever the pane would otherwise have said above itself is
 * said here, on the same 34px line as the controls, instead of costing a
 * second row.
 */
export function IconToolbar({ children, leading, resultCount }) {
  return (
    <div className="flex items-center gap-[6px] flex-wrap mb-[12px]">
      {leading}
      <div className="flex-1" />
      {resultCount && (
        <span aria-live="polite" className="text-[11.5px] text-ink-faint whitespace-nowrap mr-[2px]">
          {resultCount}
        </span>
      )}
      {children}
    </div>
  );
}
