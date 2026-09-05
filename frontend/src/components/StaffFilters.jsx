import { X } from 'lucide-react';
import { FilterPopover, FilterSelect } from './FilterPopover';
import { SCOPE_DEPTS, SCOPE_DESIGNATIONS, SCOPE_EMPLOYMENT_TYPES } from '../lib/staffData';

const opts = (all, list) => [{ value: '', label: all }, ...list.map((v) => ({ value: v, label: v }))];

/** Removable chips for whatever refines the current staff list. */
export function StaffFilterChips({ chips, onRemove, onClearAll }) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-[8px] mb-[12px] animate-fadeUp">
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

/** The shared ArcNave filter popover, wired to the Staff filter fields. */
export function StaffFilterPopover({ s }) {
  const f = s.filters;
  const set = s.setFilter;

  return (
    <FilterPopover
      open={s.filtersOpen}
      onOpenChange={(open) => s.setPanel(open ? 'filters' : null)}
      activeCount={s.activeFilterCount}
      onClear={s.clearFilters}
    >
      <div className="grid grid-cols-2 gap-x-[12px] gap-y-[14px]">
        <FilterSelect
          label="Department"
          value={f.department}
          onChange={(v) => set('department', v)}
          options={opts('All departments', SCOPE_DEPTS)}
        />
        <FilterSelect
          label="Designation"
          value={f.designation}
          onChange={(v) => set('designation', v)}
          options={opts('All designations', SCOPE_DESIGNATIONS)}
        />
        <FilterSelect
          label="Employment type"
          value={f.employmentType}
          onChange={(v) => set('employmentType', v)}
          options={opts('All types', SCOPE_EMPLOYMENT_TYPES)}
        />
      </div>
    </FilterPopover>
  );
}
