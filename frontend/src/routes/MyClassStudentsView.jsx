import { useMemo, useState } from 'react';
import { ChevronRight, Plus, Upload } from 'lucide-react';
import { ATTENDANCE_THRESHOLD, OWNED_CLASS } from '../lib/classTutorData';
import { useAcademicRoster } from '../store/AcademicRosterProvider';
import { ClassScopeHeader } from '../components/ClassScopeHeader';
import { ClassStudentDrawer } from '../components/ClassStudentDrawer';
import { AdmissionWizard } from '../components/AdmissionWizard';
import { BulkImportDrawer } from '../components/BulkImportDrawer';
import { CapacityMeter } from '../components/CapacityMeter';
import { DocumentsPendingBadge, StudentOriginBadge } from '../components/StudentOriginBadge';
import { EmptyRoster, NoAssignedClass, NoResults } from '../components/InstitutionalState';
import { SearchPopoverField, SortIconPopover } from '../components/ToolbarIcons';
import { FilterPopover, FilterSelect } from '../components/FilterPopover';
import { PANE, STICKY_HEAD, TABLE_HEAD, StickyTableShell } from '../components/WorkspaceLayout';
import { cn } from '../lib/utils';

const SORTS = [
  { key: 'roll', label: 'Roll no' },
  { key: 'name', label: 'Name (A–Z)' },
  { key: 'attendance_asc', label: 'Attendance (low first)' },
  { key: 'attendance_desc', label: 'Attendance (high first)' },
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

const ORIGIN_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'promoted', label: 'Promoted in' },
  { value: 'new', label: 'Newly added' },
  { value: 'documents_pending', label: 'Documents pending' },
];

const GRID = 'grid grid-cols-[56px_1.7fr_140px_112px_128px_120px_44px] gap-x-[12px] items-center px-[16px]';

const FEE_TONE = {
  paid: 'text-success bg-success-soft',
  pending: 'text-pending bg-pending-soft',
  unpaid: 'text-danger bg-danger-soft',
};
const FEE_LABEL = { paid: 'Paid', pending: 'Correction pending', unpaid: 'Not paid' };

/**
 * Curriculum → Students, for the Class Tutor seat.
 *
 * The whole page is one class. There is no class switcher and no "all my
 * classes" scope, because this seat has neither — the difference from the
 * teaching-staff roster is not that some classes are filtered out, it is that
 * only one exists. Anything that would let this screen show a second class
 * would be describing a different seat.
 */
