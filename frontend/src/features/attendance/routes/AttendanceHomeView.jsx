import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MY_PERIODS_TODAY, SUBSTITUTE_DUTIES_TODAY, periodTimePhase } from '../lib/attendanceData';
import { useAttendanceStore } from '../store/attendanceStore';
import { useAttendanceLedger, LEDGER_SORTS } from '../hooks/useAttendanceLedger';
import { useSubstitute } from '@/hooks/useSubstitute';
import { TodaysScheduleTable } from '@/components/TodaysScheduleTable';
import { AttendanceActionDrawer } from '../components/AttendanceActionDrawer';
import { SubstituteRequestDrawer } from '@/components/SubstituteRequestDrawer';
import { SubstitutePane } from '@/components/SubstitutePane';
import { SubjectScopeSelector, SubjectSummaryStrip } from '@/components/SubjectScopeSelector';
import { StudentLedgerTable } from '@/components/StudentLedgerTable';
import { StudentAbsenceDrawer } from '@/components/StudentAbsenceDrawer';
import { LedgerFilterPopover, LedgerChips } from '@/components/LedgerFilters';
import { SearchPopoverField, SortIconPopover } from '@/components/ToolbarIcons';
import { FilterPopover, FilterSelect } from '@/components/FilterPopover';
import { PANE } from '@/components/WorkspaceLayout';
import { dayKeyOffset, myPeriodsOnDate } from '@/lib/substituteData';
import { cn } from '@/lib/utils';

/** Own periods and approved substitute duties for today, one combined list — strict ascending IST start-time order. */
const TODAYS_SCHEDULE = [...MY_PERIODS_TODAY, ...SUBSTITUTE_DUTIES_TODAY].sort((a, b) => a.startTime - b.startTime);

const SUB_TABS = [
  { key: 'today', label: 'Today’s schedule' },
  { key: 'history', label: 'Attendance history' },
  { key: 'substitute', label: 'Substitute' },
];

/**
 * **Secondary** navigation — a contextual sub-view switcher that exists only
 * while the Attendance primary tab is open, and is built to be unmistakably
 * lighter than the primary row above it: 12.5px against 14.5px, a soft
 * selected surface with a short 1px teal indicator instead of the primary's
 * full 2px underline, tighter spacing, muted inactive labels, and no
 * full-width bottom rule. It doubles as the view's label, so no pane repeats
 * its own name as a heading, and the active view's compact controls share the
 * row rather than claiming another.
 *
 * `overflow-y-hidden` is load-bearing: `overflow-x-auto` alone makes the
 * computed `overflow-y` become `auto`, and a sub-pixel of overflow is enough
 * to raise a vertical scrollbar that reads as a stray line beside the last
 * tab. There are no separators between these tabs by design.
 */
function SubTabsRow({ value, onChange, children }) {
  return (
    /* Trims the shared pane's 18px top padding to a 16px gap below the primary row. */
    <div className="flex-none flex items-center gap-[8px] -mt-[6px] mb-[12px]">
      <div
        role="tablist"
        aria-label="Attendance views"
        className="flex items-center gap-[4px] overflow-x-auto overflow-y-hidden scroll-quiet"
      >
        {SUB_TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={value === key}
            onClick={() => onChange(key)}
            className={cn(
              'relative flex-none h-[27px] px-[10px] border-0 rounded-[8px] bg-transparent font-sans text-[12.5px] whitespace-nowrap cursor-pointer transition-colors duration-200',
              value === key
                ? 'bg-accent-soft text-accent font-[600]'
                : 'text-ink-muted font-[500] hover:text-ink hover:bg-tint2',
            )}
          >
            {label}
            {value === key && (
              // A short 1px indicator — deliberately not the primary row's full 2px underline.
              <span
                aria-hidden="true"
                className="absolute left-[10px] right-[10px] bottom-[3px] h-px rounded-full bg-accent"
              />
            )}
          </button>
        ))}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-[6px]">{children}</div>
    </div>
  );
}

function useTodaysSchedule() {
  const { now, sessions, phaseFor, acknowledged } = useAttendanceStore();
  const [query, setQuery] = useState('');
  const [ownership, setOwnership] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return TODAYS_SCHEDULE.filter((period) => {
      if (ownership && period.ownership !== ownership) return false;
      if (!term) return true;
      const haystack = [period.subject, period.code, period.programme, period.section, period.batch]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    }).map((period) => ({
      period,
      phase: phaseFor(period.id),
      session: sessions[period.id],
      acknowledged: !!acknowledged[period.id],
    }));
  }, [query, ownership, phaseFor, sessions, acknowledged]);

  /** The period the clock is inside right now — gets the quiet teal edge. */
  const currentPeriodId = useMemo(
    () => TODAYS_SCHEDULE.find((p) => periodTimePhase(p, now) === 'current')?.id ?? null,
    [now],
  );

  return {
    rows,
    currentPeriodId,
    query,
    setQuery,
    ownership,
    setOwnership,
    filterOpen,
    setFilterOpen,
    activeFilterCount: ownership ? 1 : 0,
  };
}

