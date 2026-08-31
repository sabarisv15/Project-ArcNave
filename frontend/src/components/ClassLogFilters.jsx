import { ArrowDownWideNarrow, Check, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { FilterPopover, FilterSelect, FilterField, FilterFieldLabel, FILTER_FIELD_INPUT } from './FilterPopover';
import { HISTORY_PERIODS } from '../lib/attendanceData';
import { DATE_PRESETS } from '../lib/dateFilters';
import { CLASS_LOG_SORTS } from '../hooks/useClassLogs';

const CODES = [...new Set(HISTORY_PERIODS.map((p) => p.code))].sort();
const SUBJECTS = [...new Set(HISTORY_PERIODS.map((p) => p.subject))].sort();
const YEARS = [...new Set(HISTORY_PERIODS.map((p) => p.year).filter(Boolean))].sort();

const opts = (all, list) => [{ value: '', label: all }, ...list.map((v) => ({ value: String(v), label: String(v) }))];

const TOOL =
  'inline-flex items-center gap-[7px] h-[36px] px-[13px] rounded-[11px] font-sans text-[12.5px] cursor-pointer whitespace-nowrap transition-[background-color,border-color,color,transform] duration-200 active:scale-[.985] motion-reduce:active:scale-100';
const TOOL_OFF = 'border border-line bg-paper text-ink-soft font-[500] hover:bg-tint2';
const TOOL_ON = 'border border-accent-line bg-accent-soft text-accent font-[600]';

export function ClassLogSortControl({ c }) {
  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={c.sortMenuOpen}
        onClick={c.toggleSortMenu}
        className={cn(TOOL, c.sortMenuOpen ? TOOL_ON : TOOL_OFF)}
      >
        <ArrowDownWideNarrow size={15} strokeWidth={1.8} />
        <span>Sort: {c.sortLabel}</span>
      </button>
      {c.sortMenuOpen && (
        <div
          role="menu"
          className="absolute top-[calc(100%+6px)] left-0 z-[60] min-w-[180px] p-[5px] bg-raised border border-line-strong rounded-[16px] shadow-pop animate-fadeUp"
        >
          {CLASS_LOG_SORTS.map((opt) => {
            const on = opt.key === c.sortKey;
            return (
              <button
                key={opt.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  c.setSortKey(opt.key);
                  c.setPanel(null);
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
  );
}

export function ClassLogChips({ chips, onRemove, onClearAll }) {
  if (!chips.length) return null;
  return (
    <div className="flex-none flex flex-wrap gap-[8px] mb-[12px] animate-fadeUp">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-[4px] h-[28px] pl-[11px] pr-[4px] bg-accent-soft border border-accent-line rounded-[11px] text-[12px] text-accent"
        >
          <span>{chip.label}</span>
          <button
            type="button"
            aria-label={`Remove filter ${chip.label}`}
            onClick={() => onRemove(chip.key)}
            className="w-[20px] h-[20px] grid place-items-center border-0 bg-transparent rounded-[7px] text-accent cursor-pointer transition-colors duration-200 hover:bg-accent-soft2"
          >
            <X size={11} strokeWidth={2.4} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="h-[28px] px-[10px] border-0 bg-transparent rounded-[10px] font-sans text-[12px] text-ink-muted cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink"
      >
        Clear all
      </button>
    </div>
  );
}

export function ClassLogFilterPopover({ c, iconOnly = false }) {
  const f = c.filters;
  const set = c.setFilter;

  return (
    <FilterPopover
      open={c.filtersOpen}
      onOpenChange={(open) => c.setPanel(open ? 'filters' : null)}
      activeCount={c.activeFilterCount}
      onClear={c.clearFilters}
      width={320}
      iconOnly={iconOnly}
      align="end"
    >
      <div className="mb-[14px]">
        <FilterFieldLabel>Date range</FilterFieldLabel>
        <div className="flex flex-wrap gap-[6px]">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => c.setDatePreset(p.key)}
              className={cn(
                'h-[28px] px-[10px] rounded-[9px] font-sans text-[11.5px] cursor-pointer transition-colors duration-200',
                c.datePreset === p.key
                  ? 'bg-accent-soft border border-accent-line text-accent font-[600]'
                  : 'bg-tint2 border border-transparent text-ink-soft font-[500] hover:bg-hoverline',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {c.datePreset === 'custom' && (
          <div className="grid grid-cols-2 gap-[8px] mt-[8px]">
            <FilterField label="From">
              <input
                type="date"
                aria-label="Custom range from"
                value={c.customFrom}
                onChange={(e) => c.setCustomFrom(e.target.value)}
                className={FILTER_FIELD_INPUT}
              />
            </FilterField>
            <FilterField label="To">
              <input
                type="date"
                aria-label="Custom range to"
                value={c.customTo}
                onChange={(e) => c.setCustomTo(e.target.value)}
                className={FILTER_FIELD_INPUT}
              />
            </FilterField>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-[12px] gap-y-[14px]">
        <FilterSelect
          label="Ownership"
          value={f.ownership}
          onChange={(v) => set('ownership', v)}
          options={[
            { value: '', label: 'All' },
            { value: 'own', label: 'My class' },
            { value: 'substitute', label: 'Substitute duty' },
          ]}
        />
        <FilterSelect
          label="Class / section"
          value={f.code}
          onChange={(v) => set('code', v)}
          options={opts('All classes', CODES)}
        />
        <FilterSelect
          label="Subject"
          value={f.subject}
          onChange={(v) => set('subject', v)}
          options={opts('All subjects', SUBJECTS)}
        />
        <FilterSelect label="Year" value={f.year} onChange={(v) => set('year', v)} options={opts('All years', YEARS)} />
      </div>
    </FilterPopover>
  );
}
