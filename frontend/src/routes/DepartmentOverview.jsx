import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { ATTENDANCE_THRESHOLD, DEPARTMENT, DEPT_FACULTY } from '../lib/departmentData';
import { ACADEMIC_YEAR } from '../lib/academicCalendar';
import { ATTENTION_STATES, NEEDS_ATTENTION } from '../lib/departmentSignals';
import { DEPT_PENDING, DEPT_REQUEST_KINDS } from '../lib/departmentApprovalsData';
import { REVIEW_CONTEXT_NOTE } from '../lib/promotionData';
import { seatTitle } from '../lib/seatTitles';
import { CLASS_TUTOR_L4, HOD_L3 } from '../lib/roles';
import { DepartmentScopeHeader } from '../components/DepartmentScopeHeader';
import { NoAssignedDepartment, NoClasses, NothingPending } from '../components/InstitutionalState';
import { TABLE_HEAD, TableEmptyState } from '../components/WorkspaceLayout';
import { useDepartmentClasses } from '../hooks/useDepartmentClasses';
import { useAcademicRoster, useAcademicTerm, useInstitutionalLifecycle } from '@/features/institution';
import { mean } from '../lib/rosterData';
import { cn } from '../lib/utils';

/**
 * Department — the Head of Department seat's landing.
 *
 * Ordered by what the seat has to **decide**, not by what is easiest to chart.
 * Pending decisions sit above analytics at every width, and on mobile they come
 * before the metrics entirely. There is no hero block, no oversized card and no
 * chart library; the whole screen is meant to be read in one glance and acted on
 * from the first list.
 *
 * **Every figure is derived from the canonical layers.** The class count is the
 * provisioned sections crossed with the active band; capacity is what Platform
 * Admin provisioned; enrolment is the roster, including anyone promoted in this
 * session; seat coverage is the seat records; timetable readiness and
 * attendance-live are the timetable state. Not one of them is a total anybody
 * typed, and none of them is maintained beside a table that would contradict it.
 * A dashboard that states a figure its own screens disagree with is worse than
 * one that shows nothing.
 *
 * The watchlists here are **class, faculty and timetable signals** — this is a
 * department monitoring screen, not a wider version of the tutor's student
 * watchlist. Individual students are reachable, but by drilling through a class;
 * putting 278 student rows on this page would bury the two classes that actually
 * need the HOD this week.
 */

/**
 * One dashboard figure.
 *
 * The caption is not optional decoration — it is where the figure says what it
 * actually measures. "82%" means nothing until it says across whom and over what
 * period, and a dashboard that leaves that implied is one that misleads.
 */
function Metric({ label, value, caption }) {
  return (
    <div className="flex-1 min-w-[152px] bg-paper border border-line rounded-[16px] px-[14px] py-[12px] shadow-[inset_2px_0_0_rgb(var(--c-accent-line))]">
      <div className={TABLE_HEAD}>{label}</div>
      <div className="mt-[6px] text-[20px] font-[600] tracking-[-.01em] tabular-nums text-ink">{value}</div>
      <div className="mt-[3px] text-[12px] text-ink-faint">{caption}</div>
    </div>
  );
}

