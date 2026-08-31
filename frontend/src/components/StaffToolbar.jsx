import { ArrowDownWideNarrow, Check, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { SORTS } from '../lib/staffData';
import { StaffFilterPopover } from './StaffFilters';

const TOOL =
  'inline-flex items-center gap-[7px] h-[36px] px-[13px] rounded-[11px] font-sans text-[12.5px] cursor-pointer whitespace-nowrap transition-[background-color,border-color,color,transform] duration-200 active:scale-[.985] motion-reduce:active:scale-100';
const TOOL_OFF = 'border border-line bg-paper text-ink-soft font-[500] hover:bg-tint2';
const TOOL_ON = 'border border-accent-line bg-accent-soft text-accent font-[600]';

/** Search · Sort · Filters · live result count · Export — same pattern as Students. */
export function StaffToolbar({ s }) {
  return (
    <div className="flex items-center gap-[10px] flex-wrap mb-[12px]">
      <div className="relative flex-1 min-w-[220px] max-w-[380px]">
        <input
          aria-label="Search staff"
          value={s.query}
          onChange={(e) => s.setQuery(e.target.value)}
          placeholder="Search name, employee ID, designation, department, phone…"
          className="w-full h-[36px] pl-[34px] pr-[12px] border border-line rounded-[11px] bg-paper font-sans text-[13px] text-ink outline-none transition-[border-color,box-shadow] duration-200 focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]"
        />
        <span className="absolute left-[11px] top-0 bottom-0 flex items-center text-ink-ghost pointer-events-none">
          <Search size={15} strokeWidth={1.9} />
        </span>
      </div>

      <div className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={s.sortMenuOpen}
          onClick={s.toggleSortMenu}
          className={cn(TOOL, s.sortMenuOpen ? TOOL_ON : TOOL_OFF)}
        >
          <ArrowDownWideNarrow size={15} strokeWidth={1.8} />
          <span>Sort: {s.sortLabel}</span>
        </button>
        {s.sortMenuOpen && (
          <div
            role="menu"
            className="absolute top-[calc(100%+6px)] left-0 z-[60] min-w-[212px] p-[5px] bg-raised border border-line-strong rounded-[16px] shadow-pop animate-fadeUp"
          >
            {SORTS.map((opt) => {
              const on = opt.key === s.sortKey;
              return (
                <button
                  key={opt.key}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    s.setSortKey(opt.key);
                    s.setPanel(null);
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
          </div>
        )}
      </div>

      <StaffFilterPopover s={s} />

      <div className="flex-1" />
      <div aria-live="polite" className="text-[12.5px] text-ink-faint whitespace-nowrap">
        {s.resultCountLabel}
      </div>
    </div>
  );
}
