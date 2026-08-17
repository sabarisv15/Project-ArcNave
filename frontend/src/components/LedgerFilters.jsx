import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import { FilterPopover, FilterSelect, FilterField, FilterFieldLabel, FILTER_FIELD_INPUT } from './FilterPopover';
import { DATE_PRESETS } from '../lib/dateFilters';
import { ATTENDANCE_THRESHOLD } from '../lib/attendanceLedger';

/** Removable chips for whatever currently narrows the ledger — rendered only when something is active. */
export function LedgerChips({ chips, onRemove, onClearAll }) {
  if (!chips.length) return null;
  return (
    <div className="flex-none flex flex-wrap gap-[8px] mb-[10px] animate-fadeUp">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-[4px] h-[26px] pl-[10px] pr-[3px] bg-accent-soft border border-accent-line rounded-[10px] text-[11.5px] text-accent"
        >
          <span>{chip.label}</span>
          <button
            type="button"
            aria-label={`Remove filter ${chip.label}`}
            onClick={() => onRemove(chip.key)}
            className="w-[18px] h-[18px] grid place-items-center border-0 bg-transparent rounded-[6px] text-accent cursor-pointer transition-colors duration-200 hover:bg-accent-soft2"
          >
            <X size={10} strokeWidth={2.4} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="h-[26px] px-[9px] border-0 bg-transparent rounded-[9px] font-sans text-[11.5px] text-ink-muted cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink"
      >
        Clear all
      </button>
    </div>
  );
}

/** The shared ArcNave filter popover, wired to the subject-ledger fields. No page-local dropdown chrome. */
export function LedgerFilterPopover({ l }) {
  return (
    <FilterPopover
      open={l.filtersOpen}
      onOpenChange={(open) => l.setPanel(open ? 'filters' : null)}
      activeCount={l.activeFilterCount}
      onClear={l.clearFilters}
      width={300}
      iconOnly
      align="end"
    >
      <div className="mb-[14px]">
        <FilterFieldLabel>Date range</FilterFieldLabel>
        <div className="flex flex-wrap gap-[6px]">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => l.setDatePreset(p.key)}
              className={cn(
                'h-[28px] px-[10px] rounded-[9px] font-sans text-[11.5px] cursor-pointer transition-colors duration-200',
                l.datePreset === p.key
                  ? 'bg-accent-soft border border-accent-line text-accent font-[600]'
                  : 'bg-tint2 border border-transparent text-ink-soft font-[500] hover:bg-hoverline'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {l.datePreset === 'custom' && (
          <div className="grid grid-cols-2 gap-[8px] mt-[8px]">
            <FilterField label="From">
              <input type="date" aria-label="Custom range from" value={l.customFrom} onChange={(e) => l.setCustomFrom(e.target.value)} className={FILTER_FIELD_INPUT} />
            </FilterField>
            <FilterField label="To">
              <input type="date" aria-label="Custom range to" value={l.customTo} onChange={(e) => l.setCustomTo(e.target.value)} className={FILTER_FIELD_INPUT} />
            </FilterField>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-[14px]">
        <FilterSelect
          label="Ownership"
          value={l.filters.ownership}
          onChange={(v) => l.setFilter('ownership', v)}
          options={[
            { value: '', label: 'All' },
            { value: 'own', label: 'My class' },
            { value: 'substitute', label: 'Substitute duty' },
          ]}
        />
        <FilterSelect
          label="Attendance threshold"
          value={l.filters.threshold}
          onChange={(v) => l.setFilter('threshold', v)}
          options={[
            { value: '', label: 'All students' },
            { value: 'below', label: `Below ${ATTENDANCE_THRESHOLD}%` },
            { value: 'meets', label: `Meets ${ATTENDANCE_THRESHOLD}%` },
          ]}
        />
      </div>
    </FilterPopover>
  );
}