/** A dashboard block: a titled, bordered surface whose body is its own list. */
function Block({ title, count, action, onAction, children }) {
  return (
    <section className="flex-1 min-w-0 bg-paper border border-line rounded-[16px] overflow-hidden">
      <header className="flex items-center gap-[8px] h-[40px] px-[14px] bg-mist border-b border-line">
        <h2 className="m-0 text-[12.5px] font-[600] text-ink">{title}</h2>
        {count > 0 && <span className="text-[11.5px] text-ink-faint tabular-nums">{count}</span>}
        <div className="flex-1" />
        {action && (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex items-center gap-[3px] border-0 bg-transparent p-0 font-sans text-[12px] font-[500] text-accent cursor-pointer hover:underline"
          >
            {action}
            <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

function relativeTime(date) {
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function PendingList({ onOpen }) {
  if (DEPT_PENDING.length === 0) return <NothingPending />;

  return (
    <ul className="m-0 p-0 list-none">
      {DEPT_PENDING.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={onOpen}
            className="w-full grid grid-cols-[1fr_auto] gap-x-[12px] items-center px-[14px] py-[9px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2 first:border-t-0"
          >
            <span className="min-w-0">
              <span className="block text-[13px] text-ink truncate">
                {DEPT_REQUEST_KINDS[r.kind].label}
                <span className="text-ink-faint"> · {r.subject}</span>
              </span>
              <span className="block mt-[2px] text-[11.5px] text-ink-faint truncate">
                {r.requester.name} · {r.requester.position} · {relativeTime(r.requestedAt)}
              </span>
            </span>
            <span className="flex-none inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500] text-pending bg-pending-soft">
              Pending
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Department signals, and nothing else.
 *
 * Every row names the record it came from — which class, which faculty member,
 * which slot — and drills through to the page that can act on it. There is no
 * forecast, no risk score and no generic analytic here, because none of those is
 * something a department can do anything about today.
 */
function AttentionList({ onOpen }) {
  if (NEEDS_ATTENTION.length === 0) {
    return (
      <TableEmptyState
        title="Nothing in the department needs attention."
        hint="Low attendance, missing tutors, workload imbalance and timetable conflicts would appear here."
      />
    );
  }

  return (
    <ul className="m-0 p-0 list-none">
      {NEEDS_ATTENTION.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => onOpen(s.to)}
            className="w-full grid grid-cols-[1fr_auto] gap-x-[12px] items-center px-[14px] py-[9px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2 first:border-t-0"
          >
            <span className="min-w-0">
              <span className="block text-[13px] text-ink truncate">
                <span className={s.tone === 'danger' ? 'text-danger font-[500]' : 'text-pending font-[500]'}>
                  {s.kind}
                </span>
                <span className="text-ink-faint"> · {s.title}</span>
              </span>
              <span className="block mt-[2px] text-[11.5px] text-ink-faint truncate" title={s.detail}>
                {s.detail}
              </span>
            </span>
            <span className="flex-none text-ink-faint">
              <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/*
 * Tight tier drops to Class · Attendance · Attention · Chevron. The demoted
 * columns are not lost — tutor, size and pending counts all live in the class
 * drill-through — and each demoted cell carries its own `hidden md:block`
 * wrapper, because a hidden child still occupies a grid track and would push the
 * header out of alignment with its rows.
 */
const HEALTH_GRID =
  'grid grid-cols-[minmax(0,1.6fr)_84px_minmax(0,116px)_34px] md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_78px_92px_78px_minmax(0,124px)_34px] gap-x-[12px] items-center px-[14px]';

function ClassHealthTable({ classes, onOpen }) {
  return (
    <section className="bg-paper border border-line rounded-[16px] overflow-hidden">
      <header className="flex items-center gap-[10px] h-[40px] px-[14px] bg-mist border-b border-line">
        <h2 className="m-0 text-[12.5px] font-[600] text-ink">Class health</h2>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onOpen('/department/classes')}
          className="inline-flex items-center gap-[3px] border-0 bg-transparent p-0 font-sans text-[12px] font-[500] text-accent cursor-pointer hover:underline"
        >
          All classes
          <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      {classes.length === 0 ? (
        <NoClasses />
      ) : (
        <>
          <div className={cn(HEALTH_GRID, TABLE_HEAD, 'h-[34px] border-b border-line')}>
            <span>Class</span>
            <span className="hidden md:block">Class tutor</span>
            <span className="hidden md:block">Students</span>
            <span>Attendance</span>
            <span className="hidden md:block">Pending</span>
            <span>Status</span>
            <span className="sr-only">Open</span>
          </div>

          {classes.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpen('/department/classes')}
              aria-label={`${c.code} — open class`}
              className={cn(
                HEALTH_GRID,
                'w-full h-[46px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2',
              )}
            >
              <span className="min-w-0 text-[13px] text-ink truncate" title={c.code}>
                {c.code}
              </span>

              <span className="hidden md:block min-w-0 text-[12.5px] truncate">
                {c.tutor ? (
                  <span className="text-ink-muted" title={c.tutor.name}>
                    {c.tutor.name}
                  </span>
                ) : (
                  // Stated, not left blank: "no tutor recorded" is the finding,
                  // and an empty cell reads as missing data rather than a gap.
                  <span className="text-danger font-[500]">Not recorded</span>
                )}
              </span>

              <span className="hidden md:block text-[12.5px] text-ink-muted tabular-nums">{c.studentCount}</span>

              {/* Colour marks the one threshold that means something, and never replaces the number. */}
              <span
                className={cn(
                  'text-[13px] tabular-nums',
                  c.attendance < ATTENDANCE_THRESHOLD ? 'font-[500] text-danger' : 'text-ink',
                )}
              >
                {c.attendance}%
              </span>

              <span className="hidden md:block text-[12.5px] text-ink-muted tabular-nums">
                {c.pendingCount === 0 ? <span className="text-ink-faint">—</span> : c.pendingCount}
              </span>

              <span className="min-w-0">
                <span
                  className={cn(
                    'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500] max-w-full truncate',
                    ATTENTION_STATES[c.attention].tone,
                  )}
                >
                  {ATTENTION_STATES[c.attention].label}
                </span>
              </span>

              <span className="flex justify-end text-ink-faint">
                <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
              </span>
            </button>
          ))}
        </>
      )}
    </section>
  );
}

export function DepartmentOverview() {
  const navigate = useNavigate();
  const { classes, totals, seatCoverage } = useDepartmentClasses();
  const { studentsOfDepartment } = useAcademicRoster();
  const { reviewProgress } = useInstitutionalLifecycle();
  // The live term, so the year and band under the title describe the term the
  // page is actually showing rather than the one the fixtures loaded in.
  const { term, bandLabel } = useAcademicTerm();

  if (!DEPARTMENT) {
    return (
      <div className="flex-1 min-h-0 overflow-auto scroll-quiet">
        <div className="max-w-[1240px] mx-auto pt-[26px] px-[28px] pb-[40px] animate-viewIn">
          <DepartmentScopeHeader dept={null} />
          <NoAssignedDepartment />
        </div>
      </div>
    );
  }

  const students = studentsOfDepartment(DEPARTMENT.id);
  const attendance = mean(students.map((s) => s.attendance));
  const promotion = reviewProgress(DEPARTMENT.id);
  const activeFaculty = DEPT_FACULTY.filter((f) => f.lifecycle === 'active').length;
  const tutorWord = seatTitle(CLASS_TUTOR_L4);

  return (
    <div className="flex-1 min-h-0 overflow-auto scroll-quiet">
      <div className="max-w-[1240px] mx-auto pt-[26px] px-[16px] sm:px-[28px] pb-[40px] animate-viewIn">
        <DepartmentScopeHeader />

        <div className="mb-[16px]">
          <h1 className="m-0 text-[24px] font-[600] tracking-[-.02em]">Department</h1>
          {/*
            The configured titles, never an L-number and never a hard-coded
            "HOD". A college that calls this seat something else sees its own
            word here without this file changing.
          */}
          <p className="mt-[5px] mb-0 text-[13px] text-ink-muted">
            {DEPARTMENT.name} · {seatTitle(HOD_L3)} · Academic year {term?.yearLabel ?? ACADEMIC_YEAR.label} ·{' '}
            {bandLabel}
          </p>
        </div>

        {/*
          One container, two layouts.

          Desktop is a two-column grid in source order: metrics across the top,
          Pending and Needs attention side by side, class health across the
          bottom.

          Mobile is a plain column, and there the order changes on purpose —
          `order-*` lifts Pending above the metrics, so the first thing on a
          phone is the work waiting for a decision, not the analytics. The
          `lg:order-none` resets hand the grid its source order back.
        */}
        <div className="flex flex-col lg:grid lg:grid-cols-2 lg:items-start gap-[10px]">
          <div className="order-2 lg:order-none lg:col-span-2 flex flex-wrap gap-[10px]">
            <Metric label="Active classes" value={totals.classCount} caption="Running this academic year" />
            <Metric
              label="Provisioned seats"
              value={`${totals.enrolled} / ${totals.capacity}`}
              caption="Enrolled across all classes"
            />
            <Metric
              label={`${tutorWord} coverage`}
              value={`${seatCoverage.active} / ${seatCoverage.total}`}
              // An outstanding invitation is not coverage, and the caption says
              // so rather than letting the ratio imply otherwise.
              caption={`${seatCoverage.invited} awaiting acceptance · ${seatCoverage.vacant} vacant`}
            />
            <Metric
              label="Overall attendance"
              value={`${attendance}%`}
              // Deliberately explicit: every student in the department across the
              // whole term — not this week, and not an average of class averages.
              caption="Department average, whole term"
            />
          </div>

          <div className="order-2 lg:order-none lg:col-span-2 flex flex-wrap gap-[10px]">
            <Metric
              label="Promotion review"
              value={`${promotion.reviewed} / ${promotion.total}`}
              caption={REVIEW_CONTEXT_NOTE}
            />
            <Metric
              label="Timetable ready"
              value={`${totals.timetableReady} / ${totals.classCount}`}
              caption="Classes running an approved grid"
            />
            <Metric
              label="Attendance live"
              value={`${totals.attendanceLive} / ${totals.classCount}`}
              // A consequence, never a setting: no seat switches attendance on.
              caption="Follows an approved timetable and an active year"
            />
            <Metric
              label="Faculty"
              value={`${activeFaculty} / ${DEPT_FACULTY.length}`}
              caption="Active in the department, of all attached"
            />
          </div>

          <div className="order-1 lg:order-none flex">
            <Block
              title="Pending with you"
              count={DEPT_PENDING.length}
              action="All approvals"
              onAction={() => navigate('/department/approvals')}
            >
              <PendingList onOpen={() => navigate('/department/approvals')} />
            </Block>
          </div>

          <div className="order-3 lg:order-none flex">
            <Block title="Needs attention" count={NEEDS_ATTENTION.length}>
              <AttentionList onOpen={(to) => navigate(to)} />
            </Block>
          </div>

          <div className="order-4 lg:order-none lg:col-span-2">
            <ClassHealthTable classes={classes} onOpen={(to) => navigate(to)} />
          </div>
        </div>
      </div>
    </div>
  );
}
