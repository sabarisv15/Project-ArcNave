import { ChevronRight } from 'lucide-react';
import { ATTENDANCE_THRESHOLD } from '../lib/attendanceLedger';
import { STICKY_HEAD, TABLE_HEAD, StickyTableShell, TableEmptyState } from './WorkspaceLayout';
import { cn } from '../lib/utils';

const GRID = 'grid grid-cols-[1.6fr_120px_100px_128px_44px] gap-x-[12px] items-center px-[16px]';

/**
 * Attendance percentage. Colour is reserved for the one threshold that
 * actually means something (below 75%) and never replaces the number — the
 * value itself always carries the information.
 */
function AttendanceValue({ percentage }) {
  const atRisk = percentage < ATTENDANCE_THRESHOLD;
  return (
    <span className={cn('text-[13px] tabular-nums', atRisk ? 'font-[500] text-danger' : 'text-ink')}>
      {percentage}%
    </span>
  );
}

/**
 * One row per student — never one row per taught hour. This is the answer to
 * "who is falling behind, and by how much"; the exact absence dates live one
 * click away in the detail drawer rather than bloating this table.
 */
export function StudentLedgerTable({ students, onOpenStudent, hasAnyStudents }) {
  return (
    <StickyTableShell minWidth={720}>
      <div className={cn(GRID, STICKY_HEAD, TABLE_HEAD, 'h-[38px]')}>
        <span>Student</span>
        <span>Present</span>
        <span>Absent</span>
        <span>Attendance</span>
        <span className="sr-only">Absence dates</span>
      </div>

      {students.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onOpenStudent(s.id)}
          aria-label={`${s.name}, ${s.percentage}% attendance — view absence dates`}
          className={cn(
            GRID,
            'w-full h-[46px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2',
          )}
        >
          <span className="min-w-0 flex items-baseline gap-[8px]">
            <span className="text-[13px] text-ink truncate" title={s.name}>
              {s.name}
            </span>
            <span className="flex-none text-[11px] text-ink-faint tabular-nums">
              {s.roll} · {s.registerNumber}
            </span>
          </span>

          <span className="text-[13px] text-ink tabular-nums">
            {s.presentHours} <span className="text-ink-faint">/ {s.submittedHours}</span>
          </span>

          <span className="text-[13px] text-ink tabular-nums">{s.absentHours}</span>

          <AttendanceValue percentage={s.percentage} />

          <span className="flex justify-end text-ink-faint">
            <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
          </span>
        </button>
      ))}

      {students.length === 0 && (
        <TableEmptyState
          title={hasAnyStudents ? 'No results found' : 'No submitted attendance for this subject yet.'}
          hint={hasAnyStudents ? 'Try clearing the search or filter.' : undefined}
        />
      )}
    </StickyTableShell>
  );
}
