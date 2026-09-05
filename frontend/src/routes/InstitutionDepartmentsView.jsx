import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { DEPT_ATTENTION_THRESHOLD } from '../lib/institutionData';
import { DEPT_ATTENTION_STATES } from '../lib/institutionSignals';
import { seatTitle } from '../lib/seatTitles';
import { HOD_L3 } from '../lib/roles';
import { InstitutionScopeHeader } from '../components/InstitutionScopeHeader';
import { InstitutionDepartmentDrawer } from '../components/InstitutionDepartmentDrawer';
import { InstitutionHodSeatDrawer } from '../components/InstitutionHodSeatDrawer';
import { SeatStateBadge } from '../components/SeatStateBadge';
import { NoDepartments, NoResults } from '../components/InstitutionalState';
import { SearchPopoverField, SortIconPopover } from '../components/ToolbarIcons';
import { FilterPopover, FilterSelect } from '../components/FilterPopover';
import { PANE, STICKY_HEAD, TABLE_HEAD, StickyTableShell } from '../components/WorkspaceLayout';
import { useInstitutionHealth } from '../hooks/useInstitutionHealth';
import { cn } from '../lib/utils';

/**
 * Institution → Departments.
 *
 * The comparison screen. Every department on one list, sorted by whichever
 * figure the question needs — which is the whole point of this seat having a
 * departments page at all: an HOD compares classes, a Principal compares
 * departments, and neither comparison is available from the other's workspace.
 *
 * **Two views, because they are two jobs.** *Comparison* is monitoring and
 * drill-through only — no action, because approving a revision and settling an
 * escalation happen in Approvals where they are recorded against a decision with
 * a diff and a timeline, and a button on a comparison table would be a decision
 * taken without either. *Leadership seats* is the one thing this office does
 * change, and it is deliberately its own view with its own drawer rather than a
 * control bolted onto a comparison row: a seat is an institutional position with
 * a scope and a history, not a column.
 *
 * **Class Tutor seats are absent from both.** They belong to each department's
 * own head, and the coverage figure appears only as a reading. There is no
 * institution-level control that assigns one, and this page is where somebody
 * would most plausibly go looking for it.
 *
 * `?dept=` opens a department directly, so a drill-through from the Institution
 * dashboard lands where it said it would and is a real, shareable destination
 * rather than transient component state.
 */

const VIEWS = [
  { key: 'health', label: 'Comparison' },
  { key: 'seats', label: 'Leadership seats' },
];

const SORTS = [
  { key: 'attention', label: 'Needs attention first' },
  { key: 'attendance_asc', label: 'Attendance (low first)' },
  { key: 'attendance_desc', label: 'Attendance (high first)' },
  { key: 'students_desc', label: 'Students (most first)' },
  { key: 'name', label: 'Name (A–Z)' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  ...Object.entries(DEPT_ATTENTION_STATES).map(([value, s]) => ({ value, label: s.label })),
];

const ATTENDANCE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'below', label: `Below ${DEPT_ATTENTION_THRESHOLD}%` },
  { value: 'above', label: `${DEPT_ATTENTION_THRESHOLD}% and above` },
];

/** Attention-first ordering: the two danger states, then the warnings, then on track. */
const ATTENTION_RANK = {
  low_attendance: 0,
  no_hod: 1,
  awaiting_endorsement: 2,
  workload_imbalance: 3,
  timetable_exception: 4,
  ok: 5,
};

/*
 * Tight tier: Department · Attendance · Status · Chevron. Head, classes, faculty,
 * students and pending counts are demoted into the drawer. Each demoted cell
 * carries its own `hidden md:block` wrapper, because a hidden child still
 * occupies a grid track and would push the sticky header out of alignment with
 * its rows.
 */
const GRID =
  'grid grid-cols-[minmax(0,1.6fr)_84px_minmax(0,132px)_38px] md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_62px_62px_70px_84px_74px_minmax(0,140px)_38px] gap-x-[10px] items-center px-[16px]';

