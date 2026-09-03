import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { ATTENDANCE_THRESHOLD, CLASS_BY_ID, DEPARTMENT, DEPT_CLASSES } from '../lib/departmentData';
import { DocumentsPendingBadge, StudentOriginBadge } from '../components/StudentOriginBadge';
import { useAcademicRoster } from '@/features/institution';
import { DepartmentScopeHeader } from '../components/DepartmentScopeHeader';
import { DepartmentStudentDrawer } from '../components/DepartmentStudentDrawer';
import { EmptyRoster, NoAssignedDepartment, NoResults } from '../components/InstitutionalState';
import { SearchPopoverField, SortIconPopover } from '../components/ToolbarIcons';
import { FilterPopover, FilterSelect } from '../components/FilterPopover';
import { PANE, STICKY_HEAD, TABLE_HEAD, StickyTableShell } from '../components/WorkspaceLayout';
import { cn } from '../lib/utils';

/**
 * Department → Students.
 *
 * The whole department's roster in one list, across every class. Class is a
 * **column and a filter**, not a scope the page is locked into — an HOD's
 * questions run across classes ("who in the department is below the threshold")
 * as often as within one, and a class-locked page cannot answer the first kind.
 *
 * Monitoring and drill-through only. There is no bulk action here and no
 * approval control: correcting attendance, settling a fee and raising a flag all
 * belong to the class tutor, and an HOD taking them from this page would put the
 * wrong seat on the record. Coming from a class drawer, `?class=` pre-selects
 * that class so the drill-through lands where it said it would.
 */

const SORTS = [
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

const FEE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Correction pending' },
  { value: 'unpaid', label: 'Not paid' },
];

const FLAG_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'clear', label: 'No flag' },
];

const FEE_TONE = {
  paid: 'text-success bg-success-soft',
  pending: 'text-pending bg-pending-soft',
  unpaid: 'text-danger bg-danger-soft',
};
const FEE_LABEL = { paid: 'Paid', pending: 'Correction pending', unpaid: 'Not paid' };

/*
 * Class stays visible from the standard tier up — at department scope a student
 * row without its class is ambiguous, since roll numbers repeat across the six
 * classes. Fee and flag are the columns that demote instead; both live in the
 * drawer.
 */
const GRID =
  'grid grid-cols-[minmax(0,1.6fr)_84px_38px] sm:grid-cols-[minmax(0,1.6fr)_minmax(0,110px)_84px_38px] lg:grid-cols-[minmax(0,1.6fr)_minmax(0,124px)_84px_minmax(0,128px)_minmax(0,110px)_38px] gap-x-[12px] items-center px-[16px]';

