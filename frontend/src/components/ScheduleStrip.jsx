import { CalendarClock } from 'lucide-react';
import { useWorkspace } from '../store/WorkspaceProvider';

/**
 * A quieter companion surface tucked under the composer's lower edge — its own
 * border and background, never a section of the composer's card. The extra top
 * padding is what keeps its content clear of the overlap. The whole strip is
 * the action; the operational Today's schedule lives in Curriculum, not here.
 */
export function ScheduleStrip() {
  const { setScheduleOpen } = useWorkspace();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setScheduleOpen(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setScheduleOpen(true);
        }
      }}
      className="pt-[24px] pb-[13px] px-[16px] bg-surface border border-line rounded-[16px] flex items-center gap-[11px] cursor-pointer transition-colors duration-200 hover:bg-accent-soft focus-visible:bg-accent-soft outline-none"
    >
      <span className="shrink-0 text-accent">
        <CalendarClock size={18} strokeWidth={1.75} />
      </span>
      <span className="block">
        <span className="block text-[13px] font-[500]">Today’s schedule is ready.</span>
        <span className="block mt-[1px] text-[12.5px] text-ink-muted">Your next session starts in 1 hour.</span>
      </span>
    </div>
  );
}
