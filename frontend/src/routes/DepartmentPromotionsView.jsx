import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { DEPARTMENT } from '../lib/departmentData';
import { PROMOTION_OUTCOMES, REVIEW_CONTEXT_NOTE, priorClassIndex } from '../lib/promotionData';
import { DepartmentScopeHeader } from '../components/DepartmentScopeHeader';
import { PromotionReviewDrawer } from '../components/PromotionReviewDrawer';
import { NoAssignedDepartment, NoResults } from '../components/InstitutionalState';
import { SearchPopoverField, SortIconPopover } from '../components/ToolbarIcons';
import { FilterPopover, FilterSelect } from '../components/FilterPopover';
import { PANE, STICKY_HEAD, TABLE_HEAD, StickyTableShell, TableEmptyState } from '../components/WorkspaceLayout';
import { useInstitutionalLifecycle } from '../store/InstitutionalLifecycleProvider';
import { useAcademicTerm } from '../store/AcademicTermProvider';
import { cn } from '../lib/utils';

/**
 * Department → Promotions.
 *
 * **A review queue, not a rollover.** The academic year is commenced by the
 * institution head, not here; what is left afterwards is placing the previous
 * band's cohorts into the classes that are now running, one decision at a time.
 * There is no control on this screen that commences anything, and there must
 * never appear to be: a Head of Department reviews placements, it does not open
 * or close a term.
 *
 * **The queue belongs to the term, not to this module.** It is read through the
 * term layer rather than off `REVIEW_CANDIDATES` directly, so that after a
 * commencement this screen shows the cohorts of the term that just closed rather
 * than the ones it was showing before. Until a term changes, the term hands back
 * that same array — the identical records, not a copy — so nothing about this
 * screen's behaviour differs from before it read them this way.
 *
 * **Nothing is decided by opening the page.** Every student here is pending
 * until somebody confirms an outcome for them in the drawer, and the four
 * outcomes are genuinely four different results rather than one flag with four
 * labels — two of them place a student and two of them do not. That stays true
 * across a commencement: an institution head creates this queue and decides
 * nothing in it.
 */

