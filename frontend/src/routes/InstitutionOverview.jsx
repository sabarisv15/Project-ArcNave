import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { DEPT_ATTENTION_THRESHOLD, INST_ATTENDANCE } from '../lib/institutionData';
import { DEPT_ATTENTION_STATES, INSTITUTION_ATTENTION } from '../lib/institutionSignals';
import { INST_PENDING, INST_REQUEST_KINDS } from '../lib/institutionApprovalsData';
import { InstitutionScopeHeader } from '../components/InstitutionScopeHeader';
import { InstitutionSetupPanel } from '../components/InstitutionSetupPanel';
import { InstitutionDelegatedSummary } from '../components/InstitutionDelegatedSummary';
import { NoDepartments, NothingToEndorse } from '../components/InstitutionalState';
import { TABLE_HEAD, TableEmptyState } from '../components/WorkspaceLayout';
import { useInstitutionHealth } from '../hooks/useInstitutionHealth';
import { cn } from '../lib/utils';

/**
 * Institution — the Principal seat's landing.
 *
 * Ordered by what the seat has to **endorse**, not by what is easiest to chart.
 * Work awaiting a decision sits above analytics at every width, and on mobile it
 * comes before the metrics entirely. There is no hero block, no oversized card
 * and no chart library; the whole screen is meant to be read in one glance and
 * acted on from the first list.
 *
 * The watchlists here are **department signals** — this is an institution
 * governance screen, not a wider version of the HOD's class watchlist and
 * emphatically not a student monitor. Individual students are reachable, but by
 * drilling through a department; putting 330 at-risk student rows on this page
 * would bury the one department whose average is actually below the threshold.
 *
 * The metric panels are composed locally, exactly as `DepartmentOverview` and
 * `MyClassView` compose their own. Four bordered surfaces with a caption apiece,
 * not instances of a generalised dashboard-metric component — the third caller
 * has now appeared and the shape has stayed identical each time, which is an
 * argument for leaving it alone rather than for abstracting it: what varies
 * between the three is entirely the copy.
 */

/**
 * One dashboard figure.
 *
 * The caption is not optional decoration — it is where the figure says what it
 * actually measures. "81%" means nothing until it says across whom and over what
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

/**
 * What is waiting on the Principal, and only that.
 *
 * Every row names who endorsed or raised it and in what position, because at
 * this altitude "who is asking" is most of the decision: a revision that has
 * already been endorsed by a head of department is a different proposition from
 * one raised directly to this office.
 */
