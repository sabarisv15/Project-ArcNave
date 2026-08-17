import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  DEPARTMENTS,
  INST_FACULTY,
  departmentShort,
  facultyInitials,
  workloadOf,
} from '../lib/institutionData';
import { WORKLOAD_STATES } from '../lib/departmentTimetableData';
import { InstitutionScopeHeader } from '../components/InstitutionScopeHeader';
import { InstitutionFacultyDrawer } from '../components/InstitutionFacultyDrawer';
import { NoFaculty, NoResults } from '../components/InstitutionalState';
import { SearchPopoverField, SortIconPopover } from '../components/ToolbarIcons';
import { FilterPopover, FilterSelect } from '../components/FilterPopover';
import { PANE, STICKY_HEAD, TABLE_HEAD, StickyTableShell } from '../components/WorkspaceLayout';
import { cn } from '../lib/utils';

/**
 * Institution → Faculty.
 *
 * The question this page answers is **"where across the institution is the
 * slack, and where is the overload"** — which is a different question from the
 * HOD's, even though the columns look similar. An HOD sees one department and
 * can only move work inside it; a Principal sees all six and is the only seat
 * that can move a person between them. So Department is a column and a filter
 * here, and it is the column the page is really about.
 *
 * Deliberately not an HR screen: no payroll, no leave administration, no
 * employment records. Those belong to a different system and a different seat.
 */

const SORTS = [
  { key: 'load_desc', label: 'Teaching load (high first)' },
  { key: 'load_asc', label: 'Teaching load (low first)' },
  { key: 'department', label: 'Department, then load' },
  { key: 'name', label: 'Name (A–Z)' },
];

const STATE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'high', label: 'High load' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'light', label: 'Light load' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'unavailable', label: 'Unavailable' },
];

const DEPARTMENT_OPTIONS = [
  { value: '', label: 'All departments' },
  ...DEPARTMENTS.map((d) => ({ value: d.id, label: d.name })),
];

/** Every faculty member, with their band resolved once. */
const FACULTY_ROWS = INST_FACULTY.map((f) => ({ faculty: f, state: workloadOf(f) }));

/*
 * Tight tier: Faculty · Load · Status · Chevron. Department and designation are
 * demoted into the drawer. Each demoted cell carries its own `hidden md:block`
 * wrapper, because a hidden child still occupies a grid track and would push the
 * sticky header out of alignment with its rows.
 */
const GRID =
  'grid grid-cols-[minmax(0,1.6fr)_72px_minmax(0,112px)_38px] md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_82px_minmax(0,124px)_38px] gap-x-[12px] items-center px-[16px]';

