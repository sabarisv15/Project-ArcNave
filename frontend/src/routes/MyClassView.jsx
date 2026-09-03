import { useNavigate } from 'react-router-dom';
import { ChevronRight, Lock } from 'lucide-react';
import {
  ATTENDANCE_LIVE,
  ATTENDANCE_LOCK_REASON,
  CLASS_TIMETABLE_STATE,
  CLASS_TOTAL,
  CURRENT_HOUR,
  LOW_ATTENDANCE_WATCHLIST,
  MARKED_HOURS,
  OVERALL_ATTENDANCE,
  OWNED_CLASS,
  TODAY_PRESENT,
  WEEKLY_ATTENDANCE,
} from '../lib/classTutorData';
import { PENDING_REQUESTS, REQUEST_KINDS, STATUS_TONE } from '../lib/approvalsData';
import { ClassScopeHeader } from '../components/ClassScopeHeader';
import { CapacityMeter } from '../components/CapacityMeter';
import { PriorSemesterPanel } from '../components/PriorSemesterPanel';
import { TIMETABLE_STATE_LABELS, TIMETABLE_STATE_TONE } from '../lib/timetableState';
import { useAcademicRoster } from '@/features/institution';
import { NoAssignedClass, NoWatchlist, NothingPending } from '../components/InstitutionalState';
import { TABLE_HEAD } from '../components/WorkspaceLayout';
import { cn } from '../lib/utils';

/**
 * One dashboard figure.
 *
 * The caption is not optional decoration — it is where the figure says what it
 * actually measures. "87%" means nothing until it says whether that is this
 * week, this month or the whole term, and a dashboard that leaves that implied
 * is a dashboard that misleads. Every metric here carries one.
 */
function Metric({ label, value, caption, muted }) {
  return (
    <div className="flex-1 min-w-[152px] bg-paper border border-line rounded-[16px] px-[14px] py-[12px] shadow-[inset_2px_0_0_rgb(var(--c-accent-line))]">
      <div className={TABLE_HEAD}>{label}</div>
      <div
        className={cn(
          'mt-[6px] text-[20px] font-[600] tracking-[-.01em] tabular-nums',
          muted ? 'text-ink-muted text-[15px] font-[500]' : 'text-ink',
        )}
      >
        {value}
      </div>
      <div className="mt-[3px] text-[12px] text-ink-faint">{caption}</div>
    </div>
  );
}

