import { Search } from 'lucide-react';
import { IconButton } from './ui/IconButton';
import { cn } from '../lib/utils';

/** Icon-only search that reveals a compact input on click (never permanently shown). */
export function SearchControl({ open, onToggle, value, onChange, label = 'Search', size = 'sm' }) {
  const dim = size === 'sm' ? 'w-[26px] h-[26px] rounded-[7px]' : 'w-[32px] h-[32px] rounded-[9px]';
  const icon = size === 'sm' ? 15 : 17;
  return (
    <IconButton
      label={label}
      tooltip={label}
      onClick={onToggle}
      aria-expanded={open}
      className={cn(dim, size === 'lg' && 'text-ink-muted')}
    >
      <Search size={icon} strokeWidth={1.9} />
    </IconButton>
  );
}

export function SearchField({ value, onChange, placeholder, size = 'sm', ...props }) {
  const dim =
    size === 'sm' ? 'h-[30px] px-[10px] rounded-[9px] text-[12.5px]' : 'h-[36px] px-[12px] rounded-[10px] text-[13px]';
  return (
    <input
      aria-label={placeholder}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn('w-full border border-line bg-paper font-sans text-ink outline-none animate-fadeUp', dim)}
      {...props}
    />
  );
}