function TodayControls({ t }) {
  return (
    <>
      <SearchPopoverField
        value={t.query}
        onChange={t.setQuery}
        placeholder="Search subject, class…"
        ariaLabel="Search today's schedule"
      />
      <FilterPopover
        open={t.filterOpen}
        onOpenChange={t.setFilterOpen}
        activeCount={t.activeFilterCount}
        onClear={() => t.setOwnership('')}
        iconOnly
        label="Filter today's schedule"
        width={220}
        align="end"
      >
        <FilterSelect
          label="Ownership"
          value={t.ownership}
          onChange={t.setOwnership}
          options={[
            { value: '', label: 'All' },
            { value: 'own', label: 'My class' },
            { value: 'substitute', label: 'Substitute duty' },
          ]}
        />
      </FilterPopover>
    </>
  );
}

function HistoryControls({ l }) {
  return (
    <>
      <SearchPopoverField
        value={l.query}
        onChange={l.setQuery}
        placeholder="Search name, roll, register no…"
        ariaLabel="Search students"
      />
      <SortIconPopover options={LEDGER_SORTS} value={l.sortKey} onChange={l.setSortKey} label="Sort students" />
      <LedgerFilterPopover l={l} />
    </>
  );
}

/**
 * Attendance history as a subject ledger, not a list of taught hours: pick a
 * subject, read the class-level summary, then scan one row per student. Exact
 * absence dates stay one click away in a right-side drawer so the table
 * answers the common question without carrying the rare one.
 */
function HistoryPane({ l }) {
  return (
    <>
      <div className="flex-none flex items-center gap-[12px] flex-wrap mb-[12px]">
        <SubjectScopeSelector subjects={l.subjects} value={l.subjectKey} onChange={l.setSubjectKey} />
        <div className="flex-1" />
        <SubjectSummaryStrip ledger={l.ledger} />
      </div>

      <LedgerChips chips={l.activeChips} onRemove={l.removeChip} onClearAll={l.clearFilters} />

      <div className="flex-none flex items-center mb-[8px]">
        <span aria-live="polite" className="text-[11.5px] text-ink-faint">
          {l.resultCountLabel}
        </span>
      </div>

      <StudentLedgerTable
        students={l.students}
        hasAnyStudents={(l.ledger?.students.length ?? 0) > 0}
        onOpenStudent={l.openStudent}
      />

      <StudentAbsenceDrawer
        student={l.selectedStudent}
        subject={l.ledger?.subject}
        now={l.now}
        onClose={l.closeStudent}
      />
    </>
  );
}

/**
 * The Attendance primary tab. Today's schedule, Attendance history and
 * Substitute are secondary tabs inside this one pane — never stacked
 * sections, never their own detached route: the AppShell, sidebar and
 * Back/Forward controls stay put and only the content below the tab row
 * swaps.
 *
 * All three view hooks stay mounted across a switch, so each keeps its own
 * search/filter/sort — and history keeps its selected subject and open
 * student — when the user comes back to it. Every operational action opens a
 * right-side drawer over this pane rather than navigating.
 */
export function AttendanceHomeView() {
  const [subTab, setSubTab] = useState('today');
  const [coverPrefill, setCoverPrefill] = useState(null);
  // A deep link (`?period=…`) opens the drawer over this pane instead of a page of its own.
  const [searchParams, setSearchParams] = useSearchParams();
  const [localPeriodId, setLocalPeriodId] = useState(null);
  const drawerPeriodId = localPeriodId ?? searchParams.get('period');

  const closeDrawer = () => {
    setLocalPeriodId(null);
    if (searchParams.has('period')) {
      const next = new URLSearchParams(searchParams);
      next.delete('period');
      setSearchParams(next, { replace: true });
    }
  };

  const t = useTodaysSchedule();
  const l = useAttendanceLedger();
  const s = useSubstitute();

  /**
   * "Request cover" from a scheduled period opens the request drawer already
   * pointed at that period — matched against the staff member's own approved
   * timetable, so the request can only ever name a period they actually own.
   */
  const openCoverRequest = (period) => {
    const dateKey = dayKeyOffset(0);
    const match = myPeriodsOnDate(dateKey).find((p) => p.subject === period.subject && p.code === period.code);
    setCoverPrefill({ dateKey, scope: 'period', slotKey: match?.slotKey ?? null });
  };

  return (
    <div className={PANE}>
      <SubTabsRow value={subTab} onChange={setSubTab}>
        {subTab === 'today' && <TodayControls t={t} />}
        {subTab === 'history' && <HistoryControls l={l} />}
      </SubTabsRow>

      {subTab === 'today' && (
        <TodaysScheduleTable
          rows={t.rows}
          hasAnyPeriods={TODAYS_SCHEDULE.length > 0}
          currentPeriodId={t.currentPeriodId}
          onOpen={setLocalPeriodId}
          onRequestCover={openCoverRequest}
        />
      )}
      {subTab === 'history' && <HistoryPane l={l} />}
      {subTab === 'substitute' && <SubstitutePane s={s} onOpenPeriod={setLocalPeriodId} />}

      <AttendanceActionDrawer periodId={drawerPeriodId} onClose={closeDrawer} />

      <SubstituteRequestDrawer open={!!coverPrefill} prefill={coverPrefill} onClose={() => setCoverPrefill(null)} />
    </div>
  );
}
