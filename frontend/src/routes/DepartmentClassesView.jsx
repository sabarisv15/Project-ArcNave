import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { DEPARTMENT } from '../lib/departmentData';
import { ACTIVE_BAND, BAND_SEMESTERS } from '../lib/academicCalendar';
import { TIMETABLE_STATE_LABELS, TIMETABLE_STATE_TONE } from '../lib/timetableState';
import { seatTitle } from '../lib/seatTitles';
import { CLASS_TUTOR_L4 } from '../lib/roles';
import { DepartmentScopeHeader } from '../components/DepartmentScopeHeader';
import { DepartmentClassDrawer } from '../components/DepartmentClassDrawer';
import { DepartmentSeatDrawer } from '../components/DepartmentSeatDrawer';
import { SeatStateBadge } from '../components/SeatStateBadge';
import { NoAssignedDepartment, NoClasses, NoResults } from '../components/InstitutionalState';
import { SearchPopoverField, SortIconPopover } from '../components/ToolbarIcons';
import { FilterPopover, FilterSelect } from '../components/FilterPopover';
import { PANE, STICKY_HEAD, TABLE_HEAD, StickyTableShell } from '../components/WorkspaceLayout';
import { useDepartmentClasses } from '../hooks/useDepartmentClasses';
import { cn } from '../lib/utils';

/**
 * Department → Classes.
 *
 * Every active class in the department, and the seat that runs it. There is no
 * class switcher and no "my class" scope, because this seat has neither — the
 * difference from the tutor's screen is not that more classes are let through a
 * filter, it is that the department *is* the scope.
 *
 * **The Class Tutor seat is managed from here and only from here.** Its cell is
 * its own control, opening a drawer that exists for nothing else. It is
 * deliberately not an editable field on a class record: a seat is an
 * institutional position with a scope and a handover history, and offering it
 * beside a section's capacity would make it read as an attribute of the class
 * rather than a decision about who is accountable for one.
 *
 * Capacity, enrolment, timetable state and attendance readiness are read live. A
 * promotion confirmed on the Promotions screen changes the enrolled figure here,
 * and a row that reported its count at page load would contradict the screen
 * beside it.
 */

const SORTS = [
  { key: 'seat', label: 'Uncovered seats first' },
  { key: 'code', label: 'Class (A–Z)' },
  { key: 'fill_desc', label: 'Fullest first' },
  { key: 'attendance_asc', label: 'Attendance (low first)' },
];

/**
 * The filter axis is the **semester**, not the year.
 *
 * Only one band runs at a time, so what distinguishes the classes on this screen
 * is which semester of that band they are in. The options are derived from the
 * active band rather than listed, so they cannot drift from the classes the
 * table is showing, and an odd term produces 3 · 5 · 7 here without this file
 * changing. A first-year option cannot appear, because neither band contains
 * semester 1 or 2.
 */
const SEMESTER_OPTIONS = [
  { value: '', label: 'All semesters' },
  ...BAND_SEMESTERS[ACTIVE_BAND].map((s) => ({ value: String(s), label: `Semester ${s}` })),
];

const SEAT_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'invite_pending', label: 'Invite pending' },
  { value: 'vacant', label: 'Vacant' },
];

const TIMETABLE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'approved', label: 'Approved' },
  { value: 'pending', label: 'Under review' },
  { value: 'not_submitted', label: 'Not submitted' },
];

/** An uncovered seat outranks an invited one, which outranks a held one. */
const SEAT_RANK = { vacant: 0, invite_pending: 1, active: 2 };

const GRID =
  'grid grid-cols-[minmax(0,1.4fr)_92px_minmax(0,132px)_38px] md:grid-cols-[minmax(0,1.2fr)_100px_minmax(0,118px)_minmax(0,1.1fr)_minmax(0,132px)_38px] gap-x-[12px] items-center px-[16px]';

