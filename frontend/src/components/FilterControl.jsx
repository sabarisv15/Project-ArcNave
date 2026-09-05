import * as Popover from '@radix-ui/react-popover';
import { ListFilter } from 'lucide-react';
import { cn } from '../lib/utils';

/** Icon-only filter opening a Radix popover of options with a check on the active one. */
export function FilterControl({ options, value, onChange, label = 'Filter', size = 'sm', width = 186, icon }) {
  const dim = size === 'sm' ? 'w-[26px] h-[26px] rounded-[7px]' : 'w-[32px] h-[32px] rounded-[9px]';
  const iconSize = size === 'sm' ? 15 : 17;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'grid place-items-center border-0 bg-transparent cursor-pointer transition-colors duration-200 hover:bg-accent-soft hover:text-accent',
            size === 'sm' ? 'text-ink-faint' : 'text-ink-muted',
            dim,
          )}
        >
          {icon ?? <ListFilter size={iconSize} strokeWidth={1.9} />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          style={{ width }}
          className="z-[60] p-[5px] bg-raised border border-line-strong rounded-[12px] shadow-pop data-[state=open]:animate-fadeUp motion-reduce:animate-none"
        >
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              role="menuitem"
              onClick={() => onChange(opt)}
              className="flex items-center justify-between w-full h-[30px] px-[9px] border-0 bg-transparent rounded-[8px] font-sans text-[12.5px] text-ink cursor-pointer text-left hover:bg-tint2"
            >
              <span>{opt}</span>
              <span className="text-accent text-[12px]">{value === opt ? '✓' : ''}</span>
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