export function InstitutionFacultyView() {
  const [query, setQuery] = useState('');
  const [state, setState] = useState('');
  const [department, setDepartment] = useState('');
  const [sortKey, setSortKey] = useState('load_desc');
  const [filterOpen, setFilterOpen] = useState(false);
  const [openId, setOpenId] = useState(null);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = FACULTY_ROWS.filter((l) => {
      if (
        term &&
        ![l.faculty.name, l.faculty.employeeId, l.faculty.designation, l.faculty.email]
          .join(' ')
          .toLowerCase()
          .includes(term)
      ) {
        return false;
      }
      if (state && l.state !== state) return false;
      if (department && l.faculty.departmentId !== department) return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.faculty.name.localeCompare(b.faculty.name);
      if (sortKey === 'load_asc') return a.faculty.periods - b.faculty.periods;
      if (sortKey === 'department') {
        const byDept = departmentShort(a.faculty.departmentId).localeCompare(
          departmentShort(b.faculty.departmentId)
        );
        return byDept !== 0 ? byDept : b.faculty.periods - a.faculty.periods;
      }
      return b.faculty.periods - a.faculty.periods;
    });
  }, [query, state, department, sortKey]);

  const activeFilterCount = [state, department].filter(Boolean).length;

  function clearFilters() {
    setState('');
    setDepartment('');
  }

  const open = openId ? FACULTY_ROWS.find((l) => l.faculty.id === openId) : null;

  return (
    <div className={PANE}>
      <InstitutionScopeHeader />

      <div className="flex-none flex items-center gap-[8px] mb-[12px]">
        <h1 className="m-0 text-[17px] font-[600] tracking-[-.01em]">Faculty</h1>
        <span className="text-[11.5px] text-ink-faint tabular-nums" aria-live="polite">
          {rows.length === FACULTY_ROWS.length
            ? `${FACULTY_ROWS.length} faculty`
            : `${rows.length} of ${FACULTY_ROWS.length}`}
        </span>
        <div className="flex-1" />
        <SearchPopoverField
          value={query}
          onChange={setQuery}
          placeholder="Search name, ID, designation…"
          ariaLabel="Search faculty"
        />
        <SortIconPopover options={SORTS} value={sortKey} onChange={setSortKey} label="Sort faculty" />
        <FilterPopover
          open={filterOpen}
          onOpenChange={setFilterOpen}
          activeCount={activeFilterCount}
          onClear={clearFilters}
          iconOnly
          label="Filter faculty"
          width={250}
          align="end"
        >
          <FilterSelect label="Department" value={department} onChange={setDepartment} options={DEPARTMENT_OPTIONS} />
          <FilterSelect label="Workload" value={state} onChange={setState} options={STATE_OPTIONS} />
        </FilterPopover>
      </div>

      <StickyTableShell minWidth={360}>
        <div className={cn(GRID, STICKY_HEAD, TABLE_HEAD, 'h-[38px]')}>
          <span>Faculty member</span>
          <span className="hidden md:block">Department</span>
          <span className="hidden md:block">Designation</span>
          <span>Load</span>
          <span>Status</span>
          <span className="sr-only">Open</span>
        </div>

        {rows.map((l) => (
          <button
            key={l.faculty.id}
            type="button"
            onClick={() => setOpenId(l.faculty.id)}
            aria-label={`${l.faculty.name} — open record`}
            className={cn(
              GRID,
              'w-full h-[48px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2'
            )}
          >
            <span className="min-w-0 flex items-center gap-[9px]">
              <span
                aria-hidden="true"
                className="flex-none w-[26px] h-[26px] grid place-items-center rounded-full bg-warm-soft text-warm text-[10.5px] font-[500]"
              >
                {facultyInitials(l.faculty.name)}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] text-ink truncate" title={l.faculty.name}>
                  {l.faculty.name}
                </span>
                <span className="block text-[11px] text-ink-faint truncate tabular-nums">{l.faculty.employeeId}</span>
              </span>
            </span>

            <span className="hidden md:block min-w-0 text-[12.5px] text-ink-muted truncate">
              {departmentShort(l.faculty.departmentId)}
            </span>

            <span className="hidden md:block min-w-0 text-[12.5px] text-ink-muted truncate">
              {l.faculty.designation}
            </span>

            {/*
              The number always shows. Colour marks the two ends worth acting on
              and never stands in for the figure itself.
            */}
            <span
              className={cn(
                'text-[13px] tabular-nums',
                l.state === 'high'
                  ? 'font-[500] text-pending'
                  : l.faculty.periods === 0
                    ? 'text-ink-faint'
                    : 'text-ink'
              )}
            >
              {l.faculty.periods} <span className="text-[11px] text-ink-faint">/wk</span>
            </span>

            <span className="min-w-0">
              <span
                className={cn(
                  'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500] max-w-full truncate',
                  WORKLOAD_STATES[l.state].tone
                )}
              >
                {WORKLOAD_STATES[l.state].label}
              </span>
            </span>

            <span className="flex justify-end text-ink-faint">
              <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
            </span>
          </button>
        ))}

        {rows.length === 0 && (FACULTY_ROWS.length === 0 ? <NoFaculty /> : <NoResults what="faculty" />)}
      </StickyTableShell>

      <p className="flex-none m-0 mt-[8px] text-[11.5px] text-ink-faint">
        Teaching load is counted from each department's live timetable · allocation within a department belongs to its
        head.
      </p>

      <InstitutionFacultyDrawer row={open} onClose={() => setOpenId(null)} />
    </div>
  );
}
