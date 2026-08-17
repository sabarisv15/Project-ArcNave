import { ChevronDown, X } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  ACADEMIC_OPTIONS,
  ATTENDANCE_OPTIONS,
  SCOPE_BATCHES,
  SCOPE_DEPTS,
  SCOPE_SECTIONS,
} from '../lib/studentsData';

const LABEL = 'text-[10px] tracking-[.06em] uppercase text-ink-faint mb-[6px]';
const FIELD =
  'w-full h-[34px] font-sans text-[12.5px] text-ink bg-paper border border-line rounded-[10px] px-[9px] outline-none';

function Field({ label, children }) {
  return (
    <div>
      <div className={LABEL}>{label}</div>
      {children}
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <Field label={label}>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={FIELD}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

const opts = (all, list, map = (v) => v) => [{ value: '', label: all }, ...list.map((v) => ({ value: v, label: map(v) }))];

/** Removable chips for whatever refines the current class scope. */
export function StudentFilterChips({ chips, onRemove, onClearAll }) {
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

/**
 * Quick filters + advanced filters. Class / year / section / subject are NOT here:
 * they come from the class scope and are shown as a locked chip above the table.
 */
export function StudentsFilters({ s }) {
  const f = s.filters;
  const set = s.setFilter;

  return (
    <div className="bg-tint border border-line rounded-[16px] pt-[16px] px-[18px] pb-[18px] mb-[12px] animate-fadeUp">
      <div className="text-[10px] tracking-[.08em] uppercase text-accent font-[500] mb-[10px]">
        Quick filters — inside {s.scopeIsAll ? 'all my classes' : s.scopeClass.code}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-x-[18px] gap-y-[14px]">
        <Select label="Dept / Year" value={f.dept} onChange={(v) => set('dept', v)} options={opts('All departments', SCOPE_DEPTS)} />
        <Select label="Section" value={f.section} onChange={(v) => set('section', v)} options={opts('All sections', SCOPE_SECTIONS, (v) => `Section ${v}`)} />
        <Select label="Attendance range" value={f.attendance} onChange={(v) => set('attendance', v)} options={ATTENDANCE_OPTIONS} />
        <Select
          label="Fee status"
          value={f.feedue}
          onChange={(v) => set('feedue', v)}
          options={[
            { value: '', label: 'All' },
            { value: 'yes', label: 'Fee due' },
            { value: 'no', label: 'No fee due' },
          ]}
        />
        <Select label="Academic status" value={f.acad} onChange={(v) => set('acad', v)} options={ACADEMIC_OPTIONS} />
        <Select label="Batch" value={f.batch} onChange={(v) => set('batch', v)} options={opts('All batches', SCOPE_BATCHES)} />
        <Select label="Entry type" value={f.entry} onChange={(v) => set('entry', v)} options={opts('All', ['Regular', 'Lateral'])} />
        <Select label="Accommodation" value={f.accom} onChange={(v) => set('accom', v)} options={opts('All', ['Hosteller', 'Day Scholar'])} />
        <Select label="Gender" value={f.gender} onChange={(v) => set('gender', v)} options={opts('All', ['Male', 'Female'])} />
      </div>

      <div className="h-px bg-line mt-[16px]" />

      <button
        type="button"
        aria-expanded={s.advancedOpen}
        onClick={() => s.setAdvancedOpen(!s.advancedOpen)}
        className={cn(
          'flex items-center justify-between gap-[8px] w-full mt-[10px] px-[10px] py-[8px] border-0 rounded-[10px] font-sans text-[10px] tracking-[.08em] uppercase font-[500] cursor-pointer transition-colors duration-200 hover:bg-hoverline',
          s.advancedOpen ? 'bg-accent-soft text-accent' : 'bg-transparent text-ink-muted'
        )}
      >
        <span>Advanced filters (CGPA, backlogs, exact attendance %)</span>
        <ChevronDown
          size={14}
          strokeWidth={2}
          className={cn('transition-transform duration-200', s.advancedOpen && 'rotate-180')}
        />
      </button>

      {s.advancedOpen && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-x-[18px] gap-y-[14px] mt-[12px] animate-fadeUp">
          <Field label="Min CGPA">
            <input type="number" step="0.1" min="0" max="10" aria-label="Minimum CGPA" value={f.cgpaMin} onChange={(e) => set('cgpaMin', e.target.value)} placeholder="e.g. 7.7" className={FIELD} />
          </Field>
          <Field label="Backlogs ≥">
            <input type="number" step="1" min="0" aria-label="Minimum backlogs" value={f.arrearsMin} onChange={(e) => set('arrearsMin', e.target.value)} placeholder="e.g. 9" className={FIELD} />
          </Field>
          <Field label="Backlogs <">
            <input type="number" step="1" min="0" aria-label="Maximum backlogs" value={f.arrearsMax} onChange={(e) => set('arrearsMax', e.target.value)} placeholder="e.g. 3" className={FIELD} />
            <div className="text-[10.5px] text-ink-faint mt-[5px]">Tip: for exactly 3, set ≥ 3 and &lt; 4</div>
          </Field>
          <Field label="Attendance % ≥">
            <input type="number" step="1" min="0" max="100" aria-label="Minimum attendance" value={f.attMin} onChange={(e) => set('attMin', e.target.value)} placeholder="e.g. 90" className={FIELD} />
          </Field>
          <Field label="Attendance % <">
            <input type="number" step="1" min="0" max="100" aria-label="Maximum attendance" value={f.attMax} onChange={(e) => set('attMax', e.target.value)} placeholder="e.g. 50" className={FIELD} />
          </Field>
        </div>
      )}
    </div>
  );
}
