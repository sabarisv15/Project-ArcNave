import { canMarkPeriod, classLine, formatTime, markingWindowEnd } from '../lib/attendanceData';
import { useNowTick } from '../hooks/useNowTick';
import { CompactPhase } from './AttendanceStatus';
import { TABLE_HEAD, TableEmptyState } from './WorkspaceLayout';
import { cn } from '../lib/utils';

const GRID = 'grid grid-cols-[152px_1.15fr_1.25fr_170px_136px] gap-x-[12px] items-center px-[16px]';

/** A teaching day is at most 8 periods, so 8 rows is the height budget every row divides. */
const MAX_PERIODS_PER_DAY = 8;
/** Rows stretch to fill the workspace, but never past this — a 3-row filtered result must not become 3 giant bands. */
const MAX_ROW_H = 96;
const MIN_ROW_H = 44;
const HEAD_H = 37;

/** Phases whose row opens a drawer. Everything else shows state only. */
const ACTIONABLE_PHASES = new Set([
  'open', 'marking_missed', 'locked_before_window', 'locked_ready', 'submitted', 'submission_expired',
]);

function actionLabel(phase, session) {
  switch (phase) {
    case 'open': return session.lastSavedAt ? 'Continue' : 'Mark';
    case 'marking_missed': return 'Request';
    case 'locked_before_window': return 'Review';
    case 'locked_ready': return 'Submit';
    case 'submitted': return 'View';
    case 'submission_expired': return 'View';
    default: return null;
  }
}

/** Live `18m left` for the open marking window — its own 1s tick so the whole table doesn't re-render. */
function MarkingCountdown({ period }) {
  const live = useNowTick(true, 1000);
  const minutesLeft = Math.max(0, Math.ceil((markingWindowEnd(period) - live) / 60000));
  return <>{minutesLeft <= 1 ? '<1m left' : `${minutesLeft}m left`}</>;
}

const ROW_BTN =
  'flex-none inline-flex items-center h-[28px] px-[11px] rounded-[8px] font-sans text-[12px] font-[500] whitespace-nowrap cursor-pointer transition-colors duration-200';

function ScheduleRow({ period, phase, session, acknowledged, isCurrent, onOpen, onRequestCover }) {
  const needsAck = period.ownership === 'substitute' && !acknowledged;
  const actionable = ACTIONABLE_PHASES.has(phase) && canMarkPeriod(period, !!acknowledged);
  const label = actionLabel(phase, session);
  const canRequestCover = period.ownership === 'own' && phase === 'upcoming';

  return (
    <div
      className={cn(
        GRID,
        // Current period: a quiet teal edge, not a highlighted card. The transparent
        // border on every other row keeps the columns from shifting.
        'min-h-0 border-t border-line-light border-l-2 transition-colors duration-200 hover:bg-tint2',
        isCurrent ? 'border-l-accent bg-accent-soft/40' : 'border-l-transparent'
      )}
    >
      <span className="text-[12.5px] font-[500] text-ink tabular-nums whitespace-nowrap">
        {formatTime(period.startTime)}–{formatTime(period.endTime)}
      </span>

      <span className="min-w-0 flex items-center gap-[6px]">
        <span className="text-[13px] text-ink truncate" title={period.subject}>{period.subject}</span>
        {period.ownership === 'substitute' && (
          <span
            title={`Substitute for ${period.substituteFor} · ${acknowledged ? 'Acknowledged' : 'Acknowledgement required'}`}
            className="flex-none inline-flex items-center h-[17px] px-[5px] rounded-[5px] text-[10px] font-[500] text-pending bg-pending-soft"
          >
            Sub
          </span>
        )}
      </span>

      <span className="min-w-0 text-[13px] text-ink-muted truncate" title={classLine(period)}>
        {period.code}
      </span>

      <span className="min-w-0">
        <CompactPhase
          phase={phase}
          isDraft={!!session.lastSavedAt}
          needsAck={needsAck}
          detail={phase === 'open' && !needsAck ? <MarkingCountdown period={period} /> : null}
        />
      </span>

      <span className="flex justify-end">
        {needsAck ? (
          <button
            type="button"
            onClick={() => onOpen(period.id)}
            className={cn(ROW_BTN, 'border-0 bg-accent text-white hover:bg-accent-hover')}
          >
            Acknowledge
          </button>
        ) : actionable ? (
          <button
            type="button"
            onClick={() => onOpen(period.id)}
            aria-label={`${label} — ${period.subject}, ${period.code}`}
            className={cn(ROW_BTN, 'border border-line bg-paper text-accent hover:bg-accent-soft hover:border-accent-line')}
          >
            {label}
          </button>
        ) : canRequestCover ? (
          <button
            type="button"
            onClick={() => onRequestCover(period)}
            aria-label={`Request substitute — ${period.subject}, ${period.code}`}
            className={cn(ROW_BTN, 'border border-line bg-paper text-ink-muted hover:bg-tint2 hover:text-ink')}
          >
            Request cover
          </button>
        ) : (
          <span className="text-[12px] text-ink-faint">—</span>
        )}
      </span>
    </div>
  );
}

/**
 * Today's schedule — own periods and approved substitute duties in one
 * combined list, strict ascending IST start-time order.
 *
 * The surface deliberately uses the workspace's full height: rows are equal
 * `1fr` tracks rather than fixed-height bands, so a full 8-period day fills
 * the pane with no dead space underneath and no vertical scrolling on a
 * normal desktop. A short viewport falls back to a controlled internal scroll
 * (rows floor at 44px), and a filtered-down list caps its row height instead
 * of stretching a few rows into giant bands.
 *
 * Every action opens the shared right-side drawer — nothing here navigates.
 */
export function TodaysScheduleTable({ rows, hasAnyPeriods, currentPeriodId, onOpen, onRequestCover }) {
  const count = Math.max(rows.length, 1);
  const cappedHeight = count * MAX_ROW_H + HEAD_H;

  return (
    <div
      className="flex-1 min-h-0 flex flex-col border border-line rounded-[16px] bg-paper overflow-hidden"
      style={{ maxHeight: rows.length >= MAX_PERIODS_PER_DAY ? undefined : cappedHeight }}
    >
      <div className="flex-none overflow-x-auto scroll-quiet">
        <div className="min-w-[880px]">
          <div className={cn(GRID, TABLE_HEAD, 'h-[36px] bg-tint border-b border-line')}>
            <span>Time</span>
            <span>Subject</span>
            <span>Class / section</span>
            <span>State</span>
            <span className="text-right">Action</span>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto scroll-quiet">
        <div
          className="min-w-[880px] min-h-full grid"
          style={{ gridTemplateRows: `repeat(${count}, minmax(${MIN_ROW_H}px, 1fr))` }}
        >
          {rows.map(({ period, phase, session, acknowledged }) => (
            <ScheduleRow
              key={period.id}
              period={period}
              phase={phase}
              session={session}
              acknowledged={acknowledged}
              isCurrent={period.id === currentPeriodId}
              onOpen={onOpen}
              onRequestCover={onRequestCover}
            />
          ))}

          {rows.length === 0 && (
            <TableEmptyState
              title={hasAnyPeriods ? 'No results found' : 'No periods scheduled for you today.'}
              hint={hasAnyPeriods ? 'Try clearing the search or filter.' : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}
