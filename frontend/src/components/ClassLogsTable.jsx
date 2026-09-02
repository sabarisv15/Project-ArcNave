import { classLine, formatDateLabel, formatFullDate, formatTime } from '@/features/attendance/lib/attendanceData';
import { OwnershipBadge } from '@/features/attendance';
import { STICKY_HEAD, TABLE_HEAD, StickyTableShell, TableEmptyState } from './WorkspaceLayout';
import { cn } from '../lib/utils';

const GRID = 'grid grid-cols-[104px_108px_1.2fr_1.3fr_1.8fr_116px] gap-x-[12px] items-center px-[16px]';

/**
 * Class logs — Date, Time, Subject/course, Class/year/section, Topic taught,
 * Ownership type. No Status column: attendance status and class log topic
 * editability are independent of each other.
 */
export function ClassLogsTable({ rows, now, onOpen }) {
  return (
    <StickyTableShell minWidth={1020}>
      <div className={cn(GRID, STICKY_HEAD, TABLE_HEAD, 'py-[11px]')}>
        <span>Date</span>
        <span>Time</span>
        <span>Subject / course</span>
        <span>Class / section</span>
        <span>Topic taught</span>
        <span>Ownership</span>
      </div>

      {rows.map(({ period, session }) => (
        <button
          key={period.id}
          type="button"
          onClick={() => onOpen(period.id)}
          className={cn(
            GRID,
            'w-full py-[11px] border-0 border-t border-line-light bg-transparent text-left text-ink cursor-pointer transition-colors duration-200 hover:bg-tint2',
          )}
        >
          <span>
            <span className="block text-[13px] font-[500] text-ink">{formatDateLabel(period.date, now)}</span>
            {formatDateLabel(period.date, now) !== formatFullDate(period.date) && (
              <span className="block text-[10.5px] text-ink-faint">{formatFullDate(period.date)}</span>
            )}
          </span>

          <span className="text-[13px] text-ink-muted tabular-nums">
            {formatTime(period.startTime)}–{formatTime(period.endTime)}
          </span>

          <span className="min-w-0 text-[13px] font-[500] text-ink truncate">{period.subject}</span>

          <span className="min-w-0">
            <span className="block text-[13px] text-ink-soft truncate">{period.code}</span>
            <span className="block text-[11px] text-ink-faint truncate">{classLine(period)}</span>
          </span>

          <span
            className="min-w-0 text-[13px] text-ink-soft truncate"
            title={session.classLog.topicTaught || undefined}
          >
            {session.classLog.topicTaught || <span className="text-ink-faint">Not recorded yet</span>}
          </span>

          <span className="min-w-0">
            <OwnershipBadge ownership={period.ownership} />
          </span>
        </button>
      ))}

      {rows.length === 0 && (
        <TableEmptyState title="No results found" hint="Clear a filter or change the search term to see class logs." />
      )}
    </StickyTableShell>
  );
}
