import { useMemo } from 'react';
import { cn } from '../lib/utils';
import { formatHours, versionMeta, workloadForVersion } from '../lib/timetableData';
import { PANE, TABLE_HEAD, TableEmptyState } from '../components/WorkspaceLayout';
import { SESSION_TYPES, SessionTypeChip } from '../components/SessionType';
import { TimetableVersionSelect } from '../components/TimetableVersionSelect';
import { useAttendanceStore } from '../store/AttendanceProvider';

const GRID = 'grid grid-cols-[1.5fr_120px_1.4fr_112px] gap-x-[12px] items-center px-[16px]';

/** One quiet figure. Deliberately not a dashboard card — three of these on one line. */
function Figure({ label, value, muted }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] tracking-[.05em] uppercase text-ink-faint mb-[2px]">{label}</div>
      <div className={cn('text-[13px] font-[500] tabular-nums whitespace-nowrap', muted ? 'text-ink-muted' : 'text-ink')}>
        {value}
      </div>
    </div>
  );
}

/**
 * Weekly teaching workload for the selected approved timetable version.
 *
 * Everything here is derived — there is no input, no setter, and no save: the
 * numbers come straight from `workloadForVersion()`, which reads the same
 * blocks the Timetable grid draws. Theory contributes its scheduled duration,
 * a practical contributes its full merged duration, and Free / Break / Lunch /
 * anything outside the selected version contribute nothing by construction.
 *
 * This is teaching load, never staff self-attendance or presence.
 */
export function WorkloadView() {
  const { timetableVersionId, setTimetableVersionId } = useAttendanceStore();
  const workload = useMemo(() => workloadForVersion(timetableVersionId), [timetableVersionId]);
  const meta = versionMeta(timetableVersionId);

  return (
    <div className={PANE}>
      <div className="flex-none flex items-center gap-[10px] flex-wrap mb-[12px]">
        <h2 className="m-0 text-[14px] font-[600] tracking-[-.01em] text-ink">Weekly workload</h2>
        <span className="text-[11px] text-ink-faint">
          Based on Timetable · {meta?.label}
        </span>
        <div className="flex-1" />
        <span className="inline-flex items-center h-[20px] px-[7px] rounded-[6px] bg-tint2 text-[10.5px] font-[500] text-ink-muted">
          Read-only
        </span>
        <TimetableVersionSelect value={timetableVersionId} onChange={setTimetableVersionId} />
      </div>

      {/* One clear total, with the version stated beside it so two versions' figures can never be confused. */}
      <div className="flex-none flex items-end gap-[18px] flex-wrap px-[16px] py-[12px] mb-[12px] border border-line rounded-[14px] bg-paper">
        <div className="min-w-0">
          <div className="text-[10px] tracking-[.05em] uppercase text-ink-faint mb-[2px]">Total</div>
          <div className="flex items-baseline gap-[7px] flex-wrap">
            <span className="text-[24px] font-[600] tabular-nums tracking-[-.02em] text-ink leading-none">
              {formatHours(workload.totalHours)}
            </span>
            <span className="text-[12px] text-ink-muted">/ week</span>
            <span className="text-ink-faint" aria-hidden="true">·</span>
            <span className="text-[12px] font-[500] text-accent">{meta?.label}</span>
          </div>
        </div>
        <div className="flex-1" />
        <Figure label={SESSION_TYPES.theory.label} value={formatHours(workload.theoryHours)} muted />
        <Figure label={SESSION_TYPES.practical.label} value={formatHours(workload.practicalHours)} muted />
        <Figure label="Sessions" value={`${workload.sessionCount} / week`} muted />
      </div>

      <div className="flex-1 min-h-0 flex flex-col border border-line rounded-[16px] bg-paper overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto scroll-quiet">
          <div className="min-w-[720px]">
            <div className={cn(GRID, TABLE_HEAD, 'sticky top-0 z-[46] h-[34px] bg-tint border-b border-line')}>
              <span>Subject</span>
              <span>Type</span>
              <span>Class / section</span>
              <span className="text-right">Hours / week</span>
            </div>

            {workload.rows.map((row) => (
              <div key={row.key} className={cn(GRID, 'h-[44px] border-t border-line-light')}>
                <span className="min-w-0 text-[13px] font-[500] text-ink truncate" title={row.subject}>
                  {row.subject}
                </span>
                <span><SessionTypeChip type={row.type} /></span>
                <span className="min-w-0 text-[12px] text-ink-muted truncate" title={row.code}>
                  {row.code}
                  {row.batch ? ` · ${row.batch}` : ''}
                </span>
                <span className="text-right text-[12.5px] font-[500] tabular-nums text-ink whitespace-nowrap">
                  {formatHours(row.hours)}
                  <span className="block text-[10px] font-[500] text-ink-faint">
                    {row.sessions} {row.sessions === 1 ? 'session' : 'sessions'}
                    {row.longestBlock > 1 ? ` · ${row.longestBlock} hrs merged` : ''}
                  </span>
                </span>
              </div>
            ))}

            {workload.rows.length === 0 && (
              <TableEmptyState title="No teaching sessions in this timetable version." />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
