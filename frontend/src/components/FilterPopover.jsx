import * as Popover from '@radix-ui/react-popover';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { cn } from '../lib/utils';

/** Shared chrome for every ArcNave floating filter surface — popover and select alike. */
export const FILTER_SURFACE =
  'z-[60] bg-raised border border-line-strong rounded-[16px] shadow-pop data-[state=open]:animate-fadeUp motion-reduce:animate-none';

const TOOL =
  'inline-flex items-center gap-[7px] h-[36px] px-[13px] rounded-[11px] font-sans text-[12.5px] cursor-pointer whitespace-nowrap transition-[background-color,border-color,color,transform] duration-200 active:scale-[.985] motion-reduce:active:scale-100';
const TOOL_OFF = 'border border-line bg-paper text-ink-soft font-[500] hover:bg-tint2';
const TOOL_ON = 'border border-accent-line bg-accent-soft text-accent font-[600]';

/**
 * The one ArcNave filter popover. Floating, anchored to its trigger, on the
 * raised paper tone, 16px radius, one quiet hairline, soft restrained shadow,
 * 160-200ms fade+settle
 * (via the shared `fadeUp` keyframe, disabled under prefers-reduced-motion).
 * Click-outside and Escape close are Radix-native — no manual overlay needed.
 * Every multi-field filter panel (Students, Staff, ...) renders through this so no
 * page ships its own dropdown chrome.
 */
const ICON_BTN =
  'relative w-[34px] h-[34px] grid place-items-center rounded-[9px] cursor-pointer transition-colors duration-200';

export function FilterPopover({
  open,
  onOpenChange,
  activeCount = 0,
  label = 'Filters',
  width = 300,
  align = 'start',
  onClear,
  children,
  iconOnly = false,
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        {iconOnly ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={activeCount > 0 ? `${label} · ${activeCount} active` : label}
            title={label}
            className={cn(
              ICON_BTN,
              open || activeCount > 0 ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-tint2',
            )}
          >
            <SlidersHorizontal size={15} strokeWidth={1.9} />
            {activeCount > 0 && (
              <span className="absolute -top-[3px] -right-[3px] min-w-[15px] h-[15px] px-[3px] grid place-items-center rounded-full bg-accent text-white text-[9px] font-[600] leading-none">
                {activeCount}
              </span>
            )}
          </button>
        ) : (
          <button type="button" aria-expanded={open} className={cn(TOOL, open || activeCount > 0 ? TOOL_ON : TOOL_OFF)}>
            <SlidersHorizontal size={15} strokeWidth={1.9} />
            <span>
              {label}
              {activeCount > 0 ? ` · ${activeCount}` : ''}
            </span>
          </button>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={6}
          collisionPadding={16}
          style={{ width }}
          className={cn(FILTER_SURFACE, 'p-[16px] max-h-[min(70vh,560px)] overflow-y-auto')}
        >
          {children}
          {onClear && (
            <>
              <div className="h-px bg-line mt-[14px] mb-[10px]" />
              <button
                type="button"
                disabled={activeCount === 0}
                onClick={onClear}
                className="w-full h-[32px] border-0 bg-transparent rounded-[9px] font-sans text-[12.5px] font-[500] text-ink-muted cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ink-muted"
              >
                Clear filters
              </button>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function FilterFieldLabel({ children }) {
  return <div className="text-[10px] tracking-[.06em] uppercase text-ink-faint mb-[6px]">{children}</div>;
}

export const FILTER_FIELD_INPUT =
  'w-full h-[34px] font-sans text-[12.5px] text-ink bg-paper border border-line rounded-[10px] px-[9px] outline-none transition-colors duration-200 focus-visible:outline-none focus-visible:border-accent-line';

/** Plain labelled field wrapper — used for the numeric range inputs alongside FilterSelect. */
export function FilterField({ label, children }) {
  return (
    <div>
      <FilterFieldLabel>{label}</FilterFieldLabel>
      {children}
    </div>
  );
}

const ALL_VALUE = '__all__';

/**
 * Custom-styled select for filter panels — replaces every native `<select>` so no
 * legacy browser/OS dropdown chrome ever appears inside an ArcNave filter surface.
 * Keyboard nav, typeahead and Escape/outside close all come from Radix Select.
 */
export function FilterSelect({ label, value, onChange, options }) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <div>
      <FilterFieldLabel>{label}</FilterFieldLabel>
      <SelectPrimitive.Root
        value={value === '' ? ALL_VALUE : value}
        onValueChange={(v) => onChange(v === ALL_VALUE ? '' : v)}
      >
        <SelectPrimitive.Trigger
          aria-label={label}
          className="w-full h-[34px] flex items-center justify-between gap-[6px] font-sans text-[12.5px] text-ink bg-paper border border-line rounded-[10px] px-[9px] outline-none cursor-pointer transition-colors duration-200 data-[state=open]:border-accent-line focus-visible:outline-none focus-visible:border-accent-line"
        >
          <SelectPrimitive.Value>{current?.label}</SelectPrimitive.Value>
          <SelectPrimitive.Icon>
            <ChevronDown size={13} strokeWidth={2} className="text-ink-faint" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content position="popper" sideOffset={4} className={cn(FILTER_SURFACE, 'overflow-hidden')}>
            <SelectPrimitive.Viewport className="p-[5px] max-h-[240px]">
              {options.map((o) => (
                <SelectPrimitive.Item
                  key={o.value || ALL_VALUE}
                  value={o.value === '' ? ALL_VALUE : o.value}
                  className="flex items-center justify-between h-[30px] px-[9px] rounded-[8px] font-sans text-[12.5px] text-ink cursor-pointer outline-none select-none data-[highlighted]:bg-tint2 data-[state=checked]:text-accent data-[state=checked]:font-[500]"
                >
                  <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator>
                    <Check size={12} strokeWidth={2.4} className="text-accent" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}