const SORTS = [
  { key: 'recommended', label: 'Needs a closer look first' },
  { key: 'name', label: 'Name (A–Z)' },
  { key: 'class', label: 'Prior class, then roll' },
  { key: 'attendance_asc', label: 'Attendance (low first)' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Awaiting review' },
  { value: 'reviewed', label: 'Reviewed' },
];

const OUTCOME_OPTIONS = [
  { value: '', label: 'All' },
  ...Object.values(PROMOTION_OUTCOMES).map((o) => ({ value: o.key, label: o.resultLabel })),
];

/** Worst standing first — the students a reviewer should not skip past. */
const RECOMMENDATION_RANK = { detain: 0, review: 1, promote: 2 };

const GRID =
  'grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_72px_minmax(0,150px)_38px] md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_78px_72px_minmax(0,160px)_38px] gap-x-[12px] items-center px-[16px]';

function Progress({ progress }) {
  const pct = progress.total === 0 ? 0 : Math.round((progress.reviewed / progress.total) * 100);

  return (
    <section className="flex-none bg-paper border border-line rounded-[16px] px-[14px] py-[12px] mb-[12px]">
      <div className="flex items-baseline gap-[10px] flex-wrap">
        <span className={TABLE_HEAD}>Review progress</span>
        <span className="text-[13px] text-ink tabular-nums">
          {progress.reviewed} of {progress.total} decided
        </span>
        <span className="text-[11.5px] text-ink-faint">{progress.pending} still awaiting a decision</span>
      </div>

      <div
        className="mt-[7px] h-[4px] rounded-full bg-tint2 overflow-hidden"
        role="img"
        aria-label={`${progress.reviewed} of ${progress.total} students decided`}
      >
        <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-[9px] flex items-baseline gap-[16px] flex-wrap">
        {Object.values(PROMOTION_OUTCOMES).map((o) => (
          <span key={o.key} className="text-[11.5px] text-ink-faint">
            <span className="text-[13px] font-[500] text-ink-soft tabular-nums">{progress.byOutcome[o.key] ?? 0}</span>{' '}
            {o.resultLabel.toLowerCase()}
          </span>
        ))}
      </div>
    </section>
  );
}

export function DepartmentPromotionsView() {
  const { reviewOf, reviewProgress, reviews, reviewQueue } = useInstitutionalLifecycle();
  const { priorClasses } = useAcademicTerm();

  const [query, setQuery] = useState('');
  const [priorClass, setPriorClass] = useState('');
  const [status, setStatus] = useState('');
  const [outcome, setOutcome] = useState('');
  const [sortKey, setSortKey] = useState('recommended');
  const [filterOpen, setFilterOpen] = useState(false);
  const [openId, setOpenId] = useState(null);

  const scoped = useMemo(() => reviewQueue.filter((c) => c.departmentId === DEPARTMENT?.id), [reviewQueue]);

  const priorClassById = useMemo(() => priorClassIndex(priorClasses), [priorClasses]);

  /*
   * Built from the term's own prior classes, so the filter offers the cohorts
   * actually in the queue rather than the ones that were in it last term.
   */
  const classOptions = useMemo(
    () => [
      { value: '', label: 'All prior classes' },
      ...priorClasses.map((c) => ({ value: c.id, label: `${c.code} · semester ${c.semester}` })),
    ],
    [priorClasses],
  );

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();

    const filtered = scoped.filter((c) => {
      const review = reviews[c.id] ?? null;
      if (term && ![c.name, c.reg, c.roll].join(' ').toLowerCase().includes(term)) return false;
      if (priorClass && c.priorClassId !== priorClass) return false;
      if (status === 'pending' && review) return false;
      if (status === 'reviewed' && !review) return false;
      if (outcome && review?.outcome !== outcome) return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'attendance_asc') return a.attendance - b.attendance;
      if (sortKey === 'class') {
        return a.priorClassId === b.priorClassId
          ? a.roll.localeCompare(b.roll)
          : a.priorClassId.localeCompare(b.priorClassId);
      }
      const rank = RECOMMENDATION_RANK[a.recommendation] - RECOMMENDATION_RANK[b.recommendation];
      return rank !== 0 ? rank : a.attendance - b.attendance;
    });
  }, [scoped, query, priorClass, status, outcome, sortKey, reviews]);

  const progress = reviewProgress(DEPARTMENT?.id);
  const activeFilterCount = [priorClass, status, outcome].filter(Boolean).length;

  function clearFilters() {
    setPriorClass('');
    setStatus('');
    setOutcome('');
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

  const open = openId ? (scoped.find((c) => c.id === openId) ?? null) : null;

  return (
    <div className={PANE}>
      <DepartmentScopeHeader trail="Promotions" />

      <div className="flex-none flex items-center gap-[8px] mb-[6px]">
        <h1 className="m-0 text-[17px] font-[600] tracking-[-.01em]">Promotions</h1>
        <span className="text-[11.5px] text-ink-faint tabular-nums" aria-live="polite">
          {rows.length === scoped.length ? `${scoped.length} students` : `${rows.length} of ${scoped.length}`}
        </span>
        <div className="flex-1" />
        <SearchPopoverField
          value={query}
          onChange={setQuery}
          placeholder="Search name, register number…"
          ariaLabel="Search students awaiting review"
        />
        <SortIconPopover options={SORTS} value={sortKey} onChange={setSortKey} label="Sort review queue" />
        <FilterPopover
          open={filterOpen}
          onOpenChange={setFilterOpen}
          activeCount={activeFilterCount}
          onClear={clearFilters}
          iconOnly
          label="Filter review queue"
          width={250}
          align="end"
        >
          <FilterSelect label="Prior class" value={priorClass} onChange={setPriorClass} options={classOptions} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          <FilterSelect label="Outcome" value={outcome} onChange={setOutcome} options={OUTCOME_OPTIONS} />
        </FilterPopover>
      </div>

      {/*
        The one line that says what this screen is. It names a *review*, and
        names when placements happen — nothing on this page commences a semester,
        and the copy must not let it look as though it does.
      */}
      <p className="flex-none m-0 mb-[12px] text-[12px] text-ink-muted">{REVIEW_CONTEXT_NOTE}</p>

      <Progress progress={progress} />

      <StickyTableShell minWidth={420}>
        <div className={cn(GRID, STICKY_HEAD, TABLE_HEAD, 'h-[38px]')}>
          <span>Student</span>
          <span>Prior class</span>
          <span className="hidden md:block">Attendance</span>
          <span>Backlogs</span>
          <span>Outcome</span>
          <span className="sr-only">Open</span>
        </div>

        {rows.map((c) => {
          const review = reviewOf(c.id);
          const prior = priorClassById[c.priorClassId];

          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setOpenId(c.id)}
              aria-label={`${c.name} — review placement`}
              className={cn(
                GRID,
                'w-full h-[48px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2',
              )}
            >
              <span className="min-w-0">
                <span className="block text-[13px] text-ink truncate" title={c.name}>
                  {c.name}
                </span>
                <span className="block text-[11px] text-ink-faint truncate tabular-nums">{c.reg}</span>
              </span>

              <span className="min-w-0 text-[12.5px] text-ink-muted truncate" title={prior?.code}>
                {prior?.code}
                <span className="block text-[11px] text-ink-faint">Semester {c.semester}</span>
              </span>

              <span className="hidden md:block text-[12.5px] text-ink-muted tabular-nums">{c.attendance}%</span>

              <span
                className={cn(
                  'text-[12.5px] tabular-nums',
                  c.backlogCount >= 2 ? 'font-[500] text-danger' : 'text-ink-muted',
                )}
              >
                {c.backlogCount === 0 ? <span className="text-ink-faint">—</span> : c.backlogCount}
              </span>

              <span className="min-w-0">
                {review ? (
                  <span
                    className={cn(
                      'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500] max-w-full truncate',
                      PROMOTION_OUTCOMES[review.outcome].tone,
                    )}
                  >
                    {PROMOTION_OUTCOMES[review.outcome].resultLabel}
                  </span>
                ) : (
                  <span className="inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500] text-ink-muted bg-tint2">
                    Awaiting review
                  </span>
                )}
              </span>

              <span className="flex justify-end text-ink-faint">
                <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
              </span>
            </button>
          );
        })}

        {rows.length === 0 &&
          (scoped.length === 0 ? (
            <TableEmptyState
              title="No cohort is awaiting placement."
              hint="Students from the previous semester band would be listed here for review."
            />
          ) : (
            <NoResults what="students" />
          ))}
      </StickyTableShell>

      <p className="flex-none m-0 mt-[8px] text-[11.5px] text-ink-faint">
        A confirmed promotion places the same student record in the next semester · assigning a class tutor is a
        separate decision.
      </p>

      <PromotionReviewDrawer candidate={open} onClose={() => setOpenId(null)} />
    </div>
  );
}
