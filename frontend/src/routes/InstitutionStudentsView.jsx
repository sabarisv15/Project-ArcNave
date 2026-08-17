import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  ATTENDANCE_THRESHOLD,
  CLASS_BY_ID,
  DEPARTMENT_BY_ID,
  INST_STUDENT_TOTAL,
  classLabel,
  classesOfDepartment,
  departmentLabel,
  studentsOfDepartment,
} from '../lib/institutionData';
import { DEPT_ATTENTION_STATES, DEPARTMENT_HEALTH } from '../lib/institutionSignals';
import { InstitutionScopeHeader } from '../components/InstitutionScopeHeader';
import { InstitutionStudentDrawer } from '../components/InstitutionStudentDrawer';
import { EmptyRoster, NoDepartments, NoResults } from '../components/InstitutionalState';
import { SearchPopoverField, SortIconPopover } from '../components/ToolbarIcons';
import { FilterPopover, FilterSelect } from '../components/FilterPopover';
import { PANE, STICKY_HEAD, TABLE_HEAD, StickyTableShell } from '../components/WorkspaceLayout';
import { cn } from '../lib/utils';

/**
 * Institution → Students.
 *
 * **Two views, one route, and the default is deliberately not a roster.**
 *
 * There are 1,285 students in this institution. A page that opens on all of them
 * is not a Principal screen — it is a data dump that buries the one finding this
 * seat can act on, which is that one department's cohort is failing while five
 * others are fine. So the default is student health *per department*: six rows,
 * each a comparison, each drilling through.
 *
 * `?dept=` switches to that department's roster, rendered with the same table,
 * search, filter, tight-tier and drawer patterns the L3 students page uses. That
 * is the level at which an individual student becomes a meaningful unit, and it
 * is reached by asking for it rather than by default.
 *
 * It is one route, not two, because it is one question at two altitudes — and a
 * second route would let a Principal bookmark the roster dump this page exists
 * to avoid.
 */

const DEPT_SORTS = [
  { key: 'attendance_asc', label: 'Attendance (low first)' },
  { key: 'risk_desc', label: 'At risk (most first)' },
  { key: 'students_desc', label: 'Students (most first)' },
  { key: 'name', label: 'Name (A–Z)' },
];

const STUDENT_SORTS = [
  { key: 'attendance_asc', label: 'Attendance (low first)' },
  { key: 'attendance_desc', label: 'Attendance (high first)' },
  { key: 'name', label: 'Name (A–Z)' },
  { key: 'class', label: 'Class, then roll' },
];

const ATTENDANCE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'below', label: `Below ${ATTENDANCE_THRESHOLD}%` },
  { value: 'above', label: `${ATTENDANCE_THRESHOLD}% and above` },
];

/*
 * Department tier: Department · Students · Attendance · At risk · Status ·
 * Chevron. Tight tier keeps Department · Attendance · Status · Chevron — the
 * same four the dashboard's table keeps, for the same reason.
 */
const DEPT_GRID =
  'grid grid-cols-[minmax(0,1.6fr)_84px_minmax(0,132px)_38px] md:grid-cols-[minmax(0,1.5fr)_80px_84px_84px_minmax(0,140px)_38px] gap-x-[12px] items-center px-[16px]';

const STUDENT_GRID =
  'grid grid-cols-[minmax(0,1.6fr)_84px_38px] sm:grid-cols-[minmax(0,1.6fr)_minmax(0,124px)_84px_38px] gap-x-[12px] items-center px-[16px]';