function EndorsementList({ onOpen }) {
  if (INST_PENDING.length === 0) return <NothingToEndorse />;

  return (
    <ul className="m-0 p-0 list-none">
      {INST_PENDING.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={onOpen}
            className="w-full grid grid-cols-[1fr_auto] gap-x-[12px] items-center px-[14px] py-[9px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2 first:border-t-0"
          >
            <span className="min-w-0">
              <span className="block text-[13px] text-ink truncate">
                {INST_REQUEST_KINDS[r.kind].label}
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
 * Institution signals, and nothing else.
 *
 * Every row names the record it came from — which department, which faculty
 * member, which shared room — and drills through to the page that can act on it.
 * There is no forecast, no risk score and no generic analytic here, because none
 * of those is something an institution can do anything about this term.
 */
function AttentionList({ onOpen }) {
  if (INSTITUTION_ATTENTION.length === 0) {
    return (
      <TableEmptyState
        title="Nothing across the institution needs attention."
        hint="Attendance, leadership gaps, workload imbalance and timetable exceptions would appear here."
      />
    );
  }

  return (
    <ul className="m-0 p-0 list-none">
      {INSTITUTION_ATTENTION.map((s) => (
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
 * Tight tier drops to Department · Attendance · Attention · Chevron. The demoted
 * columns are not lost — head, classes, faculty, students and pending counts all
 * live in the department drill-through — and each demoted cell carries its own
 * `hidden md:block` wrapper, because a hidden child still occupies a grid track
 * and would push the header out of alignment with its rows.
 */
const HEALTH_GRID =
  'grid grid-cols-[minmax(0,1.6fr)_84px_minmax(0,132px)_34px] md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_62px_62px_70px_78px_74px_minmax(0,140px)_34px] gap-x-[10px] items-center px-[14px]';

/**
 * How far each department has got through its own promotion review.
 *
 * **Progress, and nothing else.** No student, no outcome, no control — an
 * outcome is a judgement about one person's record taken by the seat that holds
 * it, and an institution-wide "promote all" is not a thing this product has or
 * should look like it has. What an institution head needs from this is whether
 * the transition is finishing, and which department is behind.
 */
function PromotionProgress({ promotion }) {
  if (promotion.total === 0) {
    return (
      <TableEmptyState
        title="No students are awaiting a transition decision."
        hint="A queue appears for each department after the next semester is commenced."
      />
    );
  }

  return (
    <ul className="m-0 p-0 list-none">
      {promotion.byDepartment.map((d) => (
        <li
          key={d.departmentId}
          className="grid grid-cols-[1fr_auto] gap-x-[12px] items-center px-[14px] py-[9px] border-t border-line-light first:border-t-0"
        >
          <span className="min-w-0">
            <span className="block text-[13px] text-ink truncate">{d.name}</span>
            <span className="block mt-[2px] text-[11.5px] text-ink-faint">
              {d.reviewed} of {d.total} decided · confirmed by the department head
            </span>
          </span>
          <span
            className={cn(
              'flex-none inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500] tabular-nums',
              d.pending === 0 ? 'text-success bg-success-soft' : 'text-pending bg-pending-soft',
            )}
          >
            {d.pending === 0 ? 'Complete' : `${d.pending} left`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DepartmentHealthTable({ DEPARTMENT_HEALTH, onOpen }) {
  return (
    <section className="bg-paper border border-line rounded-[16px] overflow-hidden">
      <header className="flex items-center gap-[10px] h-[40px] px-[14px] bg-mist border-b border-line">
        <h2 className="m-0 text-[12.5px] font-[600] text-ink">Department health</h2>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onOpen('/institution/departments')}
          className="inline-flex items-center gap-[3px] border-0 bg-transparent p-0 font-sans text-[12px] font-[500] text-accent cursor-pointer hover:underline"
        >
          All departments
          <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      {DEPARTMENT_HEALTH.length === 0 ? (
        <NoDepartments />
      ) : (
        <>
          <div className={cn(HEALTH_GRID, TABLE_HEAD, 'h-[34px] border-b border-line')}>
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

          {DEPARTMENT_HEALTH.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onOpen(`/institution/departments?dept=${d.id}`)}
              aria-label={`${d.name} — open department`}
              className={cn(
                HEALTH_GRID,
                'w-full h-[46px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2',
              )}
            >
              <span className="min-w-0 text-[13px] text-ink truncate" title={d.name}>
                {d.name}
              </span>

              <span className="hidden md:block min-w-0 text-[12.5px] truncate">
                {d.hod ? (
                  <span className="text-ink-muted" title={d.hod.name}>
                    {d.hod.name}
                  </span>
                ) : (
                  // Stated, not left blank: "no head recorded" is the finding,
                  // and an empty cell reads as missing data rather than a gap.
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
        </>
      )}
    </section>
  );
}

export function InstitutionOverview() {
  const navigate = useNavigate();
  /*
   * Live rather than the frozen exports: a leadership seat filled a moment ago,
   * and a semester commenced a moment ago, both have to read as such here.
   */
  const { readiness, setup, departments: DEPARTMENT_HEALTH } = useInstitutionHealth();

  return (
    <div className="flex-1 min-h-0 overflow-auto scroll-quiet">
      <div className="max-w-[1240px] mx-auto pt-[26px] px-[16px] sm:px-[28px] pb-[40px] animate-viewIn">
        <InstitutionScopeHeader />

        <div className="mb-[16px]">
          <h1 className="m-0 text-[24px] font-[600] tracking-[-.02em]">Institution</h1>
          <p className="mt-[5px] mb-0 text-[13px] text-ink-muted">
            Department health and decisions awaiting your endorsement.
          </p>
        </div>

        {/*
          One container, two layouts.

          Desktop is a two-column grid in source order: metrics across the top,
          endorsements and attention side by side, department health across the
          bottom.

          Mobile is a plain column, and there the order changes on purpose —
          `order-*` lifts the endorsement queue above the metrics, so the first
          thing on a phone is the work waiting for a decision, not the analytics.
          The `lg:order-none` resets hand the grid its source order back.

          Institution setup sits directly under the metrics at every width:
          advisory, never blocking, and deliberately below the work that is
          already waiting on a decision rather than above it.
        */}
        <div className="flex flex-col lg:grid lg:grid-cols-2 lg:items-start gap-[10px]">
          <div className="order-2 lg:order-none lg:col-span-2 flex flex-wrap gap-[10px]">
            <Metric
              label="Departments"
              value={readiness.scale.departmentCount}
              caption="Provisioned for this institution"
            />
            <Metric label="Active classes" value={readiness.scale.classCount} caption={readiness.year.band} />
            {/*
              Enrolment against the capacity the *running* classes actually have
              — not against approved intake, which is how many a department may
              admit in a year and would read as an institution half empty.
            */}
            <Metric
              label="Enrolled"
              value={`${readiness.capacity.enrolled} / ${readiness.capacity.capacity}`}
              caption={`${readiness.capacity.utilisation}% of provisioned capacity`}
            />
            <Metric
              label="Overall attendance"
              value={`${INST_ATTENDANCE}%`}
              // Deliberately explicit: every student in the institution across
              // the whole term — not this week, and not an average of
              // department averages, which would weight a 120-student
              // department the same as a 280-student one.
              caption="Every student, whole term"
            />
          </div>

          <div className="order-3 lg:order-none lg:col-span-2 flex flex-wrap gap-[10px]">
            <Metric
              label="Department heads"
              value={`${readiness.seats.hod.active} / ${readiness.seats.hod.total}`}
              caption={readiness.seats.hod.summary}
            />
            <Metric
              label="Class Tutor seats"
              value={`${readiness.seats.tutor.active} / ${readiness.seats.tutor.total}`}
              caption="Assigned by each head of department"
            />
            <Metric
              label="Timetables approved"
              value={`${readiness.timetable.settled} / ${readiness.timetable.total}`}
              caption={`${readiness.timetable.notSubmitted} not submitted`}
            />
            <Metric
              label="Attendance live"
              value={`${readiness.attendance.live} / ${readiness.attendance.total}`}
              caption="Follows an approved timetable"
            />
          </div>

          <div className="order-4 lg:order-none lg:col-span-2">
            <InstitutionSetupPanel setup={setup} />
          </div>

          <div className="order-1 lg:order-none flex">
            <Block
              title="Awaiting your endorsement"
              count={INST_PENDING.length}
              action="All approvals"
              onAction={() => navigate('/institution/approvals')}
            >
              <EndorsementList onOpen={() => navigate('/institution/approvals')} />
            </Block>
          </div>

          <div className="order-5 lg:order-none flex">
            <Block title="Institution attention" count={INSTITUTION_ATTENTION.length}>
              <AttentionList onOpen={(to) => navigate(to)} />
            </Block>
          </div>

          <div className="order-6 lg:order-none flex">
            <Block
              title="Promotion review"
              count={readiness.promotion.pending}
              action="Academic Year"
              onAction={() => navigate('/institution/academic-year')}
            >
              <PromotionProgress promotion={readiness.promotion} />
            </Block>
          </div>

          {/* Rendered only when a delegated seat was provisioned. */}
          <div className="order-7 lg:order-none flex">
            <InstitutionDelegatedSummary />
          </div>

          <div className="order-8 lg:order-none lg:col-span-2">
            <DepartmentHealthTable DEPARTMENT_HEALTH={DEPARTMENT_HEALTH} onOpen={(to) => navigate(to)} />
          </div>
        </div>
      </div>
    </div>
  );
}