export function InstitutionDepartmentsView() {
  const [params, setParams] = useSearchParams();
  const deptParam = params.get('dept') ?? '';

  const [view, setView] = useState('health');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [attendance, setAttendance] = useState('');
  const [sortKey, setSortKey] = useState('attention');
  const [filterOpen, setFilterOpen] = useState(false);
  const [seatDeptId, setSeatDeptId] = useState('');

  /*
   * Live rather than the frozen `DEPARTMENT_HEALTH`: a leadership seat filled a
   * moment ago has to read as filled on the page that filled it.
   */
  const { departments: DEPARTMENT_HEALTH, departmentById: DEPARTMENT_HEALTH_BY_ID } = useInstitutionHealth();

  const openId = DEPARTMENT_HEALTH_BY_ID[deptParam] ? deptParam : '';
  const setOpenId = (value) => {
    const next = new URLSearchParams(params);
    if (value) next.set('dept', value);
    else next.delete('dept');
    setParams(next, { replace: true });
  };

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = DEPARTMENT_HEALTH.filter((d) => {
      if (term && ![d.name, d.short, d.hod?.name ?? ''].join(' ').toLowerCase().includes(term)) return false;
      if (status && d.attention !== status) return false;
      if (attendance === 'below' && d.attendance >= DEPT_ATTENTION_THRESHOLD) return false;
      if (attendance === 'above' && d.attendance < DEPT_ATTENTION_THRESHOLD) return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'attendance_asc') return a.attendance - b.attendance;
      if (sortKey === 'attendance_desc') return b.attendance - a.attendance;
      if (sortKey === 'students_desc') return b.studentCount - a.studentCount;
      const byRank = ATTENTION_RANK[a.attention] - ATTENTION_RANK[b.attention];
      return byRank !== 0 ? byRank : a.attendance - b.attendance;
    });
  }, [DEPARTMENT_HEALTH, query, status, attendance, sortKey]);

  const activeFilterCount = [status, attendance].filter(Boolean).length;

  function clearFilters() {
    setStatus('');
    setAttendance('');
  }

  return (
    <div className={PANE}>
      <InstitutionScopeHeader />

      <div className="flex-none flex items-center gap-[8px] mb-[12px]">
        <h1 className="m-0 text-[17px] font-[600] tracking-[-.01em]">Departments</h1>
        <span className="text-[11.5px] text-ink-faint tabular-nums" aria-live="polite">
          {rows.length === DEPARTMENT_HEALTH.length
            ? `${DEPARTMENT_HEALTH.length} departments`
            : `${rows.length} of ${DEPARTMENT_HEALTH.length}`}
        </span>

        <div role="tablist" aria-label="Department views" className="flex items-center gap-[4px] ml-[4px]">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              onClick={() => setView(v.key)}
              className={cn(
                'flex-none h-[27px] px-[10px] border-0 rounded-[8px] bg-transparent font-sans text-[12.5px] cursor-pointer transition-colors duration-200',
                view === v.key
                  ? 'bg-accent-soft text-accent font-[600]'
                  : 'text-ink-muted font-[500] hover:text-ink hover:bg-tint2',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />
        <SearchPopoverField
          value={query}
          onChange={setQuery}
          placeholder="Search department, head…"
          ariaLabel="Search departments"
        />
        <SortIconPopover options={SORTS} value={sortKey} onChange={setSortKey} label="Sort departments" />
        <FilterPopover
          open={filterOpen}
          onOpenChange={setFilterOpen}
          activeCount={activeFilterCount}
          onClear={clearFilters}
          iconOnly
          label="Filter departments"
          width={240}
          align="end"
        >
          <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          <FilterSelect label="Attendance" value={attendance} onChange={setAttendance} options={ATTENDANCE_OPTIONS} />
        </FilterPopover>
      </div>

      {view === 'seats' ? (
        <LeadershipSeats rows={rows} onOpen={setSeatDeptId} />
      ) : (
        <StickyTableShell minWidth={340}>
          <div className={cn(GRID, STICKY_HEAD, TABLE_HEAD, 'h-[38px]')}>
            <span>Department</span>
            <span className="hidden md:block">Head</span>
            <span className="hidden md:block">Classes</span>
            <span className="hidden md:block">Faculty</span>
            <span className="hidden md:block">Students</span>
            <span>Attendance</span>
            <span className="hidden md:block">Pending</span>
            <span>Status</span>
            <span className="sr-only">Open</span>
          </div>

          {rows.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setOpenId(d.id)}
              aria-label={`${d.name} — open department`}
              className={cn(
                GRID,
                'w-full h-[48px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2',
              )}
            >
              <span className="min-w-0">
                <span className="block text-[13px] text-ink truncate" title={d.name}>
                  {d.name}
                </span>
                <span className="block text-[11px] text-ink-faint truncate">{d.short}</span>
              </span>

              <span className="hidden md:block min-w-0 text-[12.5px] truncate">
                {d.hod ? (
                  <span className="text-ink-muted" title={d.hod.name}>
                    {d.hod.name}
                  </span>
                ) : (
                  <span className="text-danger font-[500]">Not recorded</span>
                )}
              </span>

              <span className="hidden md:block text-[12.5px] text-ink-muted tabular-nums">{d.classCount}</span>
              <span className="hidden md:block text-[12.5px] text-ink-muted tabular-nums">{d.facultyCount}</span>
              <span className="hidden md:block text-[12.5px] text-ink-muted tabular-nums">{d.studentCount}</span>

              {/* Colour marks the one threshold that means something, and never replaces the number. */}
              <span
                className={cn(
                  'text-[13px] tabular-nums',
                  d.attendance < DEPT_ATTENTION_THRESHOLD ? 'font-[500] text-danger' : 'text-ink',
                )}
              >
                {d.attendance}%
              </span>

              <span className="hidden md:block text-[12.5px] text-ink-muted tabular-nums">
                {d.pendingCount === 0 ? <span className="text-ink-faint">—</span> : d.pendingCount}
              </span>

              <span className="min-w-0">
                <span
                  className={cn(
                    'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500] max-w-full truncate',
                    DEPT_ATTENTION_STATES[d.attention].tone,
                  )}
                >
                  {DEPT_ATTENTION_STATES[d.attention].label}
                </span>
              </span>

              <span className="flex justify-end text-ink-faint">
                <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
              </span>
            </button>
          ))}

          {rows.length === 0 && (DEPARTMENT_HEALTH.length === 0 ? <NoDepartments /> : <NoResults what="departments" />)}
        </StickyTableShell>
      )}

      <p className="flex-none m-0 mt-[8px] text-[11.5px] text-ink-faint">
        {view === 'seats'
          ? 'Department leadership is this office’s seat · Class Tutor seats are assigned by each head of department.'
          : 'Class and faculty decisions belong to each head of department · endorsements and escalations are decided in Approvals.'}
      </p>

      <InstitutionDepartmentDrawer
        department={openId ? DEPARTMENT_HEALTH_BY_ID[openId] : null}
        onClose={() => setOpenId('')}
      />

      <InstitutionHodSeatDrawer
        department={seatDeptId ? (DEPARTMENT_HEALTH_BY_ID[seatDeptId] ?? null) : null}
        onClose={() => setSeatDeptId('')}
      />
    </div>
  );
}