/** A dashboard block: a titled, bordered surface whose body is its own list. */
function Block({ title, action, onAction, children }) {
  return (
    <section className="flex-1 min-w-0 bg-paper border border-line rounded-[16px] overflow-hidden">
      <header className="flex items-center gap-[10px] h-[40px] px-[14px] bg-mist border-b border-line">
        <h2 className="m-0 text-[12.5px] font-[600] text-ink">{title}</h2>
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
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

function PendingList({ onOpen }) {
  if (PENDING_REQUESTS.length === 0) return <NothingPending />;

  return (
    <ul className="m-0 p-0 list-none">
      {PENDING_REQUESTS.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => onOpen(r.id)}
            className="w-full grid grid-cols-[1fr_auto] gap-x-[12px] items-center px-[14px] py-[9px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2 first:border-t-0"
          >
            <span className="min-w-0">
              <span className="block text-[13px] text-ink truncate">
                {REQUEST_KINDS[r.kind].label}
                <span className="text-ink-faint"> · {r.subject}</span>
              </span>
              <span className="block mt-[2px] text-[11.5px] text-ink-faint truncate">
                {r.requester.name} · {r.requester.position} · {relativeTime(r.requestedAt)}
              </span>
            </span>
            <span
              className={cn(
                'flex-none inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
                STATUS_TONE[r.status],
              )}
            >
              Pending
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Watchlist({ onOpen }) {
  if (LOW_ATTENDANCE_WATCHLIST.length === 0) return <NoWatchlist />;

  return (
    <ul className="m-0 p-0 list-none">
      {LOW_ATTENDANCE_WATCHLIST.slice(0, 6).map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => onOpen(s.id)}
            className="w-full grid grid-cols-[1fr_auto] gap-x-[12px] items-center px-[14px] py-[9px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2 first:border-t-0"
          >
            <span className="min-w-0 flex items-baseline gap-[8px]">
              <span className="text-[13px] text-ink truncate" title={s.name}>
                {s.name}
              </span>
              <span className="flex-none text-[11px] text-ink-faint tabular-nums">{s.roll}</span>
            </span>
            <span className="flex-none text-[13px] font-[500] text-danger tabular-nums">{s.attendance}%</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Four weeks of class attendance as plain bars.
 *
 * No chart library, and no axis: at four points a bar and its own number say
 * everything a chart would, in a fraction of the vertical space this dashboard
 * has to spend. The 75% threshold is the only reference line that means
 * anything, so it is the only one drawn.
 */
function AttendanceStrip() {
  return (
    <div className="bg-paper border border-line rounded-[16px] px-[14px] py-[12px]">
      <div className={TABLE_HEAD}>Attendance by week</div>
      <div className="mt-[10px] flex items-end gap-[10px]">
        {WEEKLY_ATTENDANCE.map((w) => (
          <div key={w.label} className="flex-1 min-w-0">
            <div className="relative h-[46px] bg-tint2 rounded-[6px] overflow-hidden">
              {/* The 75% eligibility threshold — the one line worth drawing. */}
              <span
                aria-hidden="true"
                className="absolute left-0 right-0 border-t border-dashed border-line"
                style={{ bottom: '75%' }}
              />
              <span
                aria-hidden="true"
                className={cn(
                  'absolute left-0 right-0 bottom-0 rounded-[6px]',
                  w.pct < 75 ? 'bg-danger/70' : 'bg-accent/70',
                )}
                style={{ height: `${Math.min(100, w.pct)}%` }}
              />
            </div>
            <div className="mt-[5px] text-[11.5px] text-ink-muted truncate">{w.label}</div>
            <div className="text-[12px] font-[500] text-ink tabular-nums">{w.pct}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * My Class — the Class Tutor seat's landing.
 *
 * Ordered by what the seat has to *do*, not by what is easiest to chart:
 * pending decisions sit above analytics on every screen size, and on mobile
 * they come before the metrics entirely. There is no hero block and no
 * oversized card; the whole screen is meant to be read in one glance and acted
 * on from the first list.
 */
/**
 * The state of this class's timetable, and what follows from it.
 *
 * **Attendance is a consequence, not a control.** When the timetable is not
 * approved there is no register to open, and the strip says which condition is
 * missing rather than rendering an empty register or a disabled button — a
 * disabled control implies somebody could enable it, and nobody can. Holding
 * the Class Tutor seat has no bearing on it either way, which is why the seat
 * is not mentioned.
 *
 * When attendance *is* live the strip stays, quietly, naming the approved
 * timetable it runs against. A rule the user only ever sees when it blocks them
 * reads as an error; one they can always see reads as how the product works.
 */
function TimetableStrip({ onOpen }) {
  const live = ATTENDANCE_LIVE;

  return (
    <div
      className={cn(
        'flex items-center gap-[9px] flex-wrap px-[14px] py-[10px] border border-line rounded-[16px]',
        live ? 'bg-paper' : 'bg-tint',
      )}
    >
      {!live && <Lock size={14} strokeWidth={1.9} aria-hidden="true" className="flex-none text-ink-faint" />}
      <span className={TABLE_HEAD}>Class timetable</span>
      <span
        className={cn(
          'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
          TIMETABLE_STATE_TONE[CLASS_TIMETABLE_STATE],
        )}
      >
        {TIMETABLE_STATE_LABELS[CLASS_TIMETABLE_STATE]}
      </span>
      <span className="text-[12px] text-ink-muted">
        {live ? 'Attendance is live for this class.' : ATTENDANCE_LOCK_REASON}
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-[3px] border-0 bg-transparent p-0 font-sans text-[12px] font-[500] text-accent cursor-pointer hover:underline"
      >
        Open timetable
        <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}

export function MyClassView() {
  const navigate = useNavigate();
  const { classFill } = useAcademicRoster();

  if (!OWNED_CLASS) {
    return (
      <div className="flex-1 min-h-0 overflow-auto scroll-quiet">
        <div className="max-w-[1240px] mx-auto pt-[26px] px-[28px] pb-[40px] animate-viewIn">
          <ClassScopeHeader cls={null} />
          <NoAssignedClass />
        </div>
      </div>
    );
  }

  const markedToday = MARKED_HOURS.length;
  const fill = classFill(OWNED_CLASS.id);

  return (
    <div className="flex-1 min-h-0 overflow-auto scroll-quiet">
      <div className="max-w-[1240px] mx-auto pt-[26px] px-[28px] pb-[40px] animate-viewIn">
        <ClassScopeHeader />

        <div className="mb-[16px]">
          <h1 className="m-0 text-[24px] font-[600] tracking-[-.02em]">My Class</h1>
          <p className="mt-[5px] mb-0 text-[13px] text-ink-muted">
            Today's attendance, decisions waiting on you, and students to watch.
          </p>
        </div>

        {/*
          One container, two layouts.

          Desktop is a two-column grid in source order: metrics across the top,
          Pending and the watchlist side by side, the strip across the bottom.

          Mobile is a plain column, and there the order changes on purpose —
          `order-*` lifts Pending above the metrics, so the first thing on a
          phone is the work waiting for a decision, not the analytics. The
          `lg:order-none` resets hand the grid its source order back.
        */}
        <div className="flex flex-col lg:grid lg:grid-cols-2 lg:items-start gap-[10px]">
          {/*
            The timetable state comes first, because it decides whether half the
            figures below exist at all. On mobile it sits above everything for
            the same reason.
          */}
          <div className="order-1 lg:order-none lg:col-span-2">
            <TimetableStrip onOpen={() => navigate('/curriculum/my-class/timetable')} />
          </div>

          {/* Metrics — 4 across, wrapping to 2 then 1 as the workspace narrows. */}
          <div className="order-3 lg:order-none lg:col-span-2 flex flex-wrap gap-[10px]">
            <Metric
              label="Today present"
              // With no approved timetable there is no register, so there is no
              // figure — not zero, which would state that nobody turned up.
              value={ATTENDANCE_LIVE ? `${TODAY_PRESENT} / ${CLASS_TOTAL}` : 'Attendance not live'}
              muted={!ATTENDANCE_LIVE}
              caption={
                ATTENDANCE_LIVE
                  ? `Present all ${markedToday} marked hour${markedToday === 1 ? '' : 's'}`
                  : 'Available once the timetable is approved'
              }
            />
            <Metric
              label="Present this hour"
              // An unmarked hour has no attendance figure at all. Showing a
              // number here — least of all zero — would state something nobody
              // has recorded yet.
              value={
                !ATTENDANCE_LIVE || !CURRENT_HOUR
                  ? 'Attendance not live'
                  : CURRENT_HOUR.marked
                    ? `${CURRENT_HOUR.present} / ${CURRENT_HOUR.total}`
                    : 'Not marked yet'
              }
              muted={!ATTENDANCE_LIVE || !CURRENT_HOUR?.marked}
              caption={
                ATTENDANCE_LIVE && CURRENT_HOUR
                  ? `Hour ${CURRENT_HOUR.hourIndex} · ${CURRENT_HOUR.subject}`
                  : 'No register is open for this class'
              }
            />
            {/*
              Enrolled against the section's provisioned capacity. Two separate
              facts, and the gap between them is what an admission or an import
              is bounded by — so the meter states it rather than leaving it to
              be subtracted.
            */}
            <div className="flex-1 min-w-[152px] bg-paper border border-line rounded-[16px] px-[14px] py-[12px] shadow-[inset_2px_0_0_rgb(var(--c-accent-line))]">
              <div className={TABLE_HEAD}>Enrolled</div>
              <CapacityMeter enrolled={fill.enrolled} capacity={fill.capacity} className="mt-[6px]" />
              <div className="mt-[3px] text-[12px] text-ink-faint">Section {OWNED_CLASS.section} provisioned seats</div>
            </div>
            <Metric
              label="Attendance"
              value={`${OVERALL_ATTENDANCE}%`}
              // Deliberately explicit: this figure is the whole term, not the
              // week or the month the strip below happens to show.
              caption="Class average, whole term"
            />
          </div>

          <div className="order-2 lg:order-none flex">
            <Block
              title="Pending with you"
              action="All approvals"
              onAction={() => navigate('/curriculum/my-class/approvals')}
            >
              <PendingList onOpen={() => navigate('/curriculum/my-class/approvals')} />
            </Block>
          </div>

          <div className="order-4 lg:order-none flex">
            <Block
              title="Low-attendance watchlist"
              action="All students"
              onAction={() => navigate('/curriculum/my-class/students')}
            >
              <Watchlist onOpen={() => navigate('/curriculum/my-class/students')} />
            </Block>
          </div>

          <div className="order-5 lg:order-none lg:col-span-2">
            <AttendanceStrip />
          </div>

          {/*
            Last, and visibly a different kind of surface: the term that closed.
            It is read-only and carries no control at all, so it sits below
            everything the seat can actually act on.
          */}
          <div className="order-6 lg:order-none lg:col-span-2">
            <PriorSemesterPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
