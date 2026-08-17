import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '../lib/utils';

const TABS = [
  { to: '/curriculum/attendance', label: 'Attendance', end: true },
  { to: '/curriculum/attendance/class-logs', label: 'Class log' },
  { to: '/curriculum/attendance/reports', label: 'Reports' },
  { to: '/curriculum/attendance/timetable', label: 'Timetable' },
  { to: '/curriculum/attendance/workload', label: 'Workload' },
];

/**
 * **Primary** navigation — the module switcher. Deliberately the heaviest
 * navigation in the workspace: 14.5px labels, a semibold active label, a full
 * 2px teal underline, generous horizontal spacing, and a quiet hairline
 * running the width of the row.
 *
 * The secondary row inside Attendance is built to read as a clearly lighter
 * thing (12.5px, short 1px indicator on a soft surface, tighter spacing, no
 * full-width rule) so the two can never be mistaken for the same level. If
 * you change one, change the other to keep them distinct.
 *
 * Level 2 (Today's schedule / Attendance history / Substitute) belongs to the
 * Attendance tab alone and is rendered by `AttendanceHomeView`, never here.
 */
function PrimaryTabs() {
  return (
    <div
      role="tablist"
      aria-label="Attendance sections"
      // `overflow-y-hidden` pairs with `overflow-x-auto` deliberately: without it
      // the computed `overflow-y` becomes `auto`, and the active tab's `-mb-px`
      // is enough overflow to raise a stray vertical scrollbar next to the last tab.
      className="flex items-center gap-[30px] overflow-x-auto overflow-y-hidden scroll-quiet"
    >
      {TABS.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              // -mb-px drops the active underline onto the container's own hairline.
              'relative -mb-px flex-none pb-[11px] border-b-2 font-sans text-[14.5px] whitespace-nowrap no-underline hover:no-underline transition-colors duration-200',
              isActive
                ? 'border-accent text-ink font-[600]'
                : 'border-transparent text-ink-soft font-[500] hover:text-ink'
            )
          }
        >
          {label}
        </NavLink>
      ))}
    </div>
  );
}

export function AttendanceTabsLayout() {
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="flex-none px-[24px] pt-[18px] border-b border-line">
        <PrimaryTabs />
      </div>
      {/* Each pane owns its own padding and its own single scroll region. */}
      <Outlet />
    </div>
  );
}