/*
 * Tight tier: Department · Seat state · Chevron. Occupant, since-date and
 * readiness demote into the drawer, each behind its own `hidden md:block`
 * wrapper so a hidden child does not occupy a grid track and push the sticky
 * header out of alignment with its rows.
 */
const SEAT_GRID =
  'grid grid-cols-[minmax(0,1.6fr)_minmax(0,132px)_38px] md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,132px)_minmax(0,1fr)_38px] gap-x-[10px] items-center px-[16px]';

/**
 * The department leadership seats, and the state each one is in.
 *
 * The occupant column is the seat's *state* rendered as a person where there is
 * one, an address where an invitation is out, and a stated absence where there
 * is neither — never a blank, which reads as missing data rather than as the
 * finding it actually is.
 */
function LeadershipSeats({ rows, onOpen }) {
  const title = seatTitle(HOD_L3);

  return (
    <StickyTableShell minWidth={340}>
      <div className={cn(SEAT_GRID, STICKY_HEAD, TABLE_HEAD, 'h-[38px]')}>
        <span>Department</span>
        <span className="hidden md:block">Seat</span>
        <span className="hidden md:block">Occupant</span>
        <span>State</span>
        <span className="hidden md:block">Readiness</span>
        <span className="sr-only">Open</span>
      </div>

      {rows.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => onOpen(d.id)}
          aria-label={`${d.name} — manage ${title.toLowerCase()} seat`}
          className={cn(
            SEAT_GRID,
            'w-full h-[48px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2',
          )}
        >
          <span className="min-w-0">
            <span className="block text-[13px] text-ink truncate" title={d.name}>
              {d.name}
            </span>
            <span className="block text-[11px] text-ink-faint truncate">{d.short}</span>
          </span>

          {/* The configured title, so a college that calls it something else sees that. */}
          <span className="hidden md:block min-w-0 text-[12.5px] text-ink-muted truncate">{title}</span>

          <span className="hidden md:block min-w-0 text-[12.5px] truncate">
            {d.hodSeatState === 'active' ? (
              <span className="text-ink-muted" title={d.hod?.name}>
                {d.hod?.name ?? '—'}
              </span>
            ) : d.hodSeatState === 'invite_pending' ? (
              <span className="text-pending" title={d.hodSeat?.invitedEmail ?? ''}>
                {d.hodSeat?.invitedEmail ?? 'Invitation out'}
              </span>
            ) : (
              <span className="text-danger font-[500]">Nobody</span>
            )}
          </span>

          <span className="min-w-0">
            <SeatStateBadge state={d.hodSeatState} />
          </span>

          <span className="hidden md:block min-w-0 text-[12px] text-ink-muted truncate">
            {d.classCount} classes · {d.attendance}% · {d.pendingCount} pending
          </span>

          <span className="flex justify-end text-ink-faint">
            <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
          </span>
        </button>
      ))}

      {rows.length === 0 && <NoResults what="departments" />}
    </StickyTableShell>
  );
}
