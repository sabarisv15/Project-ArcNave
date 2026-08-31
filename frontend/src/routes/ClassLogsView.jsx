import { useClassLogs, CLASS_LOG_SORTS } from '../hooks/useClassLogs';
import { SearchPopoverField, SortIconPopover } from '../components/ToolbarIcons';
import { ClassLogFilterPopover, ClassLogChips } from '../components/ClassLogFilters';
import { ClassLogsTable } from '../components/ClassLogsTable';
import { ClassLogDetailDrawer } from '../components/ClassLogDetailDrawer';
import { PANE } from '../components/WorkspaceLayout';

/** Class log — its own primary tab, never a section inside Attendance. Newest IST date/time first by default. */
export function ClassLogsView() {
  const c = useClassLogs();
  const detailRow = c.rows.find((r) => r.period.id === c.detailPeriodId);

  return (
    <div className={PANE}>
      {/* The Level 1 tab already says "Class log" — no repeated heading, just the count and this view's controls. */}
      <div className="flex-none flex items-center gap-[8px] mb-[12px]">
        <span aria-live="polite" className="text-[12px] text-ink-faint">
          {c.resultCountLabel}
        </span>
        <div className="flex-1" />
        <SearchPopoverField
          value={c.query}
          onChange={c.setQuery}
          placeholder="Search topic, subject, class, date…"
          ariaLabel="Search class logs"
        />
        <SortIconPopover options={CLASS_LOG_SORTS} value={c.sortKey} onChange={c.setSortKey} label="Sort class logs" />
        <ClassLogFilterPopover c={c} iconOnly />
      </div>

      <ClassLogChips chips={c.activeChips} onRemove={c.removeChip} onClearAll={c.clearFilters} />

      <ClassLogsTable rows={c.rows} now={c.now} onOpen={c.openDetail} />

      <ClassLogDetailDrawer periodId={c.detailPeriodId} session={detailRow?.session} onClose={c.closeDetail} />
    </div>
  );
}