/** The department-level view: six comparisons, not 1,285 rows. */
function DepartmentSummary({ onOpen }) {
  const [query, setQuery] = useState('');
  const [attendance, setAttendance] = useState('');
  const [sortKey, setSortKey] = useState('attendance_asc');
  const [filterOpen, setFilterOpen] = useState(false);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = DEPARTMENT_HEALTH.filter((d) => {
      if (term && ![d.name, d.short].join(' ').toLowerCase().includes(term)) return false;
      if (attendance === 'below' && d.attendance >= ATTENDANCE_THRESHOLD) return false;
      if (attendance === 'above' && d.attendance < ATTENDANCE_THRESHOLD) return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'risk_desc') return b.atRiskCount - a.atRiskCount;
      if (sortKey === 'students_desc') return b.studentCount - a.studentCount;
      return a.attendance - b.attendance;
    });
  }, [query, attendance, sortKey]);

  return (
    <>
      <div className="flex-none flex items-center gap-[8px] mb-[12px]">
        <h1 className="m-0 text-[17px] font-[600] tracking-[-.01em]">Students</h1>
        <span className="text-[11.5px] text-ink-faint tabular-nums" aria-live="polite">
          {INST_STUDENT_TOTAL} across {DEPARTMENT_HEALTH.length} departments
        </span>
        <div className="flex-1" />
        <SearchPopoverField
          value={query}
          onChange={setQuery}
          placeholder="Search department…"
          ariaLabel="Search departments"
        />
        <SortIconPopover options={DEPT_SORTS} value={sortKey} onChange={setSortKey} label="Sort departments" />
        <FilterPopover
          open={filterOpen}
          onOpenChange={setFilterOpen}
          activeCount={attendance ? 1 : 0}
          onClear={() => setAttendance('')}
          iconOnly
          label="Filter departments"
          width={240}
          align="end"
        >
          <FilterSelect label="Attendance" value={attendance} onChange={setAttendance} options={ATTENDANCE_OPTIONS} />
        </FilterPopover>
      </div>

      <StickyTableShell minWidth={340}>
        <div className={cn(DEPT_GRID, STICKY_HEAD, TABLE_HEAD, 'h-[38px]')}>
          <span>Department</span>
          <span className="hidden md:block">Students</span>
          <span>Attendance</span>
          <span className="hidden md:block">At risk</span>
          <span>Status</span>
          <span className="sr-only">Open</span>
        </div>

        {rows.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onOpen(d.id)}
            aria-label={`${d.name} — open student roster`}
            className={cn(
              DEPT_GRID,
              'w-full h-[48px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2'
            )}
          >
            <span className="min-w-0">
              <span className="block text-[13px] text-ink truncate" title={d.name}>
                {d.name}
              </span>
              <span className="block text-[11px] text-ink-faint truncate">{d.classCount} classes</span>
            </span>

            <span className="hidden md:block text-[12.5px] text-ink-muted tabular-nums">{d.studentCount}</span>

            {/* Colour marks the one threshold that means something, and never replaces the number. */}
            <span
              className={cn(
                'text-[13px] tabular-nums',
                d.attendance < ATTENDANCE_THRESHOLD ? 'font-[500] text-danger' : 'text-ink'
              )}
            >
              {d.attendance}%
            </span>

            {/*
              A count, and the share it represents. "142" alone invites the wrong
              comparison between a 250-student department and a 120-student one.
            */}
            <span className="hidden md:block text-[12.5px] tabular-nums">
              {d.atRiskCount === 0 ? (
                <span className="text-ink-faint">—</span>
              ) : (
                <span className="text-ink-muted">
                  {d.atRiskCount}
                  <span className="text-ink-faint"> · {Math.round((d.atRiskCount / d.studentCount) * 100)}%</span>
                </span>
              )}
            </span>

            <span className="min-w-0">
              <span
                className={cn(
                  'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500] max-w-full truncate',
                  DEPT_ATTENTION_STATES[d.attention].tone
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

        {rows.length === 0 &&
          (DEPARTMENT_HEALTH.length === 0 ? <NoDepartments /> : <NoResults what="departments" />)}
      </StickyTableShell>

      <p className="flex-none m-0 mt-[8px] text-[11.5px] text-ink-faint">
        Open a department for its roster · individual attendance, fees and flags are decided by each class tutor.
      </p>
    </>
  );
}

/** One department's roster, reached by asking for it. */
function ScopedRoster({ departmentId, onBack }) {
  const [query, setQuery] = useState('');
  const [attendance, setAttendance] = useState('');
  const [classId, setClassId] = useState('');
  const [sortKey, setSortKey] = useState('attendance_asc');
  const [filterOpen, setFilterOpen] = useState(false);
  const [openId, setOpenId] = useState(null);

  const roster = useMemo(() => studentsOfDepartment(departmentId), [departmentId]);

  const CLASS_OPTIONS = useMemo(
    () => [
      { value: '', label: 'All classes' },
      ...classesOfDepartment(departmentId).map((c) => ({ value: c.id, label: c.code })),
    ],
    [departmentId]
  );

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = roster.filter((s) => {
      if (classId && s.classId !== classId) return false;
      if (term && ![s.name, s.roll, s.reg].join(' ').toLowerCase().includes(term)) return false;
      if (attendance === 'below' && s.attendance >= ATTENDANCE_THRESHOLD) return false;
      if (attendance === 'above' && s.attendance < ATTENDANCE_THRESHOLD) return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'attendance_desc') return b.attendance - a.attendance;
      if (sortKey === 'class') {
        const byClass = (CLASS_BY_ID[a.classId]?.code ?? '').localeCompare(CLASS_BY_ID[b.classId]?.code ?? '');
        return byClass !== 0 ? byClass : Number(a.roll) - Number(b.roll);
      }
      return a.attendance - b.attendance;
    });
  }, [roster, classId, query, attendance, sortKey]);

  const activeFilterCount = [classId, attendance].filter(Boolean).length;

  return (
    <>
      <div className="flex-none flex items-center gap-[8px] flex-wrap mb-[12px]">
        <h1 className="m-0 text-[17px] font-[600] tracking-[-.01em]">
          Students
          {/*
            The scope, stated in the heading rather than only in the crumb — the
            difference between "the institution's students" and "one
            department's" is the whole point of this view, and a reader who
            missed the breadcrumb would otherwise read 250 rows as the total.
          */}
          <span className="text-ink-faint font-[500]"> · {departmentLabel(departmentId)}</span>
        </h1>
        <span className="text-[11.5px] text-ink-faint tabular-nums" aria-live="polite">
          {rows.length === roster.length ? `${roster.length} students` : `${rows.length} of ${roster.length}`}
        </span>

        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-[3px] border-0 bg-transparent p-0 font-sans text-[12px] font-[500] text-accent cursor-pointer hover:underline"
        >
          <ChevronLeft size={13} strokeWidth={2} aria-hidden="true" />
          Back to all departments
        </button>

        <div className="flex-1" />
        <SearchPopoverField
          value={query}
          onChange={setQuery}
          placeholder="Search name, roll, register no…"
          ariaLabel="Search students"
        />
        <SortIconPopover options={STUDENT_SORTS} value={sortKey} onChange={setSortKey} label="Sort students" />
        <FilterPopover
          open={filterOpen}
          onOpenChange={setFilterOpen}
          activeCount={activeFilterCount}
          onClear={() => {
            setClassId('');
            setAttendance('');
          }}
          iconOnly
          label="Filter students"
          width={240}
          align="end"
        >
          <FilterSelect label="Class" value={classId} onChange={setClassId} options={CLASS_OPTIONS} />
          <FilterSelect label="Attendance" value={attendance} onChange={setAttendance} options={ATTENDANCE_OPTIONS} />
        </FilterPopover>
      </div>

      <StickyTableShell minWidth={340}>
        <div className={cn(STUDENT_GRID, STICKY_HEAD, TABLE_HEAD, 'h-[38px]')}>
          <span>Student</span>
          <span className="hidden sm:block">Class</span>
          <span>Attendance</span>
          <span className="sr-only">Open</span>
        </div>

        {rows.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setOpenId(s.id)}
            aria-label={`${s.name}, roll ${s.roll} — open record`}
            className={cn(
              STUDENT_GRID,
              'w-full h-[46px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2'
            )}
          >
            <span className="min-w-0">
              <span className="block text-[13px] text-ink truncate" title={s.name}>
                {s.name}
              </span>
              <span className="block text-[11px] text-ink-faint truncate tabular-nums">
                Roll {s.roll} · {s.reg}
              </span>
            </span>

            <span className="hidden sm:block min-w-0 text-[12.5px] text-ink-muted truncate">
              {classLabel(s.classId)}
            </span>

            <span
              className={cn(
                'text-[13px] tabular-nums',
                s.attendance < ATTENDANCE_THRESHOLD ? 'font-[500] text-danger' : 'text-ink'
              )}
            >
              {s.attendance}%
            </span>

            <span className="flex justify-end text-ink-faint">
              <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
            </span>
          </button>
        ))}

        {rows.length === 0 && (roster.length === 0 ? <EmptyRoster /> : <NoResults what="students" />)}
      </StickyTableShell>

      <p className="flex-none m-0 mt-[8px] text-[11.5px] text-ink-faint">
        Attendance corrections, fees and flags are decided by each class tutor and reviewed by the head of department ·
        this seat reviews and escalates.
      </p>

      <InstitutionStudentDrawer
        student={openId ? rows.find((s) => s.id === openId) ?? null : null}
        onClose={() => setOpenId(null)}
      />
    </>
  );
}

export function InstitutionStudentsView() {
  const [params, setParams] = useSearchParams();
  const deptParam = params.get('dept') ?? '';
  const departmentId = DEPARTMENT_BY_ID[deptParam] ? deptParam : '';

  // The scope lives in the URL so a drill-through is a real, shareable
  // destination rather than transient component state.
  const setDepartmentId = (value) => {
    const next = new URLSearchParams(params);
    if (value) next.set('dept', value);
    else next.delete('dept');
    setParams(next, { replace: true });
  };

  return (
    <div className={PANE}>
      <InstitutionScopeHeader trail={departmentId ? departmentLabel(departmentId) : undefined} />

      {departmentId ? (
        <ScopedRoster
          // Remounts on a department change, so search, filters and sort reset
          // with the scope rather than silently carrying a previous
          // department's class filter into a roster that has no such class.
          key={departmentId}
          departmentId={departmentId}
          onBack={() => setDepartmentId('')}
        />
      ) : (
        <DepartmentSummary onOpen={setDepartmentId} />
      )}
    </div>
  );
}
