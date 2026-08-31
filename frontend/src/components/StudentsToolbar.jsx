import { ArrowDownWideNarrow, Check, Download, Search, SlidersHorizontal } from 'lucide-react';
import { cn } from '../lib/utils';
import { EXPORT_COLUMNS, SORTS } from '../lib/studentsData';

const TOOL =
  'inline-flex items-center gap-[7px] h-[36px] px-[13px] rounded-[11px] font-sans text-[12.5px] cursor-pointer whitespace-nowrap transition-[background-color,border-color,color,transform] duration-200 active:scale-[.985] motion-reduce:active:scale-100';
const TOOL_OFF = 'border border-line bg-paper text-ink-soft font-[500] hover:bg-tint2';
const TOOL_ON = 'border border-accent-line bg-accent-soft text-accent font-[600]';

/** Search · Sort · Filters · live result count · Export — all inside the selected class scope. */
export function StudentsToolbar({ s }) {
  return (
    <div className="flex items-center gap-[10px] flex-wrap mb-[12px]">
      <div className="relative flex-1 min-w-[220px] max-w-[380px]">
        <input
          aria-label="Search students"
          value={s.query}
          onChange={(e) => s.setQuery(e.target.value)}
          placeholder="Search name, roll no, reg no, phone…"
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

      <button
        type="button"
        aria-expanded={s.filtersOpen}
        onClick={s.toggleFilters}
        className={cn(TOOL, s.filtersOpen || s.activeFilterCount > 0 ? TOOL_ON : TOOL_OFF)}
      >
        <SlidersHorizontal size={15} strokeWidth={1.9} />
        <span>Filters{s.activeFilterCount > 0 ? ` · ${s.activeFilterCount}` : ''}</span>
      </button>

      {s.activeFilterCount > 0 && (
        <button
          type="button"
          onClick={s.clearFilters}
          className="h-[36px] px-[10px] border-0 bg-transparent rounded-[10px] font-sans text-[12.5px] text-ink-muted cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink"
        >
          Clear filters
        </button>
      )}

      <div className="flex-1" />
      <div aria-live="polite" className="text-[12.5px] text-ink-faint whitespace-nowrap">
        {s.resultCountLabel}
      </div>

      <div className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={s.exportMenuOpen}
          onClick={() => s.setExportMenuOpen(!s.exportMenuOpen)}
          className={cn(TOOL, s.exportMenuOpen ? TOOL_ON : TOOL_OFF)}
        >
          <Download size={15} strokeWidth={1.8} />
          <span>Export</span>
        </button>
        {s.exportMenuOpen && (
          <div
            role="menu"
            className="absolute top-[calc(100%+6px)] right-0 z-[60] w-[344px] p-[16px] bg-raised border border-line-strong rounded-[16px] shadow-pop animate-fadeUp"
          >
            <div className="text-[12.5px] font-[500] text-ink mb-[4px]">{s.exportSummary}</div>
            <div className="text-[11px] text-ink-faint mb-[12px]">Current filters and class scope only.</div>
            <div className="text-[10px] tracking-[.06em] uppercase text-ink-faint mb-[8px]">Include columns</div>
            <div className="grid grid-cols-2 gap-x-[10px] gap-y-[2px]">
              {EXPORT_COLUMNS.map(([key, label]) => {
                const checked = !!s.exportColumns[key];
                return (
                  <button
                    key={key}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    onClick={() => s.toggleExportColumn(key)}
                    className="flex items-center gap-[8px] w-full p-[6px] border-0 bg-transparent rounded-[10px] font-sans text-[12.5px] text-ink-soft cursor-pointer text-left hover:bg-tint2"
                  >
                    <span
                      className={cn(
                        'w-[17px] h-[17px] rounded-[5px] flex-none grid place-items-center border transition-colors duration-200',
                        checked ? 'bg-accent border-accent text-white' : 'bg-paper border-line',
                      )}
                    >
                      {checked && <Check size={10} strokeWidth={3} />}
                    </span>
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
            <div className="h-px bg-line my-[12px]" />
            <div className="text-[10px] tracking-[.06em] uppercase text-ink-faint mb-[8px]">Format</div>
            <div className="flex gap-[8px]">
              <button
                type="button"
                onClick={s.exportAsCsv}
                className="flex-1 h-[34px] border border-line rounded-[11px] bg-paper font-sans text-[12.5px] font-[500] text-ink-soft cursor-pointer transition-colors duration-200 hover:bg-accent-soft hover:text-accent hover:border-accent-line"
              >
                CSV
              </button>
              <button
                type="button"
                onClick={s.exportAsExcel}
                className="flex-1 h-[34px] border border-line rounded-[11px] bg-paper font-sans text-[12.5px] font-[500] text-ink-soft cursor-pointer transition-colors duration-200 hover:bg-accent-soft hover:text-accent hover:border-accent-line"
              >
                Excel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