export function DepartmentClassesView() {
  const navigate = useNavigate();
  const { classes, totals, seatCoverage } = useDepartmentClasses();

  const [query, setQuery] = useState('');
  const [semester, setSemester] = useState('');
  const [seatState, setSeatState] = useState('');
  const [timetable, setTimetable] = useState('');
  const [sortKey, setSortKey] = useState('seat');
  const [filterOpen, setFilterOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [seatClassId, setSeatClassId] = useState(null);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = classes.filter((c) => {
      if (term && ![c.code, c.programme, c.tutor?.name ?? ''].join(' ').toLowerCase().includes(term)) return false;
      if (semester && String(c.semester) !== semester) return false;
      if (seatState && c.seatState !== seatState) return false;
      if (timetable && c.timetableState !== timetable) return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortKey === 'code') return a.code.localeCompare(b.code);
      if (sortKey === 'attendance_asc') return a.attendance - b.attendance;
      if (sortKey === 'fill_desc') return b.enrolled / b.capacity - a.enrolled / a.capacity;
      const rank = SEAT_RANK[a.seatState] - SEAT_RANK[b.seatState];
      return rank !== 0 ? rank : a.code.localeCompare(b.code);
    });
  }, [classes, query, semester, seatState, timetable, sortKey]);

  const activeFilterCount = [semester, seatState, timetable].filter(Boolean).length;

  function clearFilters() {
    setSemester('');
    setSeatState('');
    setTimetable('');
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

  const open = openId ? classes.find((c) => c.id === openId) ?? null : null;
  const seatClass = seatClassId ? classes.find((c) => c.id === seatClassId) ?? null : null;
  const tutorWord = seatTitle(CLASS_TUTOR_L4);

  return (
    <div className={PANE}>
      <DepartmentScopeHeader />

      <div className="flex-none flex items-center gap-[8px] mb-[12px]">
        <h1 className="m-0 text-[17px] font-[600] tracking-[-.01em]">Classes</h1>
        <span className="text-[11.5px] text-ink-faint tabular-nums" aria-live="polite">
          {rows.length === classes.length ? `${classes.length} classes` : `${rows.length} of ${classes.length}`}
        </span>
        <div className="flex-1" />
        <SearchPopoverField
          value={query}
          onChange={setQuery}
          placeholder="Search class, programme, tutor…"
          ariaLabel="Search classes"
        />
        <SortIconPopover options={SORTS} value={sortKey} onChange={setSortKey} label="Sort classes" />
        <FilterPopover
          open={filterOpen}
          onOpenChange={setFilterOpen}
          activeCount={activeFilterCount}
          onClear={clearFilters}
          iconOnly
          label="Filter classes"
          width={250}
          align="end"
        >
          <FilterSelect label="Semester" value={semester} onChange={setSemester} options={SEMESTER_OPTIONS} />
          <FilterSelect label={`${tutorWord} seat`} value={seatState} onChange={setSeatState} options={SEAT_OPTIONS} />
          <FilterSelect label="Timetable" value={timetable} onChange={setTimetable} options={TIMETABLE_OPTIONS} />
        </FilterPopover>
      </div>

      {/* Derived, never asserted: this is the table below, counted. */}
      <p className="flex-none m-0 mb-[10px] text-[12px] text-ink-muted">
        {totals.enrolled} enrolled against {totals.capacity} provisioned seats · {seatCoverage.active} of{' '}
        {seatCoverage.total} {tutorWord.toLowerCase()} seats held
        {seatCoverage.invited > 0 ? `, ${seatCoverage.invited} awaiting acceptance` : ''}
        {seatCoverage.vacant > 0 ? `, ${seatCoverage.vacant} vacant` : ''}
      </p>

      <StickyTableShell minWidth={420}>
        <div className={cn(GRID, STICKY_HEAD, TABLE_HEAD, 'h-[38px]')}>
          <span>Class</span>
          <span>Enrolled</span>
          <span className="hidden md:block">Timetable</span>
          <span className="hidden md:block">{tutorWord}</span>
          <span>Seat</span>
          <span className="sr-only">Open</span>
        </div>

        {rows.map((c) => (
          <div
            key={c.id}
            className={cn(GRID, 'border-t border-line-light transition-colors duration-200 hover:bg-tint2')}
          >
            <button
              type="button"
              onClick={() => setOpenId(c.id)}
              aria-label={`${c.code} — open class`}
              className="min-w-0 h-[54px] flex flex-col justify-center border-0 bg-transparent p-0 text-left cursor-pointer"
            >
              <span className="block text-[13px] text-ink truncate" title={c.code}>
                {c.code}
              </span>
              <span className="block text-[11px] text-ink-faint truncate">
                Semester {c.semester} · section {c.section}
              </span>
            </button>

            <span className="text-[12.5px] text-ink tabular-nums">
              {c.enrolled}
              <span className="text-ink-faint"> / {c.capacity}</span>
              <span className="block text-[11px] text-ink-faint">
                {c.headroom === 0 ? 'full' : `${c.headroom} free`}
              </span>
            </span>

            <span className="hidden md:block min-w-0">
              <span
                className={cn(
                  'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500] max-w-full truncate',
                  TIMETABLE_STATE_TONE[c.timetableState]
                )}
              >
                {TIMETABLE_STATE_LABELS[c.timetableState]}
              </span>
              {/*
                Stated as a consequence, never as a switch. Attendance follows an
                approved timetable and an active year; no seat turns it on, and
                holding this class's tutor seat has nothing to do with it.
              */}
              <span className="block mt-[2px] text-[11px] text-ink-faint">
                {c.attendanceLive ? 'Attendance live' : 'Attendance locked'}
              </span>
            </span>

            <span className="hidden md:block min-w-0 text-[12.5px] truncate">
              {c.tutor ? (
                <>
                  <span className="block text-ink-muted truncate" title={c.tutor.name}>
                    {c.tutor.name}
                  </span>
                  {c.seat?.history?.length > 0 && (
                    <span className="block text-[11px] text-ink-faint truncate">
                      {c.seat.history.length} handover{c.seat.history.length > 1 ? 's' : ''}
                    </span>
                  )}
                </>
              ) : c.seatState === 'invite_pending' ? (
                <span className="block text-pending truncate" title={c.seat?.invitedEmail ?? ''}>
                  {c.seat?.invitedEmail ?? 'Invitation out'}
                </span>
              ) : (
                <span className="text-danger font-[500]">Nobody</span>
              )}
            </span>

            {/*
              The seat is its own control, not a cell in a class-edit form. This
              is the only route to changing who holds it.
            */}
            <span className="min-w-0">
              <button
                type="button"
                onClick={() => setSeatClassId(c.id)}
                aria-label={`${c.code} — manage ${tutorWord.toLowerCase()} seat`}
                className="border-0 bg-transparent p-0 cursor-pointer"
              >
                <SeatStateBadge state={c.seatState} />
              </button>
            </span>

            <button
              type="button"
              onClick={() => setOpenId(c.id)}
              aria-label={`${c.code} — open class details`}
              className="flex justify-end items-center h-[54px] border-0 bg-transparent p-0 text-ink-faint cursor-pointer"
            >
              <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        ))}

        {rows.length === 0 && (classes.length === 0 ? <NoClasses /> : <NoResults what="classes" />)}
      </StickyTableShell>

      <DepartmentClassDrawer
        cls={open}
        onClose={() => setOpenId(null)}
        onOpenStudents={(classId) => {
          setOpenId(null);
          navigate(`/department/students?class=${encodeURIComponent(classId)}`);
        }}
        onManageSeat={(classId) => {
          setOpenId(null);
          setSeatClassId(classId);
        }}
      />

      <DepartmentSeatDrawer cls={seatClass} onClose={() => setSeatClassId(null)} />
    </div>
  );
}