export function MyClassStudentsView() {
  /*
   * The roster comes from the shared academic-roster layer, not from the
   * fixture module. A student admitted or imported here is activated in the
   * real active class roster, and the department and institution workspaces
   * have to resolve the same record by the same id — reading the immutable
   * fixture directly would render a roster that is already out of date.
   */
  const { studentsOfClass, classFill } = useAcademicRoster();
  const roster = studentsOfClass(OWNED_CLASS.id);
  const fill = classFill(OWNED_CLASS.id);
  const studentById = useMemo(() => Object.fromEntries(roster.map((s) => [s.id, s])), [roster]);

  const [query, setQuery] = useState('');
  const [attendance, setAttendance] = useState('');
  const [fee, setFee] = useState('');
  const [flag, setFlag] = useState('');
  const [origin, setOrigin] = useState('');
  const [sortKey, setSortKey] = useState('roll');
  const [filterOpen, setFilterOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [admitOpen, setAdmitOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = roster.filter((s) => {
      if (term && ![s.name, s.roll, s.reg].join(' ').toLowerCase().includes(term)) return false;
      if (attendance === 'below' && s.attendance >= ATTENDANCE_THRESHOLD) return false;
      if (attendance === 'above' && s.attendance < ATTENDANCE_THRESHOLD) return false;
      if (fee && s.feeTier !== fee) return false;
      if (flag === 'flagged' && !s.flag) return false;
      if (flag === 'clear' && s.flag) return false;
      if (origin === 'promoted' && s.origin !== 'promoted') return false;
      if (origin === 'new' && s.origin === 'promoted') return false;
      if (origin === 'documents_pending' && !s.documentsPending) return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'attendance_asc') return a.attendance - b.attendance;
      if (sortKey === 'attendance_desc') return b.attendance - a.attendance;
      return Number(a.roll) - Number(b.roll);
    });
  }, [roster, query, attendance, fee, flag, origin, sortKey]);

  const activeFilterCount = [attendance, fee, flag, origin].filter(Boolean).length;

  function clearFilters() {
    setAttendance('');
    setFee('');
    setFlag('');
    setOrigin('');
  }

  if (!OWNED_CLASS) {
    return (
      <div className={PANE}>
        <ClassScopeHeader cls={null} />
        <StickyTableShell>
          <NoAssignedClass />
        </StickyTableShell>
      </div>
    );
  }

  return (
    <div className={PANE}>
      <ClassScopeHeader />

      <div className="flex-none flex items-center gap-[8px] mb-[12px]">
        <h1 className="m-0 text-[17px] font-[600] tracking-[-.01em]">Students</h1>
        <span className="text-[11.5px] text-ink-faint tabular-nums" aria-live="polite">
          {rows.length === roster.length ? `${roster.length} students` : `${rows.length} of ${roster.length}`}
        </span>
        <CapacityMeter enrolled={fill.enrolled} capacity={fill.capacity} className="ml-[6px]" />
        <div className="flex-1" />
        {/*
          The two ways a genuinely new student joins this class. Both are
          bounded by the section's provisioned capacity, so both disappear
          rather than fail once it is full — an action that cannot succeed is
          worse than no action.
        */}
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          disabled={fill.headroom === 0}
          className="inline-flex items-center gap-[5px] h-[30px] px-[10px] border border-line rounded-[9px] bg-paper font-sans text-[12.5px] font-[500] text-ink-soft cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink disabled:text-ink-disabled disabled:cursor-not-allowed disabled:hover:bg-paper"
        >
          <Upload size={13} strokeWidth={2} aria-hidden="true" />
          Import
        </button>
        <button
          type="button"
          onClick={() => setAdmitOpen(true)}
          disabled={fill.headroom === 0}
          className="inline-flex items-center gap-[5px] h-[30px] px-[10px] border border-accent-line rounded-[9px] bg-accent-soft font-sans text-[12.5px] font-[600] text-accent cursor-pointer transition-colors duration-200 hover:bg-accent-soft/70 disabled:text-ink-disabled disabled:border-line disabled:bg-paper disabled:cursor-not-allowed"
        >
          <Plus size={13} strokeWidth={2.2} aria-hidden="true" />
          Add student
        </button>
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
          width={230}
          align="end"
        >
          <FilterSelect label="Attendance" value={attendance} onChange={setAttendance} options={ATTENDANCE_OPTIONS} />
          <FilterSelect label="Fee status" value={fee} onChange={setFee} options={FEE_OPTIONS} />
          <FilterSelect label="Flag" value={flag} onChange={setFlag} options={FLAG_OPTIONS} />
          <FilterSelect label="How they joined" value={origin} onChange={setOrigin} options={ORIGIN_OPTIONS} />
        </FilterPopover>
      </div>

      <StickyTableShell minWidth={760}>
        <div className={cn(GRID, STICKY_HEAD, TABLE_HEAD, 'h-[38px]')}>
          <span>Roll</span>
          <span>Student</span>
          <span>Joined</span>
          <span>Attendance</span>
          <span>Fee</span>
          <span>Flag</span>
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
              'w-full h-[46px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2',
            )}
          >
            <span className="text-[12.5px] text-ink-muted tabular-nums">{s.roll}</span>

            <span className="min-w-0 flex items-baseline gap-[8px]">
              <span className="text-[13px] text-ink truncate" title={s.name}>
                {s.name}
              </span>
              <span className="flex-none text-[11px] text-ink-faint tabular-nums">{s.reg}</span>
            </span>

            {/*
              How they joined, and whether anything is outstanding. A promoted
              student is already placed — the roster is where they arrive, and
              no onboarding action is offered for them anywhere on this screen.
            */}
            <span className="min-w-0 flex flex-col gap-[2px]">
              <StudentOriginBadge origin={s.origin} />
              {s.documentsPending && <DocumentsPendingBadge />}
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

            <span>
              <span
                className={cn(
                  'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
                  FEE_TONE[s.feeTier],
                )}
              >
                {FEE_LABEL[s.feeTier]}
              </span>
              {s.feeTier === 'paid' && !s.feeReceipt && (
                <span className="block mt-[1px] text-[10.5px] text-ink-faint">No receipt</span>
              )}
            </span>

            <span className="text-[12px] text-ink-muted truncate">
              {s.flag ? (
                <span className={s.flag.status === 'active' ? 'text-pending' : 'text-ink-faint'}>
                  {s.flag.kind}
                  {s.flag.status === 'cleared' && ' (cleared)'}
                </span>
              ) : (
                <span className="text-ink-faint">—</span>
              )}
            </span>

            <span className="flex justify-end text-ink-faint">
              <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
            </span>
          </button>
        ))}

        {rows.length === 0 && (roster.length === 0 ? <EmptyRoster /> : <NoResults what="students" />)}
      </StickyTableShell>

      <ClassStudentDrawer student={openId ? studentById[openId] : null} onClose={() => setOpenId(null)} />

      <AdmissionWizard open={admitOpen} onOpenChange={setAdmitOpen} />
      <BulkImportDrawer open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