export function DepartmentStudentsView() {
  const [params, setParams] = useSearchParams();
  const classParam = params.get('class') ?? '';

  /*
   * The roster comes from the shared institutional layer, not from the module
   * constant. It is the same identity space either way — that is what Phase 0
   * settled — but a student promoted into a class this session, or admitted by
   * their Class Tutor, exists only in the live layer. A department Students page
   * reading the import-time snapshot would be missing people the class screen
   * next to it is already showing.
   */
  const { studentsOfDepartment, studentById } = useAcademicRoster();
  const students = studentsOfDepartment(DEPARTMENT?.id);

  const [query, setQuery] = useState('');
  const [attendance, setAttendance] = useState('');
  const [fee, setFee] = useState('');
  const [flag, setFlag] = useState('');
  const [sortKey, setSortKey] = useState('attendance_asc');
  const [filterOpen, setFilterOpen] = useState(false);
  const [openId, setOpenId] = useState(null);

  // The class filter lives in the URL so a drill-through from a class drawer is
  // a real, shareable destination rather than transient component state.
  const classId = CLASS_BY_ID[classParam] ? classParam : '';
  const setClassId = (value) => {
    const next = new URLSearchParams(params);
    if (value) next.set('class', value);
    else next.delete('class');
    setParams(next, { replace: true });
  };

  const CLASS_OPTIONS = useMemo(
    () => [{ value: '', label: 'All classes' }, ...DEPT_CLASSES.map((c) => ({ value: c.id, label: c.code }))],
    [],
  );

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = students.filter((s) => {
      if (classId && s.classId !== classId) return false;
      if (term && ![s.name, s.roll, s.reg].join(' ').toLowerCase().includes(term)) return false;
      if (attendance === 'below' && s.attendance >= ATTENDANCE_THRESHOLD) return false;
      if (attendance === 'above' && s.attendance < ATTENDANCE_THRESHOLD) return false;
      if (fee && s.feeTier !== fee) return false;
      if (flag === 'flagged' && !s.flag) return false;
      if (flag === 'clear' && s.flag) return false;
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
  }, [students, classId, query, attendance, fee, flag, sortKey]);

  const activeFilterCount = [classId, attendance, fee, flag].filter(Boolean).length;

  function clearFilters() {
    setClassId('');
    setAttendance('');
    setFee('');
    setFlag('');
  }

  if (!DEPARTMENT) {
    return (
      <div className={PANE}>
        <DepartmentScopeHeader dept={null} />
        <StickyTableShell>
          <NoAssignedDepartment />
        </StickyTableShell>
      </div>
    );
  }

  return (
    <div className={PANE}>
      <DepartmentScopeHeader trail={classId ? CLASS_BY_ID[classId].code : undefined} />

      <div className="flex-none flex items-center gap-[8px] mb-[12px]">
        <h1 className="m-0 text-[17px] font-[600] tracking-[-.01em]">Students</h1>
        <span className="text-[11.5px] text-ink-faint tabular-nums" aria-live="polite">
          {rows.length === students.length ? `${students.length} students` : `${rows.length} of ${students.length}`}
        </span>
        <div className="flex-1" />
        <SearchPopoverField
          value={query}
          onChange={setQuery}
          placeholder="Search name, roll, register no…"
          ariaLabel="Search students"
        />
        <SortIconPopover options={SORTS} value={sortKey} onChange={setSortKey} label="Sort students" />
        <FilterPopover
          open={filterOpen}
          onOpenChange={setFilterOpen}
          activeCount={activeFilterCount}
          onClear={clearFilters}
          iconOnly
          label="Filter students"
          width={240}
          align="end"
        >
          <FilterSelect label="Class" value={classId} onChange={setClassId} options={CLASS_OPTIONS} />
          <FilterSelect label="Attendance" value={attendance} onChange={setAttendance} options={ATTENDANCE_OPTIONS} />
          <FilterSelect label="Fee status" value={fee} onChange={setFee} options={FEE_OPTIONS} />
          <FilterSelect label="Flag" value={flag} onChange={setFlag} options={FLAG_OPTIONS} />
        </FilterPopover>
      </div>

      <StickyTableShell minWidth={340}>
        <div className={cn(GRID, STICKY_HEAD, TABLE_HEAD, 'h-[38px]')}>
          <span>Student</span>
          <span className="hidden sm:block">Class</span>
          <span>Attendance</span>
          <span className="hidden lg:block">Fee</span>
          <span className="hidden lg:block">Flag</span>
          <span className="sr-only">Open</span>
        </div>

        {rows.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setOpenId(s.id)}
            aria-label={`${s.name}, roll ${s.roll} — open record`}
            className={cn(
              GRID,
              'w-full h-[58px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2',
            )}
          >
            <span className="min-w-0">
              <span className="block text-[13px] text-ink truncate" title={s.name}>
                {s.name}
              </span>
              <span className="block text-[11px] text-ink-faint truncate tabular-nums">
                Roll {s.roll} · {s.reg}
              </span>
              {/*
                How they arrived, at department scope too. Promoted is the
                ordinary case and reads as one; the exceptional origins are the
                ones worth being able to find.
              */}
              <span className="flex items-center gap-[6px]">
                <StudentOriginBadge origin={s.origin} />
                {s.documentsPending && <DocumentsPendingBadge />}
              </span>
            </span>

            <span className="hidden sm:block min-w-0 text-[12.5px] text-ink-muted truncate">
              {CLASS_BY_ID[s.classId]?.code ?? '—'}
            </span>

            {/* Colour marks the one threshold that means something, and never replaces the number. */}
            <span
              className={cn(
                'text-[13px] tabular-nums',
                s.attendance < ATTENDANCE_THRESHOLD ? 'font-[500] text-danger' : 'text-ink',
              )}
            >
              {s.attendance}%
            </span>

            <span className="hidden lg:block">
              <span
                className={cn(
                  'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
                  FEE_TONE[s.feeTier],
                )}
              >
                {FEE_LABEL[s.feeTier]}
              </span>
            </span>

            <span className="hidden lg:block text-[12px] text-ink-muted truncate">
              {s.flag ? (
                <span className={s.flag.status === 'active' ? 'text-pending' : 'text-ink-faint'}>{s.flag.kind}</span>
              ) : (
                <span className="text-ink-faint">—</span>
              )}
            </span>

            <span className="flex justify-end text-ink-faint">
              <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
            </span>
          </button>
        ))}

        {rows.length === 0 && (students.length === 0 ? <EmptyRoster /> : <NoResults what="students" />)}
      </StickyTableShell>

      <p className="flex-none m-0 mt-[8px] text-[11.5px] text-ink-faint">
        Attendance corrections, fee status and flags are decided by each class tutor · this seat reviews and escalates.
      </p>

      <DepartmentStudentDrawer student={openId ? studentById(openId) : null} onClose={() => setOpenId(null)} />
    </div>
  );
}
